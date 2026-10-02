import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { assertCompagnieScope } from '../../common/scope';
import { paginer } from '../../common/pagination';
import { versMoyenJeko } from '../../common/moyens-paiement';
import { UserRole } from '../../config/constants';
import {
  JekoService,
  StatutJeko,
  depuisCentimes,
  erreurJekoVersHttp,
} from '../jeko/jeko.service';
import { CoordonneesReversementDto } from './dto/reversement.dto';

// Plafond Mobile Money par transaction chez Jèko : un lot plus gros est
// reversé en plusieurs fois (les paiements les plus anciens d'abord).
const PLAFOND_TRANSFERT_FCFA = 2_000_000;

// Minimum par transfert (Moov : 100 F, autres réseaux : 5 F).
const MINIMUM_TRANSFERT_FCFA: Record<string, number> = { moov_money: 100 };
const MINIMUM_PAR_DEFAUT_FCFA = 5;

export interface ActeurContexte {
  userId: number;
  role?: string;
  ip?: string;
}

interface Lot {
  paiementIds: number[];
  montantBrut: Prisma.Decimal;
  commission: Prisma.Decimal;
  montantNet: Prisma.Decimal;
  plafondAtteint: boolean;
}

/**
 * Reversement aux compagnies des billets payés en ligne : Yègo encaisse sur
 * son magasin Jèko, puis transfère à chaque compagnie (contact Mobile Money)
 * la part qui lui revient.
 *
 * Paiements éligibles (encaissés via Jèko, pas encore reversés) :
 * - 'paye' sur une réservation confirmée dont le départ est passé (veille ou
 *   avant) : plus d'annulation possible, le voyage est dû ;
 * - 'rembourse' (remboursement soldé) : seuls les frais retenus restent à
 *   reverser.
 */
@Injectable()
export class ReversementsService {
  private readonly logger = new Logger(ReversementsService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private jeko: JekoService,
    private config: ConfigService,
  ) {}

  async apercu(compagnieId: number, user: AuthenticatedUser) {
    assertCompagnieScope(user, compagnieId);
    const compagnie = await this.compagnieOu404(compagnieId);
    const lot = await this.calculerLot(compagnieId);
    const enCours = await this.prisma.reversement.count({
      where: { compagnieId, statut: 'en_cours' },
    });
    return {
      compagnieId,
      coordonnees: this.coordonneesDe(compagnie) ?? { moyen: null, telephone: null },
      nombrePaiements: lot.paiementIds.length,
      montantBrut: lot.montantBrut,
      commissionPourcent: this.commissionPourcent(),
      commission: lot.commission,
      montantNet: lot.montantNet,
      // true : il reste des paiements éligibles au-delà de ce lot.
      plafondAtteint: lot.plafondAtteint,
      reversementsEnCours: enCours,
    };
  }

  // Déclenché par l'admin plateforme : verrouille le lot de paiements (un
  // paiement ne peut appartenir qu'à un reversement), puis ordonne le
  // transfert Jèko. Le résultat arrive par webhook ou réconciliation.
  async creer(compagnieId: number, ctx: ActeurContexte) {
    if (!this.jeko.estConfigure()) {
      throw new BadRequestException('Jèko n’est pas configuré sur cette API');
    }
    const compagnie = await this.compagnieOu404(compagnieId);
    const moyen = compagnie.reversementMoyen;
    const telephone = compagnie.reversementTelephone;
    const moyenJeko = moyen ? versMoyenJeko(moyen) : null;
    if (!moyen || !moyenJeko || !telephone) {
      throw new BadRequestException(
        'La compagnie n’a pas renseigné son compte Mobile Money de reversement',
      );
    }

    const lot = await this.calculerLot(compagnieId);
    if (lot.paiementIds.length === 0) {
      throw new BadRequestException('Aucun paiement à reverser pour cette compagnie');
    }
    const minimum = MINIMUM_TRANSFERT_FCFA[moyen] ?? MINIMUM_PAR_DEFAUT_FCFA;
    const aTransferer = lot.montantNet.greaterThanOrEqualTo(minimum);

    if (aTransferer) {
      const solde = await this.lireSoldeOuNull();
      if (solde != null && lot.montantNet.greaterThan(solde)) {
        throw new BadRequestException(
          `Solde Jèko insuffisant (${solde} FCFA disponibles pour ${lot.montantNet} FCFA à reverser)`,
        );
      }
    }

    const reversement = await this.prisma.$transaction(async (tx) => {
      const rev = await tx.reversement.create({
        data: {
          compagnieId,
          montantBrut: lot.montantBrut,
          commission: lot.commission,
          montantNet: lot.montantNet,
          nombrePaiements: lot.paiementIds.length,
          moyen,
          beneficiaire: telephone,
          creeParId: ctx.userId,
          // Lot entièrement absorbé par la commission (ou sous le minimum
          // opérateur) : rien à transférer, il est soldé tout de suite.
          ...(aTransferer ? {} : { statut: 'effectue', dateEffectue: new Date() }),
        },
      });
      const verrou = await tx.paiement.updateMany({
        where: { id: { in: lot.paiementIds }, reversementId: null },
        data: { reversementId: rev.id },
      });
      if (verrou.count !== lot.paiementIds.length) {
        throw new ConflictException(
          'Des paiements viennent d’être reversés par ailleurs, relancez l’aperçu',
        );
      }
      return tx.reversement.update({
        where: { id: rev.id },
        data: { jekoReference: `YEGO-RV${rev.id}` },
      });
    });

    await this.audit.record({
      action: 'reversement.initie',
      entite: 'reversement',
      entiteId: reversement.id,
      acteurId: ctx.userId,
      acteurRole: ctx.role,
      ip: ctx.ip,
      metadata: {
        compagnieId,
        montantBrut: lot.montantBrut.toString(),
        commission: lot.commission.toString(),
        montantNet: lot.montantNet.toString(),
        nombrePaiements: lot.paiementIds.length,
        beneficiaire: telephone,
        moyen,
      },
    });

    if (!aTransferer) return reversement;

    let transfert;
    try {
      const contactId = await this.contactJeko(compagnie.id, compagnie.nom, moyenJeko, telephone, compagnie.jekoContactId);
      transfert = await this.jeko.creerTransfert({
        contactId,
        montantFcfa: lot.montantNet.toNumber(),
        reference: reversement.jekoReference!,
        description: `Reversement Yègo #${reversement.id} — ${compagnie.nom}`,
      });
    } catch (err) {
      await this.echouer(reversement.id, (err as Error).message);
      erreurJekoVersHttp(err, 'Reversement');
    }

    await this.prisma.reversement.update({
      where: { id: reversement.id },
      data: {
        jekoTransferId: transfert.id,
        fraisJeko:
          transfert.fees?.amount != null ? depuisCentimes(transfert.fees.amount) : null,
      },
    });
    if (transfert.status !== 'pending') {
      await this.appliquerResultatTransfert(reversement.id, transfert.status, {
        transferId: transfert.id,
      });
    }
    return this.prisma.reversement.findUniqueOrThrow({ where: { id: reversement.id } });
  }

  // Issue du transfert (webhook Jèko ou réconciliation). Idempotent.
  async appliquerResultatTransfert(
    id: number,
    statut: StatutJeko,
    details: { transferId?: string; motif?: string; fraisCentimes?: number } = {},
  ) {
    if (statut === 'pending') return;
    const rev = await this.prisma.reversement.findUnique({ where: { id } });
    if (!rev || rev.statut !== 'en_cours') return;
    if (details.transferId && rev.jekoTransferId && details.transferId !== rev.jekoTransferId) {
      this.logger.warn(
        `Transfert ${details.transferId} ignoré : le reversement ${id} suit ${rev.jekoTransferId}`,
      );
      return;
    }

    if (statut === 'success') {
      await this.prisma.reversement.updateMany({
        where: { id, statut: 'en_cours' },
        data: {
          statut: 'effectue',
          dateEffectue: new Date(),
          ...(details.fraisCentimes != null
            ? { fraisJeko: depuisCentimes(details.fraisCentimes) }
            : {}),
        },
      });
      await this.audit.record({
        action: 'reversement.effectue',
        entite: 'reversement',
        entiteId: id,
        metadata: { compagnieId: rev.compagnieId, montantNet: rev.montantNet.toString() },
      });
      return;
    }

    await this.echouer(id, details.motif ?? 'Transfert refusé par l’opérateur');
  }

  async synchroniserTransfert(rev: { id: number; jekoTransferId: string | null }) {
    if (!rev.jekoTransferId) return;
    const transfert = await this.jeko.lireTransfert(rev.jekoTransferId);
    await this.appliquerResultatTransfert(rev.id, transfert.status, {
      transferId: transfert.id,
      fraisCentimes: transfert.fees?.amount,
    });
  }

  async lireCoordonnees(compagnieId: number, user: AuthenticatedUser) {
    assertCompagnieScope(user, compagnieId);
    return this.coordonneesDe(await this.compagnieOu404(compagnieId)) ?? {
      moyen: null,
      telephone: null,
    };
  }

  // Changer le compte de reversement détourne les fonds à venir : action
  // auditée (ancien → nouveau), réservée au gestionnaire de la compagnie ou
  // à l'admin. Le contact Jèko est recréé au prochain reversement.
  async definirCoordonnees(
    compagnieId: number,
    dto: CoordonneesReversementDto,
    user: AuthenticatedUser,
    ip?: string,
  ) {
    assertCompagnieScope(user, compagnieId);
    const avant = await this.compagnieOu404(compagnieId);
    const maj = await this.prisma.compagnie.update({
      where: { id: compagnieId },
      data: {
        reversementMoyen: dto.moyen,
        reversementTelephone: dto.telephone,
        jekoContactId: null,
      },
    });
    await this.audit.record({
      action: 'compagnie.coordonnees_reversement',
      entite: 'compagnie',
      entiteId: compagnieId,
      acteurId: user.userId,
      acteurRole: user.role,
      ip,
      metadata: {
        avant: this.coordonneesDe(avant),
        apres: { moyen: dto.moyen, telephone: dto.telephone },
      },
    });
    return this.coordonneesDe(maj);
  }

  findAll(
    user: AuthenticatedUser,
    filtres: { compagnieId?: number; statut?: string; skip?: number; take?: number },
  ) {
    const where: Prisma.ReversementWhereInput = {};
    if (user.role === UserRole.ADMIN) {
      if (filtres.compagnieId) where.compagnieId = filtres.compagnieId;
    } else {
      // Personnel compagnie : toujours sa propre compagnie.
      if (user.compagnieId == null) return [];
      if (filtres.compagnieId) assertCompagnieScope(user, filtres.compagnieId);
      where.compagnieId = user.compagnieId;
    }
    if (filtres.statut) where.statut = filtres.statut;
    return this.prisma.reversement.findMany({
      where,
      ...paginer(filtres.skip ?? 0, filtres.take ?? 20),
      include: { compagnie: { select: { id: true, nom: true } } },
      orderBy: { dateCreation: 'desc' },
    });
  }

  async findOne(id: number, user: AuthenticatedUser) {
    const rev = await this.prisma.reversement.findUnique({
      where: { id },
      include: {
        compagnie: { select: { id: true, nom: true } },
        paiements: {
          select: {
            id: true,
            reservationId: true,
            montant: true,
            statut: true,
            moyenPaiement: true,
            datePaiement: true,
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!rev) throw new NotFoundException(`Reversement ${id} introuvable`);
    assertCompagnieScope(user, rev.compagnieId);
    return rev;
  }

  async solde() {
    if (!this.jeko.estConfigure()) {
      throw new BadRequestException('Jèko n’est pas configuré sur cette API');
    }
    try {
      return { soldeFcfa: await this.jeko.lireSoldeFcfa() };
    } catch (err) {
      erreurJekoVersHttp(err, 'Solde');
    }
  }

  // ---------------------------------------------------------------------------

  private async calculerLot(compagnieId: number): Promise<Lot> {
    const aujourdHui = new Date();
    const debutDuJour = new Date(
      Date.UTC(aujourdHui.getUTCFullYear(), aujourdHui.getUTCMonth(), aujourdHui.getUTCDate()),
    );
    const paiements = await this.prisma.paiement.findMany({
      where: {
        reversementId: null,
        jekoReference: { not: null },
        reservation: { depart: { trajet: { compagnieId } } },
        OR: [
          {
            statut: 'paye',
            reservation: { statut: 'confirmee', depart: { dateDepart: { lt: debutDuJour } } },
          },
          {
            statut: 'rembourse',
            reservation: { remboursement: { is: { statut: 'rembourse' } } },
          },
        ],
      },
      select: {
        id: true,
        statut: true,
        montant: true,
        reservation: { select: { remboursement: { select: { fraisRetenus: true } } } },
      },
      orderBy: [{ datePaiement: 'asc' }, { id: 'asc' }],
    });

    const paiementIds: number[] = [];
    let montantBrut = new Prisma.Decimal(0);
    let plafondAtteint = false;
    for (const p of paiements) {
      const part =
        p.statut === 'paye'
          ? p.montant
          : (p.reservation.remboursement?.fraisRetenus ?? new Prisma.Decimal(0));
      if (montantBrut.plus(part).greaterThan(PLAFOND_TRANSFERT_FCFA)) {
        plafondAtteint = true;
        break;
      }
      paiementIds.push(p.id);
      montantBrut = montantBrut.plus(part);
    }

    // Commission arrondie au franc inférieur (pas de centimes en XOF).
    const commission = montantBrut
      .times(this.commissionPourcent())
      .dividedBy(100)
      .floor();
    return {
      paiementIds,
      montantBrut,
      commission,
      montantNet: montantBrut.minus(commission),
      plafondAtteint,
    };
  }

  // Échec : le reversement est clos en 'echoue' et ses paiements redeviennent
  // éligibles pour un prochain reversement.
  private async echouer(id: number, motif: string) {
    await this.prisma.$transaction([
      this.prisma.reversement.update({
        where: { id },
        data: { statut: 'echoue', motifEchec: motif.slice(0, 500) },
      }),
      this.prisma.paiement.updateMany({
        where: { reversementId: id },
        data: { reversementId: null },
      }),
    ]);
    await this.audit.record({
      action: 'reversement.echoue',
      entite: 'reversement',
      entiteId: id,
      metadata: { motif },
    });
  }

  private async contactJeko(
    compagnieId: number,
    nom: string,
    moyen: NonNullable<ReturnType<typeof versMoyenJeko>>,
    telephone: string,
    existant: string | null,
  ): Promise<string> {
    if (existant) return existant;
    const contactId = await this.jeko.creerContact({ nom, moyen, telephone });
    await this.prisma.compagnie.update({
      where: { id: compagnieId },
      data: { jekoContactId: contactId },
    });
    return contactId;
  }

  private async lireSoldeOuNull(): Promise<number | null> {
    try {
      return await this.jeko.lireSoldeFcfa();
    } catch (err) {
      // Lecture du solde indicative : Jèko refusera un transfert non provisionné.
      this.logger.warn(`Solde Jèko illisible : ${(err as Error).message}`);
      return null;
    }
  }

  private commissionPourcent(): number {
    return Number(this.config.get('REVERSEMENT_COMMISSION_POURCENT') ?? 0);
  }

  private async compagnieOu404(id: number) {
    const compagnie = await this.prisma.compagnie.findUnique({ where: { id } });
    if (!compagnie) throw new NotFoundException(`Compagnie ${id} introuvable`);
    return compagnie;
  }

  private coordonneesDe(c: { reversementMoyen: string | null; reversementTelephone: string | null }) {
    if (!c.reversementMoyen || !c.reversementTelephone) return null;
    return { moyen: c.reversementMoyen, telephone: c.reversementTelephone };
  }
}

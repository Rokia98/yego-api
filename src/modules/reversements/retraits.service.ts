import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import { paginer } from '../../common/pagination';
import { versMoyenJeko } from '../../common/moyens-paiement';
import {
  JekoService,
  StatutJeko,
  depuisCentimes,
  erreurJekoVersHttp,
} from '../jeko/jeko.service';
import { ActeurContexte, VERROU_RETRAIT } from './reversements.service';

const PLAFOND_TRANSFERT_FCFA = 2_000_000;

/**
 * Retrait de la part Yègo (frais de service, commissions) du magasin Jèko vers
 * le numéro Mobile Money de Yègo (RETRAIT_YEGO_TELEPHONE, Wave ou Orange
 * Money). L'argent des compagnies et des voyageurs reste intouchable :
 *
 *   retirable + frais Jèko du retrait ≤ solde Jèko − engagements
 *
 * engagements = billets encaissés en ligne pas encore reversés (prix complet,
 * remboursement possible), frais retenus des remboursements soldés pas encore
 * reversés, frais Jèko des transferts à venir pour cet argent, reversements
 * et retraits en cours.
 */
@Injectable()
export class RetraitsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private jeko: JekoService,
    private config: ConfigService,
  ) {}

  async apercu() {
    const soldeJeko = await this.lireSolde();
    const engagements = await this.engagements();
    const retirable = this.retirable(soldeJeko, engagements.total);

    const [frais, commissions, retire] = await Promise.all([
      this.prisma.paiement.aggregate({
        where: { jekoReference: { not: null }, statut: { in: ['paye', 'rembourse'] } },
        _sum: { fraisService: true },
      }),
      this.prisma.reversement.aggregate({
        where: { statut: 'effectue' },
        _sum: { commission: true },
      }),
      this.prisma.retraitPlateforme.aggregate({
        where: { statut: 'effectue' },
        _sum: { montant: true },
      }),
    ]);

    return {
      devise: 'XOF',
      soldeJeko,
      engagements,
      retirable,
      // Cumuls depuis le début (informatif).
      fraisServiceEncaisses: frais._sum.fraisService ?? new Prisma.Decimal(0),
      commissionsPercues: commissions._sum.commission ?? new Prisma.Decimal(0),
      dejaRetire: retire._sum.montant ?? new Prisma.Decimal(0),
      beneficiaire: this.telephone() ?? null,
      moyens: ['wave', 'orange_money'],
      // Prélevés par Jèko en plus du montant retiré.
      fraisTransfertPourcent: this.jeko.fraisTransfertPourcent(),
    };
  }

  async creer(dto: { montant: number; moyen: 'wave' | 'orange_money'; motDePasse: string }, ctx: ActeurContexte) {
    const telephone = this.telephone();
    if (!telephone) {
      throw new BadRequestException(
        'Numéro de retrait Yègo non configuré (RETRAIT_YEGO_TELEPHONE)',
      );
    }
    await this.verifierMotDePasse(ctx.userId, dto.motDePasse);

    if (dto.montant > PLAFOND_TRANSFERT_FCFA) {
      throw new BadRequestException(`Maximum ${PLAFOND_TRANSFERT_FCFA} FCFA par retrait`);
    }
    const soldeJeko = await this.lireSolde();

    // Verrou global : contrôle « un seul retrait en cours » + création
    // atomiques (deux clics simultanés ne retirent pas deux fois).
    const retrait = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${VERROU_RETRAIT})::text`;
      const enCours = await tx.retraitPlateforme.count({ where: { statut: 'en_cours' } });
      if (enCours > 0) {
        throw new ConflictException('Un retrait est déjà en cours, attendez son résultat');
      }
      const retirable = this.retirable(soldeJeko, (await this.engagements()).total);
      if (retirable.lessThan(dto.montant)) {
        throw new BadRequestException(
          `Montant supérieur à la part Yègo retirable (${retirable} FCFA) : le reste du solde appartient aux compagnies et aux voyageurs`,
        );
      }
      const r = await tx.retraitPlateforme.create({
        data: {
          montant: dto.montant,
          moyen: dto.moyen,
          beneficiaire: telephone,
          creeParId: ctx.userId,
        },
      });
      return tx.retraitPlateforme.update({
        where: { id: r.id },
        data: { jekoReference: `YEGO-RT${r.id}` },
      });
    });

    await this.audit.record({
      action: 'retrait.initie',
      entite: 'retrait_plateforme',
      entiteId: retrait.id,
      acteurId: ctx.userId,
      acteurRole: ctx.role,
      ip: ctx.ip,
      metadata: { montant: dto.montant, moyen: dto.moyen, beneficiaire: telephone },
    });

    let transfert;
    try {
      const contactId = await this.jeko.creerContact({
        nom: 'Yègo',
        moyen: versMoyenJeko(dto.moyen)!,
        telephone,
      });
      transfert = await this.jeko.creerTransfert({
        contactId,
        montantFcfa: dto.montant,
        reference: retrait.jekoReference!,
        description: `Retrait Yègo #${retrait.id}`,
      });
    } catch (err) {
      await this.echouer(retrait.id, (err as Error).message);
      erreurJekoVersHttp(err, 'Retrait');
    }

    await this.prisma.retraitPlateforme.update({
      where: { id: retrait.id },
      data: {
        jekoTransferId: transfert.id,
        fraisJeko:
          transfert.fees?.amount != null ? depuisCentimes(transfert.fees.amount) : null,
      },
    });
    if (transfert.status !== 'pending') {
      await this.appliquerResultatTransfert(retrait.id, transfert.status, {
        transferId: transfert.id,
      });
    }
    return this.prisma.retraitPlateforme.findUniqueOrThrow({ where: { id: retrait.id } });
  }

  findAll(filtres: { statut?: string; skip?: number; take?: number }) {
    return this.prisma.retraitPlateforme.findMany({
      where: filtres.statut ? { statut: filtres.statut } : {},
      ...paginer(filtres.skip ?? 0, filtres.take ?? 20),
      orderBy: { dateCreation: 'desc' },
    });
  }

  // Issue du transfert (webhook Jèko ou réconciliation). Idempotent.
  async appliquerResultatTransfert(
    id: number,
    statut: StatutJeko,
    details: { transferId?: string; motif?: string; fraisCentimes?: number } = {},
  ) {
    if (statut === 'pending') return;
    const r = await this.prisma.retraitPlateforme.findUnique({ where: { id } });
    if (!r || r.statut !== 'en_cours') return;
    if (details.transferId && r.jekoTransferId && details.transferId !== r.jekoTransferId) return;

    if (statut === 'success') {
      await this.prisma.retraitPlateforme.updateMany({
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
        action: 'retrait.effectue',
        entite: 'retrait_plateforme',
        entiteId: id,
        metadata: { montant: r.montant.toString() },
      });
      return;
    }
    await this.echouer(id, details.motif ?? 'Transfert refusé par l’opérateur');
  }

  async synchroniserTransfert(r: { id: number; jekoTransferId: string | null }) {
    if (!r.jekoTransferId) return;
    const transfert = await this.jeko.lireTransfert(r.jekoTransferId);
    await this.appliquerResultatTransfert(r.id, transfert.status, {
      transferId: transfert.id,
      fraisCentimes: transfert.fees?.amount,
    });
  }

  // ---------------------------------------------------------------------------

  private async engagements() {
    const zero = new Prisma.Decimal(0);
    const [billets, fraisRetenus, reversements, retraits] = await Promise.all([
      this.prisma.paiement.aggregate({
        where: { jekoReference: { not: null }, reversementId: null, statut: 'paye' },
        _sum: { montant: true },
      }),
      this.prisma.remboursement.aggregate({
        where: {
          statut: 'rembourse',
          reservation: {
            paiement: { is: { jekoReference: { not: null }, reversementId: null, statut: 'rembourse' } },
          },
        },
        _sum: { fraisRetenus: true },
      }),
      this.prisma.reversement.aggregate({
        where: { statut: 'en_cours' },
        _sum: { montantNet: true },
      }),
      this.prisma.retraitPlateforme.aggregate({
        where: { statut: 'en_cours' },
        _sum: { montant: true },
      }),
    ]);
    const billetsNonReverses = billets._sum.montant ?? zero;
    const fraisRetenusNonReverses = fraisRetenus._sum.fraisRetenus ?? zero;
    const detail = {
      billetsNonReverses,
      fraisRetenusNonReverses,
      // Frais Jèko des transferts qu'il faudra encore faire pour cet argent
      // (reversement ou remboursement) : débités du magasin en plus.
      fraisTransfertsAVenir: this.jeko.fraisTransfertFcfa(
        billetsNonReverses.plus(fraisRetenusNonReverses),
      ),
      reversementsEnCours: reversements._sum.montantNet ?? zero,
      retraitsEnCours: retraits._sum.montant ?? zero,
    };
    return {
      ...detail,
      total: Object.values(detail).reduce((a, b) => a.plus(b), zero),
    };
  }

  // Montant que Yègo peut se faire envoyer : ce qui reste après engagements
  // doit couvrir le retrait ET ses frais Jèko.
  private retirable(soldeJeko: number, engagements: Prisma.Decimal): Prisma.Decimal {
    return this.jeko.maxTransferableFcfa(
      new Prisma.Decimal(soldeJeko).minus(engagements).floor(),
    );
  }

  private async lireSolde(): Promise<number> {
    if (!this.jeko.estConfigure()) {
      throw new BadRequestException('Jèko n’est pas configuré sur cette API');
    }
    let solde: number | null;
    try {
      solde = await this.jeko.lireSoldeFcfa();
    } catch (err) {
      erreurJekoVersHttp(err, 'Solde');
    }
    // Sans solde fiable, aucun retrait : on ne prend pas le risque de vider
    // l'argent des compagnies.
    if (solde == null) {
      throw new BadRequestException('Solde Jèko illisible : retrait impossible pour le moment');
    }
    return solde;
  }

  private async verifierMotDePasse(userId: number, motDePasse: string) {
    const u = await this.prisma.utilisateur.findUnique({
      where: { id: userId },
      select: { motDePasseHash: true },
    });
    if (!u?.motDePasseHash || !(await bcrypt.compare(motDePasse, u.motDePasseHash))) {
      throw new ForbiddenException('Mot de passe incorrect');
    }
  }

  private async echouer(id: number, motif: string) {
    await this.prisma.retraitPlateforme.update({
      where: { id },
      data: { statut: 'echoue', motifEchec: motif.slice(0, 500) },
    });
    await this.audit.record({
      action: 'retrait.echoue',
      entite: 'retrait_plateforme',
      entiteId: id,
      metadata: { motif },
    });
  }

  private telephone(): string | undefined {
    return this.config.get<string>('RETRAIT_YEGO_TELEPHONE') || undefined;
  }
}

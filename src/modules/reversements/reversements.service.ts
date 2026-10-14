import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { MoyenEncaissementYego, versMoyenJeko } from '../../common/moyens-paiement';
import { UserRole } from '../../config/constants';
import { Notif, NotificationsService } from '../notifications/notifications.service';
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

// Clés de verrou PostgreSQL (pg_advisory_xact_lock) : une par compagnie pour
// les demandes, une globale pour les retraits Yègo.
const VERROU_DEMANDE = 1_000_000_000;
export const VERROU_RETRAIT = 2_000_000_000;

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
 * son magasin Jèko. La compagnie demande son reversement ; l'admin valide, ce
 * qui transfère sa part du magasin Jèko vers le numéro Wave / Orange Money de
 * Yègo ; l'admin la remet ensuite en main propre à la compagnie (marquerRemis).
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
    private notifications: NotificationsService,
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
      // Plus de délai de sécurité : les fonds partent vers le numéro de Yègo,
      // pas vers un compte que la compagnie peut modifier. Gardé pour les
      // clients existants.
      bloqueJusquA: null,
    };
  }

  // Solde de la compagnie chez Yègo (ventes en ligne encaissées via Jèko) :
  // - disponible : reversable dès maintenant (mêmes règles que l'aperçu, sans
  //   le plafond par transfert) ;
  // - enAttente : encaissé mais pas encore reversable (départ à venir, ou
  //   remboursement non soldé dont seuls les frais retenus reviendront) ;
  // - enCoursDeReversement : transferts lancés, pas encore confirmés ;
  // - totalReverse : cumul des reversements effectués.
  // Les ventes au guichet n'y figurent pas : la compagnie les encaisse elle-même.
  async soldeCompagnie(
    compagnieId: number,
    user: AuthenticatedUser,
    periode?: { du?: string; au?: string },
  ) {
    assertCompagnieScope(user, compagnieId);
    await this.compagnieOu404(compagnieId);
    const debutDuJour = this.debutDuJour();

    const [paiements, [aRemettre, remis], dernier, demandeEnAttente] = await Promise.all([
      this.prisma.paiement.findMany({
        where: {
          reversementId: null,
          jekoReference: { not: null },
          statut: { in: ['paye', 'rembourse'] },
          reservation: { depart: { trajet: { compagnieId } } },
        },
        select: {
          statut: true,
          montant: true,
          reservation: {
            select: {
              statut: true,
              depart: { select: { dateDepart: true } },
              remboursement: { select: { statut: true, fraisRetenus: true } },
            },
          },
        },
      }),
      Promise.all([
        // Validés par Yègo mais pas encore remis en main propre.
        this.prisma.reversement.aggregate({
          where: {
            compagnieId,
            OR: [{ statut: 'en_cours' }, { statut: 'effectue', remisLe: null }],
          },
          _sum: { montantNet: true },
          _count: { _all: true },
        }),
        this.prisma.reversement.aggregate({
          where: { compagnieId, statut: 'effectue', remisLe: { not: null } },
          _sum: { montantNet: true },
          _count: { _all: true },
        }),
      ]),
      this.prisma.reversement.findFirst({
        where: { compagnieId, remisLe: { not: null } },
        orderBy: { remisLe: 'desc' },
        select: { id: true, montantNet: true, remisLe: true },
      }),
      this.prisma.demandeReversement.findFirst({
        where: { compagnieId, statut: 'en_attente' },
        select: { id: true, montantNetEstime: true, montantDemande: true, dateDemande: true },
      }),
    ]);

    const zero = new Prisma.Decimal(0);
    const disponible = { nombre: 0, brut: zero };
    const enAttente = { nombre: 0, brut: zero };
    for (const p of paiements) {
      const r = p.reservation;
      const frais = r.remboursement?.fraisRetenus ?? zero;
      let cible: typeof disponible | null = null;
      let part = zero;
      if (p.statut === 'paye' && r.statut === 'confirmee') {
        cible = r.depart.dateDepart < debutDuJour ? disponible : enAttente;
        part = p.montant;
      } else if (p.statut === 'rembourse' && r.remboursement?.statut === 'rembourse') {
        cible = disponible;
        part = frais;
      } else if (p.statut === 'paye' && r.remboursement) {
        cible = enAttente;
        part = frais;
      }
      if (!cible) continue;
      cible.nombre += 1;
      cible.brut = cible.brut.plus(part);
    }

    const detail = (b: { nombre: number; brut: Prisma.Decimal }) => {
      const commission = this.commissionSur(b.brut);
      return {
        nombrePaiements: b.nombre,
        montantBrut: b.brut,
        commission,
        montantNet: b.brut.minus(commission),
      };
    };
    const reversements = (a: typeof remis) => ({
      nombre: a._count._all,
      montant: a._sum.montantNet ?? zero,
    });

    return {
      compagnieId,
      devise: 'XOF',
      commissionPourcent: this.commissionPourcent(),
      disponible: detail(disponible),
      enAttente: detail(enAttente),
      // Validé par Yègo, en attente de remise en main propre.
      enCoursDeReversement: reversements(aRemettre),
      // Effectivement remis à la compagnie.
      totalReverse: reversements(remis),
      dernierReversement: dernier,
      // Demande faite par la compagnie, pas encore traitée par Yègo (ou null).
      demandeEnAttente,
      ...(await this.soldeParCanal(
        compagnieId,
        [disponible, enAttente].reduce((t, b) => t.plus(detail(b).montantNet), zero)
          .plus(reversements(aRemettre).montant)
          .plus(reversements(remis).montant),
        periode,
      )),
    };
  }

  // Ventes encaissées directement par la compagnie (paiements sans passage par
  // Jèko : espèces ou mobile money reçus au comptoir), puis totaux.
  // `periode` (sur la date de paiement) ne s'applique qu'au bloc guichet ;
  // enLigne et global restent cumulés depuis le début.
  private async soldeParCanal(
    compagnieId: number,
    enLigneTotal: Prisma.Decimal,
    periode?: { du?: string; au?: string },
  ) {
    const zero = new Prisma.Decimal(0);
    const base: Prisma.PaiementWhereInput = {
      jekoReference: null,
      reservation: { depart: { trajet: { compagnieId } } },
    };
    const datePaiement =
      periode?.du || periode?.au
        ? {
            ...(periode.du && { gte: new Date(`${periode.du}T00:00:00.000Z`) }),
            ...(periode.au && { lte: new Date(`${periode.au}T23:59:59.999Z`) }),
          }
        : undefined;

    const calculer = async (filtreDate?: Prisma.DateTimeNullableFilter) => {
      const where = { ...base, ...(filtreDate && { datePaiement: filtreDate }) };
      const [payes, rembourses] = await Promise.all([
        this.prisma.paiement.groupBy({
          by: ['moyenPaiement'],
          where: { ...where, statut: 'paye' },
          _sum: { montant: true },
          _count: { _all: true },
        }),
        this.prisma.paiement.findMany({
          where: { ...where, statut: 'rembourse' },
          select: {
            moyenPaiement: true,
            reservation: {
              select: { remboursement: { select: { fraisRetenus: true, montantRembourse: true } } },
            },
          },
        }),
      ]);
      const parMoyen: Record<string, Prisma.Decimal> = {};
      const ajouter = (moyen: string, m: Prisma.Decimal) => {
        parMoyen[moyen] = (parMoyen[moyen] ?? zero).plus(m);
      };
      let encaisse = zero;
      let rembourse = zero;
      let nombre = 0;
      for (const g of payes) {
        const m = g._sum.montant ?? zero;
        encaisse = encaisse.plus(m);
        nombre += g._count._all;
        ajouter(g.moyenPaiement, m);
      }
      for (const p of rembourses) {
        const r = p.reservation.remboursement;
        const garde = r?.fraisRetenus ?? zero;
        encaisse = encaisse.plus(garde);
        rembourse = rembourse.plus(r?.montantRembourse ?? zero);
        nombre += 1;
        ajouter(p.moyenPaiement, garde);
      }
      return { nombrePaiements: nombre, encaisse, rembourse, parMoyen };
    };

    const guichet = await calculer(datePaiement);
    const guichetCumul = datePaiement ? (await calculer()).encaisse : guichet.encaisse;
    return {
      guichet,
      enLigne: { total: enLigneTotal },
      global: { total: enLigneTotal.plus(guichetCumul) },
    };
  }

  // Déclenché par l'admin plateforme : verrouille le lot de paiements (un
  // paiement ne peut appartenir qu'à un reversement), puis ordonne le
  // transfert Jèko. Le résultat arrive par webhook ou réconciliation.
  // Le transfert Jèko part vers le numéro Wave / Orange Money de Yègo
  // (RETRAIT_YEGO_TELEPHONE), jamais vers la compagnie : l'admin lui remet
  // ensuite l'argent en main propre, puis le déclare (marquerRemis).
  async creer(
    compagnieId: number,
    moyen: MoyenEncaissementYego,
    ctx: ActeurContexte,
    montantDemande?: Prisma.Decimal | null,
  ) {
    if (!this.jeko.estConfigure()) {
      throw new BadRequestException('Jèko n’est pas configuré sur cette API');
    }
    const telephone = this.config.get<string>('RETRAIT_YEGO_TELEPHONE');
    if (!telephone) {
      throw new BadRequestException(
        'Numéro Mobile Money de Yègo non configuré (RETRAIT_YEGO_TELEPHONE)',
      );
    }
    const moyenJeko = versMoyenJeko(moyen)!;
    const compagnie = await this.compagnieOu404(compagnieId);

    const lot = await this.calculerLot(compagnieId, montantDemande ?? undefined);
    if (lot.paiementIds.length === 0) {
      if (montantDemande != null && (await this.calculerLot(compagnieId)).paiementIds.length > 0) {
        throw new BadRequestException(
          `Aucun billet entier ne tient dans le montant demandé (${montantDemande} FCFA) : le plus ancien billet disponible le dépasse. La demande reste en attente ; la compagnie peut l'annuler et redemander un montant plus élevé.`,
        );
      }
      throw new BadRequestException('Aucun paiement à reverser pour cette compagnie');
    }
    const minimum = MINIMUM_TRANSFERT_FCFA[moyen] ?? MINIMUM_PAR_DEFAUT_FCFA;
    const aTransferer = lot.montantNet.greaterThanOrEqualTo(minimum);

    if (aTransferer) {
      const solde = await this.lireSoldeOuNull();
      // Jèko débite le montant + ses frais de transfert.
      const aDebiter = lot.montantNet.plus(this.jeko.fraisTransfertFcfa(lot.montantNet));
      if (solde != null && aDebiter.greaterThan(solde)) {
        throw new BadRequestException(
          `Solde Jèko insuffisant (${solde} FCFA disponibles pour ${aDebiter} FCFA à débiter, frais Jèko compris)`,
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
          // (rien à remettre non plus).
          ...(aTransferer
            ? {}
            : { statut: 'effectue', dateEffectue: new Date(), remisLe: new Date() }),
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
      // Ce reversement honore la demande en attente de la compagnie, qu'il
      // soit lancé depuis la demande ou directement par l'admin.
      await tx.demandeReversement.updateMany({
        where: { compagnieId, statut: 'en_attente' },
        data: {
          statut: 'approuvee',
          reversementId: rev.id,
          traiteParId: ctx.userId,
          dateTraitement: new Date(),
        },
      });
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
      const contactId = await this.jeko.creerContact({ nom: 'Yègo', moyen: moyenJeko, telephone });
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

  // ---------------------------------------------------------------------------
  // Demandes de reversement : la compagnie demande, l'admin approuve (ce qui
  // lance creer()) ou rejette.

  // montant absent = tout le disponible ; sinon plafond (billets entiers) du
  // reversement qui sera fait à l'approbation.
  async demander(
    user: AuthenticatedUser,
    dto: { commentaire?: string; montant?: number },
    ip?: string,
  ) {
    const { commentaire } = dto;
    const compagnieId = user.compagnieId;
    if (compagnieId == null) {
      throw new ForbiddenException("Votre compte n'est rattaché à aucune compagnie");
    }
    const compagnie = await this.compagnieOu404(compagnieId);
    const lot = await this.calculerLot(compagnieId);
    if (lot.paiementIds.length === 0 || lot.montantNet.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Aucun montant disponible à reverser pour le moment');
    }
    const montantDemande = dto.montant != null ? new Prisma.Decimal(dto.montant) : null;
    if (montantDemande && montantDemande.greaterThan(lot.montantNet)) {
      throw new BadRequestException(
        `Montant demandé supérieur au disponible (${lot.montantNet} FCFA)`,
      );
    }
    // Verrou par compagnie : deux clics simultanés ne créent pas deux
    // demandes en attente.
    const demande = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${VERROU_DEMANDE + compagnieId})::text`;
      const enAttente = await tx.demandeReversement.findFirst({
        where: { compagnieId, statut: 'en_attente' },
        select: { id: true },
      });
      if (enAttente) {
        throw new ConflictException(
          `Une demande de reversement est déjà en attente (#${enAttente.id})`,
        );
      }
      return tx.demandeReversement.create({
        data: {
          compagnieId,
          montantNetEstime: lot.montantNet,
          montantDemande,
          commentaire,
          demandeParId: user.userId,
        },
      });
    });

    const admins = await this.prisma.utilisateur.findMany({
      where: { role: UserRole.ADMIN, actif: true },
      select: { id: true },
    });
    for (const a of admins) {
      await this.notifications.notifier(a.id, {
        type: 'reversement.demande',
        titre: 'Demande de reversement',
        corps: `${compagnie.nom} demande le reversement de ${montantDemande ?? lot.montantNet} FCFA.`,
        donnees: { compagnieId, demandeId: demande.id },
      });
    }
    await this.audit.record({
      action: 'reversement.demande',
      entite: 'demande_reversement',
      entiteId: demande.id,
      acteurId: user.userId,
      acteurRole: user.role,
      ip,
      metadata: {
        compagnieId,
        montantNetEstime: lot.montantNet.toString(),
        montantDemande: montantDemande?.toString() ?? null,
      },
    });
    return demande;
  }

  listerDemandes(
    user: AuthenticatedUser,
    filtres: { compagnieId?: number; statut?: string; skip?: number; take?: number },
  ) {
    const where: Prisma.DemandeReversementWhereInput = {};
    if (user.role === UserRole.ADMIN) {
      if (filtres.compagnieId) where.compagnieId = filtres.compagnieId;
    } else {
      if (user.compagnieId == null) return [];
      if (filtres.compagnieId) assertCompagnieScope(user, filtres.compagnieId);
      where.compagnieId = user.compagnieId;
    }
    if (filtres.statut) where.statut = filtres.statut;
    return this.prisma.demandeReversement.findMany({
      where,
      ...paginer(filtres.skip ?? 0, filtres.take ?? 20),
      include: {
        compagnie: { select: { id: true, nom: true } },
        reversement: { select: { id: true, statut: true, montantNet: true, dateEffectue: true } },
      },
      orderBy: { dateDemande: 'desc' },
    });
  }

  // Approbation par l'admin : transfert Jèko du lot éligible (montant
  // recalculé à cet instant) vers le numéro de Yègo. Si le transfert ne peut
  // pas partir (solde Jèko, opérateur…), la demande reste en attente.
  async approuverDemande(id: number, moyen: MoyenEncaissementYego, ctx: ActeurContexte) {
    const demande = await this.demandeEnAttente(id);
    await this.creer(demande.compagnieId, moyen, ctx, demande.montantDemande);
    return this.prisma.demandeReversement.findUniqueOrThrow({
      where: { id },
      include: { reversement: true },
    });
  }

  async rejeterDemande(id: number, motif: string, ctx: ActeurContexte) {
    const demande = await this.demandeEnAttente(id);
    const maj = await this.prisma.demandeReversement.update({
      where: { id },
      data: {
        statut: 'rejetee',
        motifRejet: motif,
        traiteParId: ctx.userId,
        dateTraitement: new Date(),
      },
    });
    await this.notifierGestionnaires(demande.compagnieId, {
      type: 'reversement.rejete',
      titre: 'Demande de reversement rejetée',
      corps: motif,
      donnees: { compagnieId: demande.compagnieId, demandeId: id },
    });
    await this.audit.record({
      action: 'reversement.demande_rejetee',
      entite: 'demande_reversement',
      entiteId: id,
      acteurId: ctx.userId,
      acteurRole: ctx.role,
      ip: ctx.ip,
      metadata: { compagnieId: demande.compagnieId, motif },
    });
    return maj;
  }

  // La compagnie retire sa propre demande tant qu'elle n'est pas traitée.
  async annulerDemande(id: number, user: AuthenticatedUser) {
    const demande = await this.demandeEnAttente(id);
    assertCompagnieScope(user, demande.compagnieId);
    return this.prisma.demandeReversement.update({
      where: { id },
      data: { statut: 'annulee', traiteParId: user.userId, dateTraitement: new Date() },
    });
  }

  // L'admin déclare avoir remis l'argent à la compagnie (en main propre, hors
  // système). Seulement une fois les fonds arrivés sur le numéro de Yègo :
  // un transfert encore en cours peut échouer et libérer les paiements.
  async marquerRemis(id: number, note: string | undefined, ctx: ActeurContexte) {
    const rev = await this.prisma.reversement.findUnique({ where: { id } });
    if (!rev) throw new NotFoundException(`Reversement ${id} introuvable`);
    if (rev.remisLe) throw new ConflictException('Reversement déjà remis à la compagnie');
    if (rev.statut !== 'effectue') {
      throw new BadRequestException(
        `Les fonds ne sont pas encore arrivés sur le numéro de Yègo (statut ${rev.statut})`,
      );
    }
    const verrou = await this.prisma.reversement.updateMany({
      where: { id, remisLe: null },
      data: { remisLe: new Date(), remisParId: ctx.userId, remiseNote: note },
    });
    if (verrou.count === 0) throw new ConflictException('Reversement déjà remis à la compagnie');

    await this.notifierGestionnaires(rev.compagnieId, {
      type: 'reversement.remis',
      titre: 'Reversement remis',
      corps: `Yègo vous a remis ${rev.montantNet} FCFA.`,
      donnees: { compagnieId: rev.compagnieId, reversementId: id },
    });
    await this.audit.record({
      action: 'reversement.remis',
      entite: 'reversement',
      entiteId: id,
      acteurId: ctx.userId,
      acteurRole: ctx.role,
      ip: ctx.ip,
      metadata: { compagnieId: rev.compagnieId, montantNet: rev.montantNet.toString(), note },
    });
    return this.prisma.reversement.findUniqueOrThrow({ where: { id } });
  }

  private async demandeEnAttente(id: number) {
    const demande = await this.prisma.demandeReversement.findUnique({ where: { id } });
    if (!demande) throw new NotFoundException(`Demande de reversement ${id} introuvable`);
    if (demande.statut !== 'en_attente') {
      throw new ConflictException(`Demande déjà traitée (${demande.statut})`);
    }
    return demande;
  }

  private async notifierGestionnaires(compagnieId: number, notif: Notif) {
    const gestionnaires = await this.prisma.utilisateur.findMany({
      where: { role: UserRole.COMPANY_ADMIN, compagnieId, actif: true },
      select: { id: true },
    });
    for (const g of gestionnaires) await this.notifications.notifier(g.id, notif);
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
      // Fonds arrivés sur le numéro de Yègo : la compagnie sait que la remise
      // en main propre va suivre.
      await this.notifierGestionnaires(rev.compagnieId, {
        type: 'reversement.pret',
        titre: 'Reversement prêt',
        corps: `Votre reversement de ${rev.montantNet} FCFA est prêt : Yègo va vous le remettre.`,
        donnees: { compagnieId: rev.compagnieId, reversementId: id },
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
    const parAdmin = user.role === UserRole.ADMIN;
    const maj = await this.prisma.compagnie.update({
      where: { id: compagnieId },
      data: {
        reversementMoyen: dto.moyen,
        reversementTelephone: dto.telephone,
        jekoContactId: null,
        reversementCoordonneesModifieesLe: parAdmin ? null : new Date(),
      },
    });
    if (!parAdmin) {
      const admins = await this.prisma.utilisateur.findMany({
        where: { role: UserRole.ADMIN, actif: true },
        select: { id: true },
      });
      for (const a of admins) {
        await this.notifications.notifier(a.id, {
          type: 'reversement.coordonnees_modifiees',
          titre: 'Compte de reversement modifié',
          corps: `${avant.nom} a changé son numéro Mobile Money (${dto.moyen} ${dto.telephone}).`,
          donnees: { compagnieId },
        });
      }
    }
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
    filtres: {
      compagnieId?: number;
      statut?: string;
      aRemettre?: string;
      skip?: number;
      take?: number;
    },
  ) {
    const where: Prisma.ReversementWhereInput = {};
    if (filtres.aRemettre === 'true') Object.assign(where, { statut: 'effectue', remisLe: null });
    if (filtres.aRemettre === 'false') where.remisLe = { not: null };
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

  // plafondNet : montant demandé par la compagnie — billets entiers, les plus
  // anciens d'abord, tant que le net cumulé ne le dépasse pas.
  private async calculerLot(compagnieId: number, plafondNet?: Prisma.Decimal): Promise<Lot> {
    const debutDuJour = this.debutDuJour();
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
      const brutSuivant = montantBrut.plus(part);
      if (
        brutSuivant.greaterThan(PLAFOND_TRANSFERT_FCFA) ||
        (plafondNet != null && brutSuivant.minus(this.commissionSur(brutSuivant)).greaterThan(plafondNet))
      ) {
        plafondAtteint = true;
        break;
      }
      paiementIds.push(p.id);
      montantBrut = montantBrut.plus(part);
    }

    const commission = this.commissionSur(montantBrut);
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
  // La demande de la compagnie qui l'avait déclenché repasse en attente :
  // l'admin pourra la réapprouver une fois le problème réglé.
  private async echouer(id: number, motif: string) {
    const [rev, , demandes] = await this.prisma.$transaction([
      this.prisma.reversement.update({
        where: { id },
        data: { statut: 'echoue', motifEchec: motif.slice(0, 500) },
      }),
      this.prisma.paiement.updateMany({
        where: { reversementId: id },
        data: { reversementId: null },
      }),
      this.prisma.demandeReversement.updateMany({
        where: { reversementId: id },
        data: { statut: 'en_attente', reversementId: null, traiteParId: null, dateTraitement: null },
      }),
    ]);
    await this.audit.record({
      action: 'reversement.echoue',
      entite: 'reversement',
      entiteId: id,
      metadata: { motif },
    });
    if (demandes.count > 0) {
      await this.notifierGestionnaires(rev.compagnieId, {
        type: 'reversement.echoue',
        titre: 'Reversement non abouti',
        corps: 'Le reversement n’a pas pu être traité. Votre demande reste en attente, Yègo la relancera.',
        donnees: { compagnieId: rev.compagnieId, reversementId: id },
      });
    }
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

  private debutDuJour(): Date {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
  }

  // Commission arrondie au franc inférieur (pas de centimes en XOF).
  private commissionSur(montantBrut: Prisma.Decimal): Prisma.Decimal {
    return montantBrut.times(this.commissionPourcent()).dividedBy(100).floor();
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

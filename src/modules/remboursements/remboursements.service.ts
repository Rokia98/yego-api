import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  assertCompagnieScope,
  peutVoirRessourceVoyageur,
} from '../../common/scope';
import { UserRole } from '../../config/constants';
import { paginer } from '../../common/pagination';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { JekoService, StatutJeko, erreurJekoVersHttp } from '../jeko/jeko.service';
import { versMoyenJeko } from '../../common/moyens-paiement';
import { CreateRemboursementDto } from './dto/create-remboursement.dto';

export interface ActeurContexte {
  userId: number;
  role?: string;
  ip?: string;
}

const RESERVATION_COMPAGNIE = {
  reservation: {
    include: {
      depart: { include: { trajet: { select: { compagnieId: true } } } },
    },
  },
};

// Champs voyageur sûrs (jamais motDePasseHash / tokenVersion / …).
const UTILISATEUR_SAFE_SELECT = {
  id: true,
  nom: true,
  telephone: true,
  email: true,
  role: true,
};

// Include enrichi pour les listes : identité du voyageur + trajet lisible,
// pour l'affichage back-office (page « remboursements à confirmer »).
const RESERVATION_LISTE = {
  reservation: {
    include: {
      utilisateur: { select: UTILISATEUR_SAFE_SELECT },
      agent: { select: UTILISATEUR_SAFE_SELECT },
      // Le back-office en déduit le bouton à proposer : jekoReference non null
      // = transfert Mobile Money possible vers telephonePayeur.
      paiement: {
        select: {
          id: true,
          moyenPaiement: true,
          jekoReference: true,
          telephonePayeur: true,
          reversementId: true,
        },
      },
      depart: {
        include: {
          trajet: {
            include: {
              villeDepart: { select: { nom: true } },
              villeArrivee: { select: { nom: true } },
              compagnie: { select: { id: true, nom: true } },
            },
          },
        },
      },
    },
  },
};

// Remboursement + ce qu'il faut pour le décaisser (paiement d'origine, voyageur).
const RESERVATION_DECAISSEMENT = {
  reservation: {
    include: {
      paiement: true,
      utilisateur: { select: { nom: true } },
      depart: { include: { trajet: { select: { compagnieId: true } } } },
    },
  },
};

type RemboursementADecaisser = Prisma.RemboursementGetPayload<{
  include: typeof RESERVATION_DECAISSEMENT;
}>;

@Injectable()
export class RemboursementsService {
  private readonly logger = new Logger(RemboursementsService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private jeko: JekoService,
  ) {}

  // montantRembourse est recalculé côté serveur à partir du montant réellement
  // payé (jamais fourni par le client).
  async create(
    dto: CreateRemboursementDto,
    user: AuthenticatedUser,
    ctx?: ActeurContexte,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: dto.reservationId },
      include: {
        paiement: true,
        depart: { include: { trajet: { select: { compagnieId: true } } } },
      },
    });

    if (!reservation) throw new NotFoundException('Réservation introuvable');
    assertCompagnieScope(user, reservation.depart.trajet.compagnieId);
    // Rembourser une réservation encore valide = rembourser un voyage que le
    // passager peut toujours faire : on exige l'annulation au préalable.
    if (reservation.statut !== 'annulee') {
      throw new BadRequestException(
        "Annulez d'abord la réservation (PATCH /reservations/:id/annuler)",
      );
    }
    if (!reservation.paiement || reservation.paiement.statut !== 'paye') {
      throw new BadRequestException(
        'Cette réservation n\'a pas de paiement confirmé à rembourser',
      );
    }

    const existant = await this.prisma.remboursement.findUnique({
      where: { reservationId: dto.reservationId },
    });
    if (existant) {
      throw new BadRequestException(
        'Un remboursement existe déjà pour cette réservation',
      );
    }

    const fraisRetenus = new Prisma.Decimal(dto.fraisRetenus ?? 0);
    if (fraisRetenus.greaterThan(reservation.paiement.montant)) {
      throw new BadRequestException(
        'Les frais retenus ne peuvent pas dépasser le montant payé',
      );
    }
    const montantRembourse = reservation.paiement.montant.minus(fraisRetenus);

    const remboursement = await this.prisma.remboursement.create({
      data: {
        reservationId: dto.reservationId,
        montantRembourse,
        fraisRetenus,
        statut: 'en_attente',
      },
    });

    await this.audit.record({
      action: 'remboursement.demande',
      entite: 'remboursement',
      entiteId: remboursement.id,
      acteurId: ctx?.userId ?? user.userId,
      acteurRole: ctx?.role ?? user.role,
      ip: ctx?.ip,
      metadata: {
        reservationId: dto.reservationId,
        montantRembourse: montantRembourse.toString(),
        fraisRetenus: String(fraisRetenus),
      },
    });

    return remboursement;
  }

  // Confirmation : company_admin de la compagnie concernée, ou admin.
  // Paiement encaissé via Jèko → transfert automatique vers le numéro qui a
  // payé (statut 'en_cours', soldé par webhook / réconciliation). Sinon (ou
  // mode 'manuel') → on constate un décaissement fait hors plateforme.
  async confirmer(
    id: number,
    user: AuthenticatedUser,
    ctx?: ActeurContexte,
    mode?: 'jeko' | 'manuel',
  ) {
    const remboursement = await this.prisma.remboursement.findUnique({
      where: { id },
      include: RESERVATION_DECAISSEMENT,
    });
    if (!remboursement) {
      throw new NotFoundException(`Remboursement ${id} introuvable`);
    }
    assertCompagnieScope(
      user,
      remboursement.reservation.depart.trajet.compagnieId,
    );
    if (remboursement.statut === 'rembourse') {
      throw new BadRequestException('Ce remboursement est déjà confirmé');
    }
    if (remboursement.statut === 'en_cours') {
      throw new ConflictException(
        'Un transfert de remboursement est déjà en cours',
      );
    }
    if (remboursement.reservation.statut !== 'annulee') {
      throw new BadRequestException(
        "La réservation n'est pas annulée : rien à rembourser",
      );
    }

    const paiement = remboursement.reservation.paiement;
    const possibleViaJeko =
      this.jeko.estConfigure() &&
      !!paiement?.jekoReference &&
      remboursement.montantRembourse.greaterThan(0);
    const modeEffectif = mode ?? (possibleViaJeko ? 'jeko' : 'manuel');

    if (modeEffectif === 'jeko') {
      if (!possibleViaJeko) {
        throw new BadRequestException(
          "Remboursement Jèko impossible : le paiement n'a pas été encaissé en ligne via Jèko (ou rien à rembourser)",
        );
      }
      return this.transfererRemboursement(remboursement, ctx);
    }

    return this.finaliser(remboursement, ctx, 'manuel');
  }

  // Transfert Jèko du montant remboursé vers le numéro qui a payé. Le
  // bénéficiaire est imposé par le paiement d'origine : la compagnie ne peut
  // pas le choisir.
  private async transfererRemboursement(
    remboursement: RemboursementADecaisser,
    ctx?: ActeurContexte,
  ) {
    const paiement = remboursement.reservation.paiement!;
    if (paiement.reversementId != null) {
      throw new BadRequestException(
        'Ce paiement a déjà été reversé à la compagnie : remboursement à régulariser manuellement',
      );
    }
    const moyen = versMoyenJeko(paiement.moyenPaiement);
    if (!moyen || !paiement.telephonePayeur) {
      throw new BadRequestException(
        'Numéro ou moyen du payeur inconnu : remboursez en mode manuel',
      );
    }

    // Verrou : un seul transfert à la fois (en_attente | echoue → en_cours).
    const verrou = await this.prisma.remboursement.updateMany({
      where: { id: remboursement.id, statut: { in: ['en_attente', 'echoue'] } },
      data: {
        statut: 'en_cours',
        motifEchec: null,
        jekoTentatives: { increment: 1 },
      },
    });
    if (verrou.count === 0) {
      throw new ConflictException('Le remboursement a changé d’état, réessayez');
    }
    const { jekoTentatives } = await this.prisma.remboursement.findUniqueOrThrow({
      where: { id: remboursement.id },
      select: { jekoTentatives: true },
    });
    const reference = `YEGO-RB${remboursement.id}-T${jekoTentatives}`;

    let transfert;
    try {
      const contactId = await this.jeko.creerContact({
        nom:
          remboursement.reservation.utilisateur?.nom ??
          remboursement.reservation.passagerNom ??
          'Voyageur Yègo',
        moyen,
        telephone: paiement.telephonePayeur,
      });
      transfert = await this.jeko.creerTransfert({
        contactId,
        montantFcfa: remboursement.montantRembourse.toNumber(),
        reference,
        description: `Remboursement Yègo réservation #${remboursement.reservationId}`,
      });
    } catch (err) {
      await this.prisma.remboursement.update({
        where: { id: remboursement.id },
        data: {
          statut: 'echoue',
          jekoReference: reference,
          motifEchec: (err as Error).message.slice(0, 500),
        },
      });
      erreurJekoVersHttp(err, 'Remboursement');
    }

    await this.prisma.remboursement.update({
      where: { id: remboursement.id },
      data: { jekoTransferId: transfert.id, jekoReference: reference },
    });
    await this.audit.record({
      action: 'remboursement.transfert_initie',
      entite: 'remboursement',
      entiteId: remboursement.id,
      acteurId: ctx?.userId,
      acteurRole: ctx?.role,
      ip: ctx?.ip,
      metadata: {
        reservationId: remboursement.reservationId,
        montantRembourse: remboursement.montantRembourse.toString(),
        reference,
        jekoTransferId: transfert.id,
      },
    });

    if (transfert.status !== 'pending') {
      await this.appliquerResultatTransfert(remboursement.id, transfert.status, {
        transferId: transfert.id,
      });
    }
    return this.prisma.remboursement.findUniqueOrThrow({
      where: { id: remboursement.id },
    });
  }

  // Issue d'un transfert de remboursement (webhook Jèko ou réconciliation).
  // Idempotent : ignoré si le remboursement n'est plus 'en_cours'.
  async appliquerResultatTransfert(
    id: number,
    statut: StatutJeko,
    details: { transferId?: string; motif?: string } = {},
  ) {
    if (statut === 'pending') return;
    const remboursement = await this.prisma.remboursement.findUnique({
      where: { id },
      include: RESERVATION_DECAISSEMENT,
    });
    if (!remboursement || remboursement.statut !== 'en_cours') return;
    if (
      details.transferId &&
      remboursement.jekoTransferId &&
      details.transferId !== remboursement.jekoTransferId
    ) {
      this.logger.warn(
        `Transfert ${details.transferId} ignoré : le remboursement ${id} suit ${remboursement.jekoTransferId}`,
      );
      return;
    }

    if (statut === 'success') {
      await this.finaliser(remboursement, undefined, 'jeko');
      return;
    }

    await this.prisma.remboursement.updateMany({
      where: { id, statut: 'en_cours' },
      data: { statut: 'echoue', motifEchec: details.motif ?? 'Transfert refusé par l’opérateur' },
    });
    await this.audit.record({
      action: 'remboursement.transfert_echoue',
      entite: 'remboursement',
      entiteId: id,
      metadata: {
        reservationId: remboursement.reservationId,
        jekoTransferId: remboursement.jekoTransferId,
        motif: details.motif,
      },
    });
  }

  // Réconciliation : interroge Jèko sur un transfert resté 'en_cours'.
  async synchroniserTransfert(remboursement: { id: number; jekoTransferId: string | null }) {
    if (!remboursement.jekoTransferId) return;
    const transfert = await this.jeko.lireTransfert(remboursement.jekoTransferId);
    await this.appliquerResultatTransfert(remboursement.id, transfert.status, {
      transferId: transfert.id,
    });
  }

  // Décaissement constaté : remboursement soldé + paiement d'origine remboursé.
  private async finaliser(
    remboursement: RemboursementADecaisser,
    ctx: ActeurContexte | undefined,
    via: 'jeko' | 'manuel',
  ) {
    const id = remboursement.id;
    const [maj] = await this.prisma.$transaction([
      this.prisma.remboursement.update({
        where: { id },
        data: { statut: 'rembourse', dateRemboursement: new Date(), motifEchec: null },
      }),
      this.prisma.paiement.updateMany({
        where: { reservationId: remboursement.reservationId, statut: 'paye' },
        data: { statut: 'rembourse' },
      }),
    ]);

    await this.audit.record({
      action: 'remboursement.confirme',
      entite: 'remboursement',
      entiteId: id,
      acteurId: ctx?.userId,
      acteurRole: ctx?.role,
      ip: ctx?.ip,
      metadata: {
        reservationId: remboursement.reservationId,
        montantRembourse: remboursement.montantRembourse.toString(),
        via,
      },
    });

    await this.notifications.notifier(remboursement.reservation.utilisateurId, {
      type: 'remboursement.effectue',
      titre: 'Remboursement effectué',
      corps:
        via === 'jeko'
          ? `${remboursement.montantRembourse} FCFA ont été renvoyés sur votre Mobile Money.`
          : `${remboursement.montantRembourse} FCFA vous ont été remboursés.`,
      donnees: { remboursementId: id, reservationId: remboursement.reservationId },
    });

    return maj;
  }

  // Voyageur → les siens · agent / company_admin → ceux de leur compagnie ·
  // admin → tous.
  findAllScoped(user: AuthenticatedUser, skip = 0, take = 10) {
    return this.prisma.remboursement.findMany({
      where: this.filtrePortee(user),
      ...paginer(skip, take),
      include: RESERVATION_LISTE,
      orderBy: { dateDemande: 'desc' },
    });
  }

  findByStatutScoped(
    statut: string,
    user: AuthenticatedUser,
    skip = 0,
    take = 10,
  ) {
    return this.prisma.remboursement.findMany({
      where: { statut, ...this.filtrePortee(user) },
      ...paginer(skip, take),
      include: RESERVATION_LISTE,
      orderBy: { dateDemande: 'desc' },
    });
  }

  async findByReservation(reservationId: number, user: AuthenticatedUser) {
    const remboursement = await this.prisma.remboursement.findUnique({
      where: { reservationId },
      include: RESERVATION_COMPAGNIE,
    });
    if (!remboursement) throw new NotFoundException('Remboursement introuvable');
    this.assertAcces(remboursement, user);
    return remboursement;
  }

  async findOne(id: number, user: AuthenticatedUser) {
    const remboursement = await this.prisma.remboursement.findUnique({
      where: { id },
      include: RESERVATION_COMPAGNIE,
    });
    if (!remboursement) {
      throw new NotFoundException(`Remboursement ${id} introuvable`);
    }
    this.assertAcces(remboursement, user);
    return remboursement;
  }

  private assertAcces(
    remboursement: {
      reservation: {
        utilisateurId: number | null;
        depart: { trajet: { compagnieId: number } };
      };
    },
    user: AuthenticatedUser,
  ) {
    if (
      !peutVoirRessourceVoyageur(
        user,
        remboursement.reservation.utilisateurId,
        remboursement.reservation.depart.trajet.compagnieId,
      )
    ) {
      throw new ForbiddenException("Vous n'avez pas accès à ce remboursement");
    }
  }

  private filtrePortee(user: AuthenticatedUser): Prisma.RemboursementWhereInput {
    if (user.role === UserRole.ADMIN) return {};
    if (
      (user.role === UserRole.AGENT || user.role === UserRole.COMPANY_ADMIN) &&
      user.compagnieId != null
    ) {
      return {
        reservation: {
          depart: { trajet: { compagnieId: user.compagnieId } },
        },
      };
    }
    return { reservation: { utilisateurId: user.userId } };
  }
}

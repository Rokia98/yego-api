import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  FRAIS_ANNULATION,
  FRAIS_ANNULATION_DEPART_PASSE,
  ReservationStatut,
  UserRole,
} from '../../config/constants';
import { assertCompagnieScope, peutVoirRessourceVoyageur } from '../../common/scope';
import { assertCompagnieOperationnelle } from '../../common/compagnie';
import { paginer } from '../../common/pagination';
import { siegesOccupesDepart } from '../../common/sieges';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { CreateReservationGuichetDto } from './dto/create-reservation-guichet.dto';

// Champs sûrs à exposer : on ne renvoie jamais motDePasseHash / etc.
const UTILISATEUR_SAFE_SELECT = {
  id: true,
  nom: true,
  telephone: true,
  email: true,
  role: true,
  dateCreation: true,
};

const RESERVATION_INCLUDE = {
  depart: {
    include: {
      trajet: { include: { villeDepart: true, villeArrivee: true, compagnie: true } },
    },
  },
  utilisateur: { select: UTILISATEUR_SAFE_SELECT },
  agent: { select: UTILISATEUR_SAFE_SELECT },
  tickets: true,
  paiement: true,
};

@Injectable()
export class ReservationsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  // Réservation en ligne : le voyageur réserve pour lui-même (utilisateurId
  // vient du JWT, jamais du body).
  async create(dto: CreateReservationDto, utilisateurId: number) {
    const departInfo = await this.prisma.depart.findUnique({
      where: { id: dto.departId },
      select: { statut: true, trajet: { select: { statut: true, compagnieId: true } } },
    });
    if (!departInfo) throw new NotFoundException('Départ introuvable');
    if (departInfo.statut !== 'planifie' || departInfo.trajet.statut !== 'actif') {
      throw new BadRequestException("Ce départ n'est pas ouvert à la réservation");
    }
    await assertCompagnieOperationnelle(this.prisma, departInfo.trajet.compagnieId);

    const reservation = await this.prisma.$transaction(async (tx) => {
      const depart = await tx.depart.findUnique({ where: { id: dto.departId } });
      if (!depart) throw new NotFoundException('Départ introuvable');
      if (depart.placesDisponibles < dto.nombrePlaces) {
        throw new BadRequestException('Places insuffisantes pour ce départ');
      }

      const sieges = await this.assertSiegesLibres(
        tx,
        dto.departId,
        dto.nombrePlaces,
        dto.sieges,
      );

      await tx.depart.update({
        where: { id: dto.departId },
        data: { placesDisponibles: { decrement: dto.nombrePlaces } },
      });

      return tx.reservation.create({
        data: {
          departId: dto.departId,
          nombrePlaces: dto.nombrePlaces,
          canal: 'en_ligne',
          utilisateurId,
          sieges,
        },
        include: RESERVATION_INCLUDE,
      });
    });

    const t = reservation.depart.trajet;
    await this.notifications.notifier(utilisateurId, {
      type: 'reservation.confirmee',
      titre: 'Réservation confirmée',
      corps: `${t.villeDepart.nom} → ${t.villeArrivee.nom}, ${dto.nombrePlaces} place(s). Réglez pour recevoir votre ticket.`,
      donnees: { reservationId: reservation.id, departId: dto.departId },
    });

    return reservation;
  }

  // Réservation au guichet : un agent (ou company_admin) inscrit un voyageur
  // qui se présente au comptoir. Pas de compte créé — seuls le nom et le
  // téléphone du passager sont enregistrés sur la réservation.
  // Encaissement espèces optionnel dans la même transaction.
  async creerAuGuichet(dto: CreateReservationGuichetDto, agent: AuthenticatedUser) {
    const departInfo = await this.prisma.depart.findUnique({
      where: { id: dto.departId },
      select: { trajet: { select: { compagnieId: true } } },
    });
    if (!departInfo) throw new NotFoundException('Départ introuvable');
    assertCompagnieScope(agent, departInfo.trajet.compagnieId);
    await assertCompagnieOperationnelle(this.prisma, departInfo.trajet.compagnieId);

    const resultat = await this.prisma.$transaction(async (tx) => {
      const depart = await tx.depart.findUnique({
        where: { id: dto.departId },
        include: { trajet: { select: { compagnieId: true, prix: true } } },
      });
      if (!depart) throw new NotFoundException('Départ introuvable');

      if (depart.placesDisponibles < dto.nombrePlaces) {
        throw new BadRequestException('Places insuffisantes pour ce départ');
      }

      const sieges = await this.assertSiegesLibres(
        tx,
        dto.departId,
        dto.nombrePlaces,
        dto.sieges,
      );

      await tx.depart.update({
        where: { id: dto.departId },
        data: { placesDisponibles: { decrement: dto.nombrePlaces } },
      });

      const reservation = await tx.reservation.create({
        data: {
          departId: dto.departId,
          nombrePlaces: dto.nombrePlaces,
          canal: 'guichet',
          utilisateurId: null,
          agentId: agent.userId,
          passagerNom: dto.passager.nom,
          passagerTelephone: dto.passager.telephone,
          sieges,
        },
        include: RESERVATION_INCLUDE,
      });

      let paiement: Prisma.PaiementGetPayload<object> | null = null;
      if (dto.paiementEspece) {
        const montant = depart.trajet.prix.times(dto.nombrePlaces);
        paiement = await tx.paiement.create({
          data: {
            reservationId: reservation.id,
            montant,
            moyenPaiement: 'espece',
            statut: 'paye',
            datePaiement: new Date(),
          },
        });
      }

      return { reservation, paiement };
    });

    await this.audit.record({
      action: 'reservation.guichet',
      entite: 'reservation',
      entiteId: resultat.reservation.id,
      acteurId: agent.userId,
      acteurRole: agent.role,
      metadata: {
        departId: dto.departId,
        passager: dto.passager.nom,
        nombrePlaces: dto.nombrePlaces,
        paiementEspece: !!dto.paiementEspece,
      },
    });

    return { ...resultat.reservation, paiement: resultat.paiement };
  }

  // Liste cloisonnée : voyageur -> ses réservations ; agent / company_admin ->
  // celles de leur compagnie ; admin plateforme -> toutes.
  findAllScoped(user: AuthenticatedUser, skip = 0, take = 10) {
    return this.prisma.reservation.findMany({
      where: this.filtrePortee(user),
      ...paginer(skip, take),
      include: RESERVATION_INCLUDE,
      orderBy: { dateReservation: 'desc' },
    });
  }

  async findOne(id: number, user: AuthenticatedUser) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: RESERVATION_INCLUDE,
    });
    if (!reservation) throw new NotFoundException('Réservation introuvable');
    if (!this.peutVoir(reservation, user)) {
      throw new ForbiddenException("Vous n'avez pas accès à cette réservation");
    }
    return reservation;
  }

  // Annule une réservation : libère les places, et si elle était payée, crée
  // automatiquement une demande de remboursement (frais retenus selon le délai
  // avant le départ). Le décaissement reste à confirmer par la compagnie.
  async annuler(id: number, user: AuthenticatedUser) {
    const resultat = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { id },
        include: {
          paiement: true,
          remboursement: true,
          depart: {
            include: { trajet: { select: { compagnieId: true, heureDepart: true } } },
          },
        },
      });
      if (!reservation) throw new NotFoundException('Réservation introuvable');
      if (!this.peutVoir(reservation, user)) {
        throw new ForbiddenException(
          "Vous ne pouvez annuler que vos propres réservations",
        );
      }
      if (reservation.statut === ReservationStatut.ANNULEE) {
        throw new BadRequestException('Réservation déjà annulée');
      }
      if (reservation.statut === ReservationStatut.EXPIREE) {
        throw new BadRequestException('Réservation expirée (non payée à temps)');
      }

      await tx.depart.update({
        where: { id: reservation.departId },
        data: { placesDisponibles: { increment: reservation.nombrePlaces } },
      });
      const maj = await tx.reservation.update({
        where: { id },
        data: { statut: ReservationStatut.ANNULEE },
      });

      // Remboursement automatique si payée et pas déjà en cours.
      let remboursement = null;
      if (
        reservation.paiement?.statut === 'paye' &&
        !reservation.remboursement
      ) {
        const montantPaye = reservation.paiement.montant;
        const fraction = this.fractionFrais(
          reservation.depart.dateDepart,
          reservation.depart.trajet.heureDepart,
        );
        const fraisRetenus = montantPaye.mul(fraction).toDecimalPlaces(2);
        const montantRembourse = montantPaye.minus(fraisRetenus);

        if (montantRembourse.greaterThan(0)) {
          remboursement = await tx.remboursement.create({
            data: {
              reservationId: id,
              montantRembourse,
              fraisRetenus,
              statut: 'en_attente',
            },
          });
        }
      }

      return {
        reservation: maj,
        remboursement,
        utilisateurId: reservation.utilisateurId,
      };
    });

    await this.audit.record({
      action: 'reservation.annulation',
      entite: 'reservation',
      entiteId: id,
      acteurId: user.userId,
      acteurRole: user.role,
      metadata: {
        remboursementCree: !!resultat.remboursement,
        montantRembourse: resultat.remboursement?.montantRembourse.toString(),
      },
    });

    await this.notifications.notifier(resultat.utilisateurId, {
      type: 'reservation.annulee',
      titre: 'Réservation annulée',
      corps: resultat.remboursement
        ? `Un remboursement de ${resultat.remboursement.montantRembourse} FCFA est en cours de traitement.`
        : 'Votre réservation a été annulée.',
      donnees: { reservationId: id },
    });

    return { ...resultat.reservation, remboursement: resultat.remboursement };
  }

  // Valide les sièges choisis avant paiement : soit aucun (placement libre),
  // soit exactement `nombrePlaces` sièges, tous libres sur ce départ.
  // Renvoie la liste à stocker sur la réservation.
  private async assertSiegesLibres(
    tx: Prisma.TransactionClient,
    departId: number,
    nombrePlaces: number,
    sieges: string[] | undefined,
  ): Promise<string[]> {
    if (!sieges || sieges.length === 0) return [];
    if (sieges.length !== nombrePlaces) {
      throw new BadRequestException(
        `Indiquez exactement ${nombrePlaces} siège(s), ou aucun`,
      );
    }
    const occupes = await siegesOccupesDepart(tx, departId);
    const collisions = sieges.filter((s) => occupes.has(s));
    if (collisions.length > 0) {
      throw new ConflictException(
        `Siège(s) déjà pris sur ce départ : ${collisions.join(', ')}`,
      );
    }
    return sieges;
  }

  // Fraction du montant retenue en frais selon le nombre de jours avant le départ.
  private fractionFrais(dateDepart: Date, heureDepart: Date): number {
    const depart = new Date(dateDepart);
    depart.setUTCHours(
      heureDepart.getUTCHours(),
      heureDepart.getUTCMinutes(),
      0,
      0,
    );
    const maintenant = new Date();
    if (depart.getTime() <= maintenant.getTime()) {
      return FRAIS_ANNULATION_DEPART_PASSE;
    }
    const jours = Math.floor(
      (depart.getTime() - maintenant.getTime()) / 86_400_000,
    );
    const regle = FRAIS_ANNULATION.find((r) => jours >= r.joursMin);
    return regle ? regle.fraction : 0.5;
  }

  count() {
    return this.prisma.reservation.count();
  }

  private filtrePortee(user: AuthenticatedUser): Prisma.ReservationWhereInput {
    if (user.role === UserRole.ADMIN) return {};
    if (
      (user.role === UserRole.AGENT || user.role === UserRole.COMPANY_ADMIN) &&
      user.compagnieId != null
    ) {
      return { depart: { trajet: { compagnieId: user.compagnieId } } };
    }
    return { utilisateurId: user.userId };
  }

  private peutVoir(
    reservation: {
      utilisateurId: number | null;
      depart: { trajet: { compagnieId: number } };
    },
    user: AuthenticatedUser,
  ): boolean {
    return peutVoirRessourceVoyageur(
      user,
      reservation.utilisateurId,
      reservation.depart.trajet.compagnieId,
    );
  }
}

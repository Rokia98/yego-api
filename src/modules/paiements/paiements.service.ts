import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  assertCompagnieScope,
  peutVoirRessourceVoyageur,
} from '../../common/scope';
import { paginer } from '../../common/pagination';
import { UserRole } from '../../config/constants';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreatePaiementDto } from './dto/create-paiement.dto';
import { CreatePaiementGuichetDto } from './dto/create-paiement-guichet.dto';
import { UpdatePaiementDto } from './dto/update-paiement.dto';

const RESERVATION_COMPAGNIE = {
  reservation: {
    include: {
      depart: { include: { trajet: { select: { compagnieId: true } } } },
    },
  },
};

@Injectable()
export class PaiementsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  // NOTE: en production, ceci déclenche l'appel à l'API du fournisseur
  // mobile money (Orange Money / MTN Money / Moov Money / Wave), puis
  // met à jour le statut via callback/webhook plutôt qu'en synchrone.
  //
  // Sécurité : le montant n'est jamais pris depuis le body du client, il
  // est recalculé à partir du prix du trajet de la réservation, sinon un
  // client pourrait payer 1 FCFA pour n'importe quel trajet.
  // Initie (ou relance) le paiement en ligne d'une réservation. Idempotent :
  // s'il existe déjà un paiement 'en_attente' ou 'echoue' pour la réservation,
  // on le réutilise (mise à jour du moyen + retour en 'en_attente') plutôt que
  // d'échouer sur la contrainte d'unicité — un paiement échoué n'est donc pas
  // un cul-de-sac.
  async create(dto: CreatePaiementDto, requestingUserId: number) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: dto.reservationId },
      include: { depart: { include: { trajet: true } }, paiement: true },
    });

    if (!reservation) {
      throw new NotFoundException('Réservation introuvable');
    }
    if (reservation.utilisateurId !== requestingUserId) {
      throw new ForbiddenException("Vous ne pouvez payer que vos propres réservations");
    }
    if (reservation.statut !== 'confirmee') {
      throw new BadRequestException('Cette réservation est annulée ou expirée');
    }

    const montant = reservation.depart.trajet.prix.times(reservation.nombrePlaces);

    const existant = reservation.paiement;
    if (existant) {
      if (existant.statut === 'paye') {
        throw new BadRequestException('Cette réservation est déjà payée');
      }
      if (existant.statut === 'rembourse') {
        throw new BadRequestException('Cette réservation a été remboursée');
      }
      // 'en_attente' ou 'echoue' → on relance le même paiement.
      return this.prisma.paiement.update({
        where: { reservationId: dto.reservationId },
        data: {
          montant,
          moyenPaiement: dto.moyenPaiement,
          referenceTransaction: dto.referenceTransaction ?? null,
          statut: 'en_attente',
        },
        include: { reservation: true },
      });
    }

    return this.prisma.paiement.create({
      data: {
        reservationId: dto.reservationId,
        montant,
        moyenPaiement: dto.moyenPaiement,
        referenceTransaction: dto.referenceTransaction,
        statut: 'en_attente',
      },
      include: { reservation: true },
    });
  }

  // Encaissement au guichet : un agent / company_admin enregistre un paiement
  // qu'il a reçu au comptoir (espèces ou transfert mobile money confirmé sur
  // place). Le paiement est directement 'paye'. Réservé à la compagnie du départ.
  async encaisserAuGuichet(
    dto: CreatePaiementGuichetDto,
    user: AuthenticatedUser,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: dto.reservationId },
      include: {
        paiement: true,
        depart: { include: { trajet: { select: { compagnieId: true, prix: true } } } },
      },
    });
    if (!reservation) throw new NotFoundException('Réservation introuvable');
    assertCompagnieScope(user, reservation.depart.trajet.compagnieId);
    if (reservation.statut !== 'confirmee') {
      throw new BadRequestException('Cette réservation est annulée ou expirée');
    }
    if (reservation.paiement) {
      throw new BadRequestException(
        'Cette réservation a déjà un paiement enregistré',
      );
    }

    const montant = reservation.depart.trajet.prix.times(reservation.nombrePlaces);
    const paiement = await this.prisma.paiement.create({
      data: {
        reservationId: dto.reservationId,
        montant,
        moyenPaiement: dto.moyenPaiement,
        referenceTransaction: dto.referenceTransaction,
        statut: 'paye',
        datePaiement: new Date(),
      },
      include: { reservation: true },
    });

    await this.audit.record({
      action: 'paiement.guichet',
      entite: 'paiement',
      entiteId: paiement.id,
      acteurId: user.userId,
      acteurRole: user.role,
      metadata: {
        reservationId: dto.reservationId,
        moyenPaiement: dto.moyenPaiement,
        montant: montant.toString(),
      },
    });

    return paiement;
  }

  // Voyageur → ses paiements · agent / company_admin → ceux de leur compagnie ·
  // admin → tous.
  findAllScoped(user: AuthenticatedUser, skip = 0, take = 10) {
    return this.prisma.paiement.findMany({
      where: this.filtrePortee(user),
      ...paginer(skip, take),
      include: { reservation: true },
      orderBy: { datePaiement: 'desc' },
    });
  }

  async findOne(id: number, user: AuthenticatedUser) {
    const paiement = await this.prisma.paiement.findUnique({
      where: { id },
      include: RESERVATION_COMPAGNIE,
    });
    if (!paiement) throw new NotFoundException(`Paiement ${id} introuvable`);
    this.assertAcces(paiement, user);
    return paiement;
  }

  async findByReservation(reservationId: number, user: AuthenticatedUser) {
    const paiement = await this.prisma.paiement.findUnique({
      where: { reservationId },
      include: RESERVATION_COMPAGNIE,
    });
    if (!paiement) throw new NotFoundException('Paiement introuvable');
    this.assertAcces(paiement, user);
    return paiement;
  }

  // Appelé uniquement par le webhook opérateur mobile money, authentifié par
  // secret partagé au niveau du contrôleur (pas par un utilisateur connecté).
  async confirmer(reservationId: number) {
    const paiement = await this.prisma.paiement.update({
      where: { reservationId },
      data: { statut: 'paye', datePaiement: new Date() },
      include: { reservation: true },
    });

    await this.notifications.notifier(paiement.reservation.utilisateurId, {
      type: 'paiement.confirme',
      titre: 'Paiement confirmé',
      corps: 'Votre paiement est reçu. Votre ticket est disponible.',
      donnees: { reservationId, paiementId: paiement.id },
    });

    return paiement;
  }

  // Simulation d'une réponse opérateur mobile money (flag PAYMENT_SIMULATION).
  // Réservé au voyageur propriétaire de la réservation (ou admin). 'succes'
  // rejoint exactement le chemin du webhook (confirmer) ; 'echec' passe le
  // paiement en 'echoue' — la réservation reste réservée et peut être repayée
  // en relançant la simulation avec 'succes'.
  async simuler(
    reservationId: number,
    resultat: 'succes' | 'echec',
    user: AuthenticatedUser,
  ) {
    const paiement = await this.prisma.paiement.findUnique({
      where: { reservationId },
      include: { reservation: true },
    });
    if (!paiement) {
      throw new NotFoundException(
        "Aucun paiement à simuler : créez d'abord le paiement (POST /paiements)",
      );
    }
    if (
      user.role !== UserRole.ADMIN &&
      paiement.reservation.utilisateurId !== user.userId
    ) {
      throw new ForbiddenException(
        'Vous ne pouvez simuler que le paiement de vos propres réservations',
      );
    }
    if (paiement.statut === 'paye') {
      throw new BadRequestException('Ce paiement est déjà confirmé');
    }
    if (paiement.statut === 'rembourse') {
      throw new BadRequestException('Ce paiement a été remboursé');
    }

    if (resultat === 'succes') {
      const confirme = await this.confirmer(reservationId);
      await this.audit.record({
        action: 'paiement.simulation',
        entite: 'paiement',
        entiteId: confirme.id,
        acteurId: user.userId,
        acteurRole: user.role,
        metadata: { reservationId, resultat: 'succes' },
      });
      return confirme;
    }

    const echoue = await this.prisma.paiement.update({
      where: { reservationId },
      data: { statut: 'echoue' },
      include: { reservation: true },
    });
    await this.audit.record({
      action: 'paiement.simulation',
      entite: 'paiement',
      entiteId: echoue.id,
      acteurId: user.userId,
      acteurRole: user.role,
      metadata: { reservationId, resultat: 'echec' },
    });
    await this.notifications.notifier(echoue.reservation.utilisateurId, {
      type: 'paiement.echoue',
      titre: 'Paiement échoué',
      corps: "Votre paiement n'a pas abouti. Vous pouvez réessayer.",
      donnees: { reservationId, paiementId: echoue.id },
    });
    return echoue;
  }

  async update(id: number, dto: UpdatePaiementDto, requestingUserId: number) {
    const paiement = await this.prisma.paiement.findUnique({
      where: { id },
      include: { reservation: true },
    });
    if (!paiement) {
      throw new NotFoundException(`Paiement ${id} introuvable`);
    }
    this.assertOwnership(paiement.reservation.utilisateurId, requestingUserId);
    if (paiement.statut === 'paye') {
      throw new BadRequestException('Impossible de modifier un paiement déjà confirmé');
    }

    return this.prisma.paiement.update({
      where: { id },
      data: dto,
      include: { reservation: true },
    });
  }

  async delete(id: number, requestingUserId: number) {
    const paiement = await this.prisma.paiement.findUnique({
      where: { id },
      include: { reservation: true },
    });
    if (!paiement) {
      throw new NotFoundException(`Paiement ${id} introuvable`);
    }
    this.assertOwnership(paiement.reservation.utilisateurId, requestingUserId);
    if (paiement.statut === 'paye' || paiement.statut === 'rembourse') {
      throw new BadRequestException(
        'Un paiement confirmé ou remboursé ne peut pas être supprimé',
      );
    }

    return this.prisma.paiement.delete({
      where: { id },
    });
  }

  count() {
    return this.prisma.paiement.count();
  }

  private assertOwnership(ownerId: number | null, requestingUserId: number) {
    if (ownerId !== requestingUserId) {
      throw new ForbiddenException("Vous n'avez pas accès à ce paiement");
    }
  }

  private assertAcces(
    paiement: {
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
        paiement.reservation.utilisateurId,
        paiement.reservation.depart.trajet.compagnieId,
      )
    ) {
      throw new ForbiddenException("Vous n'avez pas accès à ce paiement");
    }
  }

  private filtrePortee(user: AuthenticatedUser): Prisma.PaiementWhereInput {
    if (user.role === UserRole.ADMIN) return {};
    if (
      (user.role === UserRole.AGENT || user.role === UserRole.COMPANY_ADMIN) &&
      user.compagnieId != null
    ) {
      return {
        reservation: { depart: { trajet: { compagnieId: user.compagnieId } } },
      };
    }
    return { reservation: { utilisateurId: user.userId } };
  }
}

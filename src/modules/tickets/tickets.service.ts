import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import { UserRole } from '../../config/constants';
import { peutVoirRessourceVoyageur } from '../../common/scope';
import { paginer } from '../../common/pagination';
import { siegesOccupesDepart } from '../../common/sieges';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

export interface ActeurContexte {
  userId: number;
  role?: string;
  compagnieId?: number | null;
  ip?: string;
}

const RESERVATION_AVEC_COMPAGNIE = {
  reservation: {
    include: {
      depart: { include: { trajet: { select: { compagnieId: true } } } },
    },
  },
} satisfies Prisma.TicketInclude;

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // Génère un ticket pour une réservation payée. Accessible au voyageur
  // propriétaire et au personnel (agent / company_admin) de la compagnie.
  async genererPourReservation(
    reservationId: number,
    siege: string | undefined,
    user: AuthenticatedUser,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        paiement: true,
        tickets: {
          where: { statut: { not: 'annule' } },
          select: { siege: true },
        },
        depart: { include: { trajet: { select: { compagnieId: true } } } },
      },
    });
    if (!reservation) throw new NotFoundException('Réservation introuvable');
    this.assertAcces(reservation, user);
    if (reservation.statut !== 'confirmee') {
      throw new BadRequestException(
        'Cette réservation est annulée ou expirée',
      );
    }
    if (!reservation.paiement || reservation.paiement.statut !== 'paye') {
      throw new BadRequestException(
        "Le paiement de cette réservation n'est pas confirmé",
      );
    }
    if (reservation.tickets.length >= reservation.nombrePlaces) {
      throw new BadRequestException(
        `Cette réservation a déjà ${reservation.nombrePlaces} ticket(s) (une par place)`,
      );
    }

    // Sans siège explicite, on prend le prochain siège choisi à la réservation
    // (choix fait avant paiement) qui n'a pas encore de ticket.
    let siegeFinal = siege;
    if (!siegeFinal && reservation.sieges.length > 0) {
      const dejaEmis = new Set(
        reservation.tickets
          .map((t) => t.siege)
          .filter((s): s is string => s !== null),
      );
      siegeFinal = reservation.sieges.find((s) => !dejaEmis.has(s));
    }

    // Un siège ne peut être occupé qu'une fois sur un même départ (tickets +
    // sièges retenus par d'autres réservations). On ignore le choix propre à
    // cette réservation, qu'on est justement en train de matérialiser.
    if (siegeFinal) {
      const occupes = await siegesOccupesDepart(
        this.prisma,
        reservation.departId,
        reservationId,
      );
      if (occupes.has(siegeFinal)) {
        throw new ConflictException(
          `Le siège ${siegeFinal} est déjà attribué sur ce départ`,
        );
      }
    }

    const codeQr = randomUUID();
    return this.prisma.ticket.create({
      data: { reservationId, codeQr, siege: siegeFinal },
      include: { reservation: { include: { depart: true } } },
    });
  }

  async findByReservation(reservationId: number, user: AuthenticatedUser) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { depart: { include: { trajet: { select: { compagnieId: true } } } } },
    });
    if (!reservation) throw new NotFoundException('Réservation introuvable');
    this.assertAcces(reservation, user);

    return this.prisma.ticket.findMany({
      where: { reservationId },
      include: { reservation: { include: { depart: true } } },
    });
  }

  async findOne(id: number, user: AuthenticatedUser) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: RESERVATION_AVEC_COMPAGNIE,
    });
    if (!ticket) throw new NotFoundException(`Ticket ${id} introuvable`);
    this.assertAcces(ticket.reservation, user);
    return ticket;
  }

  // Liste cloisonnée : voyageur -> ses tickets ; personnel -> ceux de leur
  // compagnie ; admin -> tous.
  findAllScoped(user: AuthenticatedUser, skip = 0, take = 10) {
    return this.prisma.ticket.findMany({
      where: this.filtrePortee(user),
      ...paginer(skip, take),
      include: { reservation: { include: { depart: true } } },
      orderBy: { dateCreation: 'desc' },
    });
  }

  // Scanné à l'embarquement par un agent/contrôleur (PermissionsGuard).
  // Un agent/company_admin ne valide que les tickets de SA compagnie ;
  // l'admin plateforme, tous. Chaque tentative est journalisée (audit).
  async valider(codeQr: string, ctx?: ActeurContexte) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { codeQr },
      include: RESERVATION_AVEC_COMPAGNIE,
    });

    if (
      ticket &&
      ctx &&
      ctx.role !== UserRole.ADMIN &&
      ctx.compagnieId != null &&
      ticket.reservation.depart.trajet.compagnieId !== ctx.compagnieId
    ) {
      await this.audit.record({
        action: 'ticket.validation',
        entite: 'ticket',
        entiteId: ticket.id,
        acteurId: ctx.userId,
        acteurRole: ctx.role,
        ip: ctx.ip,
        metadata: { codeQr, resultat: 'refuse_hors_compagnie' },
      });
      throw new ForbiddenException(
        "Ce ticket n'appartient pas à un départ de votre compagnie",
      );
    }

    const journaliser = (resultat: string, ticketId?: number) =>
      this.audit.record({
        action: 'ticket.validation',
        entite: 'ticket',
        entiteId: ticketId ?? null,
        acteurId: ctx?.userId,
        acteurRole: ctx?.role,
        ip: ctx?.ip,
        metadata: { codeQr, resultat },
      });

    if (!ticket) {
      await journaliser('introuvable');
      return { valide: false, message: 'Ticket introuvable' };
    }
    if (ticket.statut === 'utilise') {
      await journaliser('deja_utilise', ticket.id);
      return { valide: false, message: 'Ticket déjà utilisé' };
    }
    if (ticket.statut === 'annule') {
      await journaliser('annule', ticket.id);
      return { valide: false, message: 'Ticket annulé' };
    }

    await this.prisma.ticket.update({
      where: { codeQr },
      data: { statut: 'utilise' },
    });
    await journaliser('valide', ticket.id);
    return { valide: true, message: 'Ticket validé, bon voyage' };
  }

  async annuler(id: number, user: AuthenticatedUser) {
    const ticket = await this.findOne(id, user);
    if (ticket.statut === 'utilise') {
      throw new BadRequestException(
        "Impossible d'annuler un ticket déjà utilisé",
      );
    }
    return this.prisma.ticket.update({
      where: { id },
      data: { statut: 'annule' },
    });
  }

  count() {
    return this.prisma.ticket.count();
  }

  private assertAcces(
    reservation: {
      utilisateurId: number | null;
      depart: { trajet: { compagnieId: number } };
    },
    user: AuthenticatedUser,
  ) {
    if (
      !peutVoirRessourceVoyageur(
        user,
        reservation.utilisateurId,
        reservation.depart.trajet.compagnieId,
      )
    ) {
      throw new ForbiddenException("Vous n'avez pas accès à ce ticket");
    }
  }

  private filtrePortee(user: AuthenticatedUser): Prisma.TicketWhereInput {
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

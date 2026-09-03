import {
  Injectable,
  BadRequestException,
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
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
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

@Injectable()
export class RemboursementsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
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
    if (
      !peutVoirRessourceVoyageur(
        user,
        reservation.utilisateurId,
        reservation.depart.trajet.compagnieId,
      )
    ) {
      throw new ForbiddenException(
        "Vous ne pouvez pas demander de remboursement pour cette réservation",
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

    const fraisRetenus = dto.fraisRetenus || 0;
    if (fraisRetenus > reservation.paiement.montant.toNumber()) {
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

  // Confirmation du virement : company_admin de la compagnie concernée, ou admin.
  async confirmer(id: number, user: AuthenticatedUser, ctx?: ActeurContexte) {
    const remboursement = await this.prisma.remboursement.findUnique({
      where: { id },
      include: RESERVATION_COMPAGNIE,
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

    // Décaissement effectué : on marque aussi le paiement d'origine comme remboursé.
    const [maj] = await this.prisma.$transaction([
      this.prisma.remboursement.update({
        where: { id },
        data: { statut: 'rembourse', dateRemboursement: new Date() },
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
      },
    });

    return maj;
  }

  // Voyageur → les siens · agent / company_admin → ceux de leur compagnie ·
  // admin → tous.
  findAllScoped(user: AuthenticatedUser, skip = 0, take = 10) {
    return this.prisma.remboursement.findMany({
      where: this.filtrePortee(user),
      ...paginer(skip, take),
      include: { reservation: true },
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
      include: { reservation: true },
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

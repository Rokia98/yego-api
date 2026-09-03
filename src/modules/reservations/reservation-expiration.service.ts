import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma.service';
import { ReservationStatut } from '../../config/constants';

/**
 * Libère automatiquement les places des réservations non payées dans le délai
 * imparti (RESERVATION_PAIEMENT_TTL_MINUTES). Sans ça, une réservation en ligne
 * jamais payée bloquerait ses places indéfiniment.
 */
@Injectable()
export class ReservationExpirationService {
  private readonly logger = new Logger(ReservationExpirationService.name);
  private readonly ttlMinutes: number;

  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    this.ttlMinutes = config.get<number>('RESERVATION_PAIEMENT_TTL_MINUTES', 30);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async libererReservationsExpirees(): Promise<number> {
    const seuil = new Date(Date.now() - this.ttlMinutes * 60_000);

    const expirables = await this.prisma.reservation.findMany({
      where: {
        statut: ReservationStatut.CONFIRMEE,
        dateReservation: { lt: seuil },
        OR: [
          { paiement: { is: null } },
          { paiement: { statut: { not: 'paye' } } },
        ],
      },
      select: { id: true, departId: true, nombrePlaces: true },
    });

    let liberees = 0;
    for (const r of expirables) {
      const applique = await this.prisma.$transaction(async (tx) => {
        // updateMany conditionnel : ne fait rien si un autre process a déjà
        // changé le statut entre-temps (idempotent, safe multi-instance).
        const maj = await tx.reservation.updateMany({
          where: { id: r.id, statut: ReservationStatut.CONFIRMEE },
          data: { statut: ReservationStatut.EXPIREE },
        });
        if (maj.count === 0) return false;
        await tx.depart.update({
          where: { id: r.departId },
          data: { placesDisponibles: { increment: r.nombrePlaces } },
        });
        return true;
      });
      if (applique) liberees += 1;
    }

    if (liberees > 0) {
      this.logger.log(
        `${liberees} réservation(s) non payée(s) expirée(s), places libérées.`,
      );
    }
    return liberees;
  }
}

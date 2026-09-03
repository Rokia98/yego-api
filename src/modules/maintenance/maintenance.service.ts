import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Tâches d'entretien périodiques (hors expiration des réservations, gérée
 * par ReservationExpirationService).
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // Passe les abonnements arrivés à échéance de 'actif' à 'expire'.
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async expirerAbonnements(): Promise<number> {
    const res = await this.prisma.abonnement.updateMany({
      where: { statut: 'actif', dateFin: { lt: new Date() } },
      data: { statut: 'expire' },
    });
    if (res.count > 0) {
      this.logger.log(`${res.count} abonnement(s) passé(s) à 'expire'.`);
    }
    return res.count;
  }

  // Purge les refresh tokens expirés ou révoqués depuis plus de 7 jours.
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgerRefreshTokens(): Promise<number> {
    const seuil = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const res = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: seuil } }, { revokedAt: { lt: seuil } }],
      },
    });
    if (res.count > 0) {
      this.logger.log(`${res.count} refresh token(s) purgé(s).`);
    }
    return res.count;
  }

  // Rappel de départ : chaque matin, notifie les voyageurs dont le départ
  // est le lendemain.
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async rappelerDepartsDuLendemain(): Promise<number> {
    const demain = new Date();
    demain.setUTCDate(demain.getUTCDate() + 1);
    const debut = new Date(
      Date.UTC(demain.getUTCFullYear(), demain.getUTCMonth(), demain.getUTCDate()),
    );
    const fin = new Date(debut.getTime() + 24 * 60 * 60 * 1000);

    const reservations = await this.prisma.reservation.findMany({
      where: {
        statut: 'confirmee',
        utilisateurId: { not: null },
        depart: { statut: 'planifie', dateDepart: { gte: debut, lt: fin } },
      },
      select: {
        id: true,
        utilisateurId: true,
        depart: {
          select: {
            id: true,
            trajet: {
              select: {
                heureDepart: true,
                villeDepart: { select: { nom: true } },
                villeArrivee: { select: { nom: true } },
              },
            },
          },
        },
      },
    });

    for (const r of reservations) {
      const t = r.depart.trajet;
      const heure = t.heureDepart.toISOString().slice(11, 16);
      await this.notifications.notifier(r.utilisateurId, {
        type: 'depart.rappel',
        titre: 'Départ demain',
        corps: `${t.villeDepart.nom} → ${t.villeArrivee.nom}, départ à ${heure}. Bon voyage !`,
        donnees: { reservationId: r.id, departId: r.depart.id },
      });
    }

    if (reservations.length > 0) {
      this.logger.log(`${reservations.length} rappel(s) de départ envoyé(s).`);
    }
    return reservations.length;
  }
}

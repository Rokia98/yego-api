import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma.service';

/**
 * Tâches d'entretien périodiques (hors expiration des réservations, gérée
 * par ReservationExpirationService).
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(private prisma: PrismaService) {}

  // Passe les abonnements arrivés à échéance de 'actif' à 'expire'.
  // Le contrôle d'accès filtre déjà sur dateFin, ceci met juste le statut à jour.
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

  // Purge les refresh tokens expirés ou révoqués depuis plus de 7 jours
  // (fenêtre de rétention courte pour l'investigation d'un vol de jeton).
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
}

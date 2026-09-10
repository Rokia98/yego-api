import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SuiviService } from '../suivi/suivi.service';
import { DepartStatut, SUIVI } from '../../config/constants';

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
    private suivi: SuiviService,
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

  // Suivi des départs en cours : notifie les voyageurs d'un retard significatif
  // (ETA vs heure d'arrivée prévue) et clôture les départs oubliés en_route.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async suivreDepartsEnCours(): Promise<{ retards: number; clotures: number }> {
    const enRoute = await this.prisma.depart.findMany({
      where: { statut: DepartStatut.EN_ROUTE },
      include: {
        trajet: {
          include: {
            villeDepart: { select: { nom: true } },
            villeArrivee: {
              select: { nom: true, latitude: true, longitude: true },
            },
          },
        },
      },
    });

    let retards = 0;
    let clotures = 0;

    for (const depart of enRoute) {
      const derniere = await this.prisma.positionDepart.findFirst({
        where: { departId: depart.id },
        orderBy: { mesureA: 'desc' },
      });

      // Clôture de sécurité : parti depuis longtemps et plus aucun signe de vie.
      const partiDepuisH = depart.demarreA
        ? (Date.now() - depart.demarreA.getTime()) / 3_600_000
        : 0;
      const silenceH = derniere
        ? (Date.now() - derniere.mesureA.getTime()) / 3_600_000
        : partiDepuisH;
      if (partiDepuisH > SUIVI.RETENTION_POSITIONS_HEURES && silenceH > 3) {
        await this.prisma.depart.update({
          where: { id: depart.id },
          data: { statut: DepartStatut.ARRIVE, termineA: new Date() },
        });
        clotures++;
        continue;
      }

      const { eta, retard } = this.suivi.calculerEta(depart, derniere);
      if (!eta || !retard) continue;

      // On ne renotifie qu'au franchissement d'un nouveau palier de retard.
      const palier =
        Math.floor(eta.retardMinutes / SUIVI.RETARD_PALIER_MINUTES) *
        SUIVI.RETARD_PALIER_MINUTES;
      if (palier <= depart.retardNotifieMinutes) {
        await this.prisma.depart.update({
          where: { id: depart.id },
          data: { retardMinutes: eta.retardMinutes },
        });
        continue;
      }

      const reservations = await this.prisma.reservation.findMany({
        where: {
          departId: depart.id,
          statut: 'confirmee',
          utilisateurId: { not: null },
        },
        select: { id: true, utilisateurId: true },
      });
      const t = depart.trajet;
      for (const r of reservations) {
        await this.notifications.notifier(r.utilisateurId, {
          type: 'depart.retard',
          titre: 'Retard signalé',
          corps: `${t.villeDepart.nom} → ${t.villeArrivee.nom} : arrivée estimée avec environ ${eta.retardMinutes} min de retard.`,
          donnees: { departId: depart.id, retardMinutes: eta.retardMinutes },
        });
      }

      await this.prisma.depart.update({
        where: { id: depart.id },
        data: {
          retardMinutes: eta.retardMinutes,
          retardNotifieMinutes: palier,
        },
      });
      retards++;
    }

    if (retards > 0 || clotures > 0) {
      this.logger.log(
        `Suivi départs : ${retards} retard(s) notifié(s), ${clotures} clôture(s).`,
      );
    }
    return { retards, clotures };
  }

  // Purge les points GPS des départs terminés depuis plus de N heures.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgerPositions(): Promise<number> {
    const seuil = new Date(
      Date.now() - SUIVI.RETENTION_POSITIONS_HEURES * 3_600_000,
    );
    const res = await this.prisma.positionDepart.deleteMany({
      where: { depart: { statut: DepartStatut.ARRIVE, termineA: { lt: seuil } } },
    });
    if (res.count > 0) {
      this.logger.log(`${res.count} point(s) GPS purgé(s).`);
    }
    return res.count;
  }
}

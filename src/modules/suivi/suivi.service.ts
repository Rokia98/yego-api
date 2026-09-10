import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertCompagnieScope } from '../../common/scope';
import { haversineKm, Point } from '../../common/geo';
import { notifierVoyageursDeparts } from '../../common/notifier-voyageurs';
import { signerSuiviToken } from '../../common/suivi-token';
import { DepartStatut, SUIVI, UserRole } from '../../config/constants';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PositionDto } from './dto/position.dto';

const DEPART_POUR_SUIVI = {
  trajet: {
    include: {
      villeDepart: { select: { nom: true, latitude: true, longitude: true } },
      villeArrivee: { select: { nom: true, latitude: true, longitude: true } },
      compagnie: { select: { id: true, nom: true } },
    },
  },
};

type DepartAvecTrajet = {
  id: number;
  statut: string;
  dateDepart: Date;
  demarreA: Date | null;
  termineA: Date | null;
  retardMinutes: number;
  trajet: {
    compagnieId: number;
    heureDepart: Date;
    heureArriveeEstimee: Date | null;
    villeArrivee: { nom: string; latitude: number | null; longitude: number | null };
  };
};

@Injectable()
export class SuiviService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // Démarre un départ (agent / gestionnaire / admin de la compagnie). Renvoie
  // un jeton de suivi que le téléphone du chauffeur utilisera pour poster ses
  // positions, sans compte.
  async demarrer(departId: number, user: AuthenticatedUser) {
    const depart = await this.chargerDepart(departId);
    assertCompagnieScope(user, depart.trajet.compagnieId);

    if (depart.statut === DepartStatut.EN_ROUTE) {
      throw new ConflictException('Ce départ est déjà en cours');
    }
    if (depart.statut !== DepartStatut.PLANIFIE) {
      throw new BadRequestException(
        `Un départ ${depart.statut} ne peut pas être démarré`,
      );
    }

    const misAJour = await this.prisma.depart.update({
      where: { id: departId },
      data: { statut: DepartStatut.EN_ROUTE, demarreA: new Date() },
      include: DEPART_POUR_SUIVI,
    });

    await this.notifierVoyageurs(departId, {
      type: 'depart.demarre',
      titre: 'Votre car est parti',
      corps: `${misAJour.trajet.villeDepart.nom} → ${misAJour.trajet.villeArrivee.nom} : le départ est en route. Suivez-le en direct.`,
      donnees: { departId },
    });

    const { token, expireA } = signerSuiviToken(
      departId,
      SUIVI.TOKEN_TTL_HEURES * 3600,
    );
    return { depart: misAJour, suiviToken: token, expireA };
  }

  // Enregistre un point GPS. Authentifié par le jeton de suivi (departId du
  // jeton == :id). Réponse minimale (batterie / données du chauffeur).
  async enregistrerPosition(
    departId: number,
    departIdDuToken: number,
    dto: PositionDto,
  ) {
    if (departIdDuToken !== departId) {
      throw new ForbiddenException('Jeton de suivi lié à un autre départ');
    }
    const depart = await this.prisma.depart.findUnique({
      where: { id: departId },
      select: { statut: true },
    });
    if (!depart) throw new NotFoundException(`Départ ${departId} introuvable`);
    if (depart.statut !== DepartStatut.EN_ROUTE) {
      throw new ConflictException(
        `Le départ n'est pas en cours (statut ${depart.statut})`,
      );
    }

    const point = await this.prisma.positionDepart.create({
      data: {
        departId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        vitesse: dto.vitesse ?? null,
        cap: dto.cap ?? null,
        precision: dto.precision ?? null,
        mesureA: dto.mesureA ? new Date(dto.mesureA) : new Date(),
      },
      select: { enregistreA: true },
    });
    return { ok: true, enregistreA: point.enregistreA };
  }

  // Termine un départ, depuis l'app chauffeur (jeton de suivi lié au départ).
  async arriver(departId: number, departIdDuToken: number) {
    if (departIdDuToken !== departId) {
      throw new ForbiddenException('Jeton de suivi lié à un autre départ');
    }
    const depart = await this.chargerDepart(departId);

    if (depart.statut !== DepartStatut.EN_ROUTE) {
      throw new BadRequestException(
        `Seul un départ en cours peut être marqué arrivé (statut ${depart.statut})`,
      );
    }

    const misAJour = await this.prisma.depart.update({
      where: { id: departId },
      data: { statut: DepartStatut.ARRIVE, termineA: new Date() },
      include: DEPART_POUR_SUIVI,
    });

    await this.notifierVoyageurs(departId, {
      type: 'depart.arrive',
      titre: 'Arrivée',
      corps: `${misAJour.trajet.villeArrivee.nom} : le car est arrivé.`,
      donnees: { departId },
    });
    return misAJour;
  }

  // Retard déclaré manuellement par le personnel (utile sans GPS, ou pour un
  // retard connu avant le départ). Notifie les voyageurs.
  async declarerRetard(
    departId: number,
    user: AuthenticatedUser,
    minutesRetard: number,
    motif?: string,
  ) {
    const depart = await this.chargerDepart(departId);
    assertCompagnieScope(user, depart.trajet.compagnieId);

    if (
      depart.statut !== DepartStatut.PLANIFIE &&
      depart.statut !== DepartStatut.EN_ROUTE
    ) {
      throw new BadRequestException(
        `Impossible de déclarer un retard sur un départ ${depart.statut}`,
      );
    }

    const misAJour = await this.prisma.depart.update({
      where: { id: departId },
      data: {
        retardMinutes: minutesRetard,
        // Aligne le palier notifié pour que le cron ne renotifie pas en-dessous.
        retardNotifieMinutes: minutesRetard,
      },
      include: DEPART_POUR_SUIVI,
    });

    await this.notifierVoyageurs(departId, {
      type: 'depart.retard',
      titre: 'Retard annoncé',
      corps:
        `${misAJour.trajet.villeDepart.nom} → ${misAJour.trajet.villeArrivee.nom} : ` +
        `retard d'environ ${minutesRetard} min${motif ? ` (${motif})` : ''}.`,
      donnees: { departId, retardMinutes: minutesRetard },
    });
    return misAJour;
  }

  // Vue de suivi côté voyageur / back-office : dernière position + ETA.
  async suivi(departId: number, user: AuthenticatedUser) {
    const depart = await this.chargerDepart(departId);
    await this.assertPeutSuivre(depart, user);

    const derniere = await this.prisma.positionDepart.findFirst({
      where: { departId },
      orderBy: { mesureA: 'desc' },
    });

    const eta = this.calculerEta(depart, derniere);

    return {
      departId,
      statut: depart.statut,
      demarreA: depart.demarreA,
      termineA: depart.termineA,
      derniere: derniere
        ? {
            latitude: derniere.latitude,
            longitude: derniere.longitude,
            vitesse: derniere.vitesse,
            cap: derniere.cap,
            precision: derniere.precision,
            mesureA: derniere.mesureA,
            ageSecondes: Math.round(
              (Date.now() - derniere.mesureA.getTime()) / 1000,
            ),
            fraiche:
              Date.now() - derniere.mesureA.getTime() <
              SUIVI.POSITION_FRAICHE_SECONDES * 1000,
          }
        : null,
      destination: this.destination(depart),
      heureArriveePrevue: this.arriveePrevue(depart),
      ...eta,
    };
  }

  async historique(
    departId: number,
    user: AuthenticatedUser,
    depuis?: string,
    limite?: number,
  ) {
    const depart = await this.chargerDepart(departId);
    await this.assertPeutSuivre(depart, user);

    const take = Math.min(
      Math.max(1, limite ?? SUIVI.HISTORIQUE_MAX_POINTS),
      SUIVI.HISTORIQUE_MAX_POINTS,
    );
    const points = await this.prisma.positionDepart.findMany({
      where: {
        departId,
        ...(depuis ? { mesureA: { gte: new Date(depuis) } } : {}),
      },
      orderBy: { mesureA: 'asc' },
      take,
      select: {
        latitude: true,
        longitude: true,
        vitesse: true,
        cap: true,
        mesureA: true,
      },
    });
    return { departId, points };
  }

  // --- ETA / retard (réutilisé par le cron de retard) ----------------------

  // Renvoie { eta: {...} | null, retard: boolean }.
  calculerEta(
    depart: Pick<DepartAvecTrajet, 'trajet' | 'dateDepart' | 'retardMinutes'>,
    derniere: { latitude: number; longitude: number; vitesse: number | null; mesureA: Date } | null,
  ) {
    const dest = this.destination(depart);
    if (!derniere || !dest) return { eta: null, retard: false };

    const distanceVolOiseau = haversineKm(
      { latitude: derniere.latitude, longitude: derniere.longitude },
      dest,
    );
    const distanceKm = distanceVolOiseau * SUIVI.FACTEUR_ROUTE;

    const vitesse =
      derniere.vitesse && derniere.vitesse > 5
        ? derniere.vitesse
        : SUIVI.VITESSE_DEFAUT_KMH;
    const minutesRestantes = Math.round((distanceKm / vitesse) * 60);
    const arriveeEstimee = new Date(Date.now() + minutesRestantes * 60_000);

    const prevue = this.arriveePrevue(depart);
    let retardMinutes = 0;
    if (prevue) {
      retardMinutes = Math.max(
        0,
        Math.round((arriveeEstimee.getTime() - prevue.getTime()) / 60_000),
      );
    }

    return {
      eta: {
        arriveeEstimee,
        minutesRestantes,
        distanceKm: Math.round(distanceKm),
        retardMinutes,
      },
      retard: retardMinutes >= SUIVI.RETARD_SEUIL_MINUTES,
    };
  }

  private destination(
    depart: Pick<DepartAvecTrajet, 'trajet'>,
  ): (Point & { ville: string }) | null {
    const v = depart.trajet.villeArrivee;
    if (v.latitude == null || v.longitude == null) return null;
    return { ville: v.nom, latitude: v.latitude, longitude: v.longitude };
  }

  // Heure d'arrivée prévue = date du départ + heure d'arrivée estimée du trajet
  // (décalée d'un jour si l'arrivée est "avant" le départ → trajet de nuit).
  private arriveePrevue(
    depart: Pick<DepartAvecTrajet, 'trajet' | 'dateDepart'>,
  ): Date | null {
    const arr = depart.trajet.heureArriveeEstimee;
    if (!arr) return null;
    const base = depart.dateDepart;
    const prevue = new Date(
      Date.UTC(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        base.getUTCDate(),
        arr.getUTCHours(),
        arr.getUTCMinutes(),
        arr.getUTCSeconds(),
      ),
    );
    const dep = depart.trajet.heureDepart;
    const minutesArr = arr.getUTCHours() * 60 + arr.getUTCMinutes();
    const minutesDep = dep.getUTCHours() * 60 + dep.getUTCMinutes();
    if (minutesArr < minutesDep) {
      prevue.setUTCDate(prevue.getUTCDate() + 1);
    }
    return prevue;
  }

  private async chargerDepart(departId: number): Promise<DepartAvecTrajet> {
    const depart = await this.prisma.depart.findUnique({
      where: { id: departId },
      include: DEPART_POUR_SUIVI,
    });
    if (!depart) throw new NotFoundException(`Départ ${departId} introuvable`);
    return depart as unknown as DepartAvecTrajet;
  }

  private async assertPeutSuivre(
    depart: DepartAvecTrajet,
    user: AuthenticatedUser,
  ) {
    if (user.role === UserRole.ADMIN) return;
    if (
      (user.role === UserRole.AGENT || user.role === UserRole.COMPANY_ADMIN) &&
      user.compagnieId === depart.trajet.compagnieId
    ) {
      return;
    }
    // Voyageur : doit avoir une réservation sur ce départ.
    const resa = await this.prisma.reservation.findFirst({
      where: {
        departId: depart.id,
        utilisateurId: user.userId,
        statut: { in: ['confirmee', 'annulee'] },
      },
      select: { id: true },
    });
    if (!resa) {
      throw new ForbiddenException(
        "Vous n'avez pas de réservation sur ce départ",
      );
    }
  }

  private notifierVoyageurs(
    departId: number,
    notif: Parameters<NotificationsService['notifier']>[1],
  ) {
    return notifierVoyageursDeparts(
      this.prisma,
      this.notifications,
      [departId],
      notif,
    );
  }
}

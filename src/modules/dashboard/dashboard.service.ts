import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { DASHBOARD, ReservationStatut, UserRole } from '../../config/constants';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { DashboardPeriodeDto } from './dto/dashboard-periode.dto';
import { DashboardClassementDto } from './dto/dashboard-classement.dto';
import { DashboardSerieDto } from './dto/dashboard-serie.dto';

interface ReservationAgregable {
  statut: string;
  nombrePlaces: number;
  paiement: { statut: string; montant: Prisma.Decimal } | null;
  depart: {
    trajet: {
      id: number;
      villeDepart: { nom: string };
      villeArrivee: { nom: string };
      compagnie: { id: number; nom: string };
    };
  };
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  // Vue d'ensemble sur une période : réservations (statut + canal + par agent
  // au guichet), chiffre d'affaires par statut de paiement, taux de remplissage
  // des départs de la période.
  async resume(user: AuthenticatedUser, dto: DashboardPeriodeDto) {
    const { debut, fin } = this.resoudrePeriode(dto.from, dto.to);
    const compagnieId = this.resoudreCompagnieFiltre(user, dto.compagnieId);

    const whereReservation: Prisma.ReservationWhereInput = {
      dateReservation: { gte: debut, lte: fin },
      ...(compagnieId != null ? { depart: { trajet: { compagnieId } } } : {}),
    };
    const whereDepart: Prisma.DepartWhereInput = {
      dateDepart: { gte: debut, lte: fin },
      ...(compagnieId != null ? { trajet: { compagnieId } } : {}),
    };

    const [parStatut, parCanal, guichetParAgent, parStatutPaiement, departsPeriode] =
      await Promise.all([
        this.prisma.reservation.groupBy({
          by: ['statut'],
          where: whereReservation,
          _count: true,
          _sum: { nombrePlaces: true },
        }),
        this.prisma.reservation.groupBy({
          by: ['canal'],
          where: whereReservation,
          _count: true,
        }),
        this.prisma.reservation.groupBy({
          by: ['agentId'],
          where: { ...whereReservation, canal: 'guichet' },
          _count: true,
          _sum: { nombrePlaces: true },
        }),
        this.prisma.paiement.groupBy({
          by: ['statut'],
          where: { reservation: whereReservation },
          _count: true,
          _sum: { montant: true },
        }),
        this.prisma.depart.findMany({
          where: whereDepart,
          select: { placesTotales: true, placesDisponibles: true },
        }),
      ]);

    const agentIds = guichetParAgent
      .map((g) => g.agentId)
      .filter((v): v is number => v != null);
    const agents = agentIds.length
      ? await this.prisma.utilisateur.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, nom: true },
        })
      : [];
    const nomAgent = new Map(agents.map((a) => [a.id, a.nom]));

    const placesTotales = departsPeriode.reduce((s, d) => s + d.placesTotales, 0);
    const placesOccupees = departsPeriode.reduce(
      (s, d) => s + (d.placesTotales - d.placesDisponibles),
      0,
    );

    return {
      periode: { debut, fin },
      reservations: {
        total: parStatut.reduce((s, r) => s + r._count, 0),
        parStatut: Object.fromEntries(
          parStatut.map((r) => [
            r.statut,
            { nombre: r._count, places: r._sum.nombrePlaces ?? 0 },
          ]),
        ),
        parCanal: Object.fromEntries(parCanal.map((r) => [r.canal, r._count])),
        guichetParAgent: guichetParAgent
          .filter((g) => g.agentId != null)
          .map((g) => ({
            agentId: g.agentId as number,
            nom: nomAgent.get(g.agentId as number) ?? '—',
            reservations: g._count,
            places: g._sum.nombrePlaces ?? 0,
          }))
          .sort((a, b) => b.reservations - a.reservations),
      },
      chiffreAffaires: {
        parStatutPaiement: Object.fromEntries(
          parStatutPaiement.map((p) => [
            p.statut,
            {
              nombre: p._count,
              montant: (p._sum.montant ?? new Prisma.Decimal(0)).toString(),
            },
          ]),
        ),
      },
      occupation: {
        departs: departsPeriode.length,
        placesTotales,
        placesOccupees,
        tauxRemplissage:
          placesTotales > 0
            ? Number((placesOccupees / placesTotales).toFixed(4))
            : 0,
      },
    };
  }

  // Série journalière pour les courbes de tendance : un point par jour de la
  // période (jours vides inclus avec des zéros). Base = date de vente
  // (reservation.dateReservation). Fenêtre bornée à DASHBOARD.SERIE_MAX_JOURS.
  async serie(user: AuthenticatedUser, dto: DashboardSerieDto) {
    const { debut, fin } = this.resoudrePeriode(
      dto.from,
      dto.to,
      DASHBOARD.SERIE_MAX_JOURS,
    );
    const compagnieId = this.resoudreCompagnieFiltre(user, dto.compagnieId);

    const reservations = await this.prisma.reservation.findMany({
      where: {
        dateReservation: { gte: debut, lte: fin },
        ...(compagnieId != null ? { depart: { trajet: { compagnieId } } } : {}),
      },
      select: {
        dateReservation: true,
        canal: true,
        statut: true,
        nombrePlaces: true,
        paiement: { select: { statut: true, montant: true } },
      },
    });

    const parJour = new Map<
      string,
      {
        date: string;
        reservations: number;
        placesVendues: number;
        revenu: Prisma.Decimal;
        parCanal: { en_ligne: number; guichet: number };
      }
    >();
    for (const date of this.joursEntre(debut, fin)) {
      parJour.set(date, {
        date,
        reservations: 0,
        placesVendues: 0,
        revenu: new Prisma.Decimal(0),
        parCanal: { en_ligne: 0, guichet: 0 },
      });
    }

    for (const r of reservations) {
      const jour = r.dateReservation.toISOString().slice(0, 10);
      const b = parJour.get(jour);
      if (!b) continue;
      b.reservations += 1;
      if (r.canal === 'en_ligne') b.parCanal.en_ligne += 1;
      else if (r.canal === 'guichet') b.parCanal.guichet += 1;
      if (r.statut === ReservationStatut.CONFIRMEE) {
        b.placesVendues += r.nombrePlaces;
      }
      if (r.paiement?.statut === 'paye') {
        b.revenu = b.revenu.plus(r.paiement.montant);
      }
    }

    return [...parJour.values()].map((b) => ({
      ...b,
      revenu: b.revenu.toString(),
    }));
  }

  // Classement des trajets par chiffre d'affaires encaissé sur la période
  // (admin : toutes compagnies, filtrables ; company_admin : la sienne).
  async trajetsPlusActifs(user: AuthenticatedUser, dto: DashboardClassementDto) {
    const { debut, fin } = this.resoudrePeriode(dto.from, dto.to);
    const compagnieId = this.resoudreCompagnieFiltre(user, dto.compagnieId);
    const limite = this.clampLimite(dto.limit);

    const reservations = await this.reservationsPeriode(compagnieId, debut, fin);

    const parTrajet = new Map<
      number,
      {
        trajetId: number;
        villeDepart: string;
        villeArrivee: string;
        compagnie: { id: number; nom: string };
        reservations: number;
        placesVendues: number;
        revenu: Prisma.Decimal;
      }
    >();

    for (const r of reservations) {
      const t = r.depart.trajet;
      const entree = parTrajet.get(t.id) ?? {
        trajetId: t.id,
        villeDepart: t.villeDepart.nom,
        villeArrivee: t.villeArrivee.nom,
        compagnie: t.compagnie,
        reservations: 0,
        placesVendues: 0,
        revenu: new Prisma.Decimal(0),
      };
      this.cumuler(entree, r);
      parTrajet.set(t.id, entree);
    }

    return [...parTrajet.values()]
      .sort((a, b) => b.revenu.comparedTo(a.revenu))
      .slice(0, limite)
      .map((e) => ({ ...e, revenu: e.revenu.toString() }));
  }

  // Classement des compagnies par chiffre d'affaires encaissé sur la période.
  // Réservé à l'admin plateforme (une compagnie n'a rien à comparer).
  async compagniesPlusActives(user: AuthenticatedUser, dto: DashboardClassementDto) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        "Classement des compagnies réservé à l'administrateur plateforme",
      );
    }
    const { debut, fin } = this.resoudrePeriode(dto.from, dto.to);
    const limite = this.clampLimite(dto.limit);

    const reservations = await this.reservationsPeriode(null, debut, fin);

    const parCompagnie = new Map<
      number,
      {
        compagnieId: number;
        nom: string;
        reservations: number;
        placesVendues: number;
        revenu: Prisma.Decimal;
      }
    >();

    for (const r of reservations) {
      const c = r.depart.trajet.compagnie;
      const entree = parCompagnie.get(c.id) ?? {
        compagnieId: c.id,
        nom: c.nom,
        reservations: 0,
        placesVendues: 0,
        revenu: new Prisma.Decimal(0),
      };
      this.cumuler(entree, r);
      parCompagnie.set(c.id, entree);
    }

    return [...parCompagnie.values()]
      .sort((a, b) => b.revenu.comparedTo(a.revenu))
      .slice(0, limite)
      .map((e) => ({ ...e, revenu: e.revenu.toString() }));
  }

  private cumuler(
    entree: { reservations: number; placesVendues: number; revenu: Prisma.Decimal },
    r: ReservationAgregable,
  ): void {
    entree.reservations += 1;
    if (r.statut === ReservationStatut.CONFIRMEE) {
      entree.placesVendues += r.nombrePlaces;
    }
    if (r.paiement?.statut === 'paye') {
      entree.revenu = entree.revenu.plus(r.paiement.montant);
    }
  }

  private reservationsPeriode(
    compagnieId: number | null,
    debut: Date,
    fin: Date,
  ): Promise<ReservationAgregable[]> {
    return this.prisma.reservation.findMany({
      where: {
        dateReservation: { gte: debut, lte: fin },
        ...(compagnieId != null ? { depart: { trajet: { compagnieId } } } : {}),
      },
      select: {
        statut: true,
        nombrePlaces: true,
        paiement: { select: { statut: true, montant: true } },
        depart: {
          select: {
            trajet: {
              select: {
                id: true,
                villeDepart: { select: { nom: true } },
                villeArrivee: { select: { nom: true } },
                compagnie: { select: { id: true, nom: true } },
              },
            },
          },
        },
      },
    });
  }

  // admin : filtre optionnel (compagnieId en query, ou tout) ; company_admin :
  // forcé à la sienne ; tout autre rôle ne devrait jamais atteindre ce point
  // (bloqué en amont par le PermissionsGuard sur dashboard:read).
  private resoudreCompagnieFiltre(
    user: AuthenticatedUser,
    compagnieIdDemande?: number,
  ): number | null {
    if (user.role === UserRole.ADMIN) {
      return compagnieIdDemande ?? null;
    }
    if (user.role === UserRole.COMPANY_ADMIN) {
      if (user.compagnieId == null) {
        throw new ForbiddenException(
          "Votre compte n'est rattaché à aucune compagnie",
        );
      }
      return user.compagnieId;
    }
    throw new ForbiddenException(
      "Réservé à l'administrateur plateforme ou au gestionnaire de compagnie",
    );
  }

  // `from` absent → DASHBOARD.PERIODE_DEFAUT_JOURS avant `to`. `to` absent →
  // maintenant. Fenêtre bornée à PERIODE_MAX_JOURS pour éviter d'agréger un
  // historique trop large en une seule requête.
  private resoudrePeriode(
    from?: string,
    to?: string,
    maxJours: number = DASHBOARD.PERIODE_MAX_JOURS,
  ): { debut: Date; fin: Date } {
    const fin = to ? new Date(to) : new Date();
    fin.setHours(23, 59, 59, 999);

    const debut = from ? new Date(from) : new Date(fin);
    if (!from) {
      debut.setDate(debut.getDate() - DASHBOARD.PERIODE_DEFAUT_JOURS);
    }
    debut.setHours(0, 0, 0, 0);

    const debutMin = new Date(fin);
    debutMin.setDate(debutMin.getDate() - maxJours);
    debutMin.setHours(0, 0, 0, 0);

    return { debut: debut < debutMin ? debutMin : debut, fin };
  }

  // Liste des jours (YYYY-MM-DD, UTC) de `debut` à `fin` inclus.
  private joursEntre(debut: Date, fin: Date): string[] {
    const jours: string[] = [];
    const d = new Date(
      Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth(), debut.getUTCDate()),
    );
    const finUtc = new Date(
      Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), fin.getUTCDate()),
    );
    while (d <= finUtc) {
      jours.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return jours;
  }

  private clampLimite(limit?: number): number {
    if (!limit || limit < 1) return DASHBOARD.CLASSEMENT_LIMITE_DEFAUT;
    return Math.min(limit, DASHBOARD.CLASSEMENT_LIMITE_MAX);
  }
}

import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { UserRole } from '../../config/constants';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

const admin: AuthenticatedUser = {
  userId: 1,
  telephone: '+2250700000001',
  role: UserRole.ADMIN,
  compagnieId: null,
};
const gestionnaire = (compagnieId: number | null): AuthenticatedUser => ({
  userId: 2,
  telephone: '+2250700000002',
  role: UserRole.COMPANY_ADMIN,
  compagnieId,
});

function reservationRow(overrides: Record<string, unknown> = {}) {
  return {
    statut: 'confirmee',
    nombrePlaces: 2,
    paiement: { statut: 'paye', montant: new Prisma.Decimal(15000) },
    depart: {
      trajet: {
        id: 1,
        villeDepart: { nom: 'Korhogo' },
        villeArrivee: { nom: 'Abidjan' },
        compagnie: { id: 1, nom: 'Garantis Transport' },
      },
    },
    ...overrides,
  };
}

describe('DashboardService', () => {
  let prisma: any;
  let service: DashboardService;

  beforeEach(() => {
    prisma = {
      reservation: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      paiement: { groupBy: jest.fn().mockResolvedValue([]) },
      depart: { findMany: jest.fn().mockResolvedValue([]) },
      utilisateur: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new DashboardService(prisma);
  });

  describe('resume — portée par rôle', () => {
    it('company_admin sans compagnie rattachée → 403', async () => {
      await expect(service.resume(gestionnaire(null), {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('company_admin est restreint à sa compagnie (ignore compagnieId en query)', async () => {
      await service.resume(gestionnaire(1), { compagnieId: 99 });
      const where = prisma.reservation.groupBy.mock.calls[0][0].where;
      expect(where).toEqual(
        expect.objectContaining({ depart: { trajet: { compagnieId: 1 } } }),
      );
    });

    it('admin sans filtre voit toutes les compagnies', async () => {
      await service.resume(admin, {});
      const where = prisma.reservation.groupBy.mock.calls[0][0].where;
      expect(where.depart).toBeUndefined();
    });

    it('admin peut filtrer sur une compagnie précise', async () => {
      await service.resume(admin, { compagnieId: 3 });
      const where = prisma.reservation.groupBy.mock.calls[0][0].where;
      expect(where).toEqual(
        expect.objectContaining({ depart: { trajet: { compagnieId: 3 } } }),
      );
    });
  });

  describe('trajetsPlusActifs — agrégation', () => {
    it('cumule places vendues et revenu (payé uniquement), trie par revenu décroissant', async () => {
      prisma.reservation.findMany.mockResolvedValue([
        reservationRow({
          nombrePlaces: 2,
          paiement: { statut: 'paye', montant: new Prisma.Decimal(10000) },
        }),
        reservationRow({
          nombrePlaces: 1,
          statut: 'annulee',
          paiement: { statut: 'rembourse', montant: new Prisma.Decimal(10000) },
        }),
        reservationRow({
          nombrePlaces: 3,
          paiement: { statut: 'paye', montant: new Prisma.Decimal(50000) },
          depart: {
            trajet: {
              id: 2,
              villeDepart: { nom: 'Abidjan' },
              villeArrivee: { nom: 'Bouaké' },
              compagnie: { id: 1, nom: 'Garantis Transport' },
            },
          },
        }),
      ]);

      const res = await service.trajetsPlusActifs(admin, {});

      expect(res).toHaveLength(2);
      expect(res[0]).toMatchObject({ trajetId: 2, revenu: '50000', placesVendues: 3 });
      expect(res[1]).toMatchObject({
        trajetId: 1,
        revenu: '10000', // le remboursement ne compte pas dans le revenu
        placesVendues: 2, // la réservation annulée ne compte pas dans les places
        reservations: 2,
      });
    });
  });

  describe('serie — points journaliers', () => {
    it('un point par jour de la période, jours vides à zéro', async () => {
      const res = await service.serie(admin, {
        from: '2026-09-01',
        to: '2026-09-03',
      });
      expect(res.map((p) => p.date)).toEqual([
        '2026-09-01',
        '2026-09-02',
        '2026-09-03',
      ]);
      expect(res[0]).toEqual({
        date: '2026-09-01',
        reservations: 0,
        placesVendues: 0,
        revenu: '0',
        parCanal: { en_ligne: 0, guichet: 0 },
      });
    });

    it('ventile réservations / places / revenu / canal par jour de vente', async () => {
      prisma.reservation.findMany.mockResolvedValue([
        {
          dateReservation: new Date('2026-09-02T09:00:00Z'),
          canal: 'en_ligne',
          statut: 'confirmee',
          nombrePlaces: 2,
          paiement: { statut: 'paye', montant: new Prisma.Decimal(30000) },
        },
        {
          dateReservation: new Date('2026-09-02T15:00:00Z'),
          canal: 'guichet',
          statut: 'confirmee',
          nombrePlaces: 1,
          paiement: { statut: 'en_attente', montant: new Prisma.Decimal(15000) },
        },
        {
          dateReservation: new Date('2026-09-03T10:00:00Z'),
          canal: 'en_ligne',
          statut: 'annulee',
          nombrePlaces: 1,
          paiement: null,
        },
      ]);

      const res = await service.serie(admin, {
        from: '2026-09-02',
        to: '2026-09-03',
      });

      expect(res[0]).toEqual({
        date: '2026-09-02',
        reservations: 2,
        placesVendues: 3,
        revenu: '30000',
        parCanal: { en_ligne: 1, guichet: 1 },
      });
      expect(res[1]).toMatchObject({
        date: '2026-09-03',
        reservations: 1,
        placesVendues: 0, // annulée
        revenu: '0',
      });
    });

    it('company_admin est restreint à sa compagnie', async () => {
      await service.serie(gestionnaire(1), { compagnieId: 99, from: '2026-09-01', to: '2026-09-01' });
      const where = prisma.reservation.findMany.mock.calls[0][0].where;
      expect(where).toEqual(
        expect.objectContaining({ depart: { trajet: { compagnieId: 1 } } }),
      );
    });
  });

  describe('compagniesPlusActives', () => {
    it('refuse un company_admin (403)', async () => {
      await expect(
        service.compagniesPlusActives(gestionnaire(1), {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.reservation.findMany).not.toHaveBeenCalled();
    });

    it("autorise l'admin plateforme", async () => {
      prisma.reservation.findMany.mockResolvedValue([reservationRow()]);
      const res = await service.compagniesPlusActives(admin, {});
      expect(res).toEqual([
        expect.objectContaining({ compagnieId: 1, revenu: '15000' }),
      ]);
    });
  });
});

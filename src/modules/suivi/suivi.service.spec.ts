import { BadRequestException, ConflictException } from '@nestjs/common';
import { SuiviService } from './suivi.service';
import { UserRole } from '../../config/constants';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

const staff = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  userId: 2,
  telephone: '+2250700000002',
  role: UserRole.COMPANY_ADMIN,
  compagnieId: 1,
  ...overrides,
});

const trajet = {
  compagnieId: 1,
  heureDepart: new Date('1970-01-01T08:00:00Z'),
  heureArriveeEstimee: new Date('1970-01-01T16:00:00Z'),
  villeDepart: { nom: 'Korhogo' },
  villeArrivee: { nom: 'Abidjan', latitude: 5.3599, longitude: -4.0083 },
};

describe('SuiviService.calculerEta', () => {
  const service = new SuiviService({} as never, {} as never);

  it('null si pas de position', () => {
    const r = service.calculerEta(
      { trajet, dateDepart: new Date('2026-09-15'), retardMinutes: 0 },
      null,
    );
    expect(r).toEqual({ eta: null, retard: false });
  });

  it('null si la ville d’arrivée n’a pas de coordonnées', () => {
    const r = service.calculerEta(
      {
        trajet: { ...trajet, villeArrivee: { nom: 'X', latitude: null, longitude: null } },
        dateDepart: new Date('2026-09-15'),
        retardMinutes: 0,
      },
      { latitude: 7, longitude: -5, vitesse: 60, mesureA: new Date() },
    );
    expect(r.eta).toBeNull();
  });

  it('estime distance et minutes restantes depuis Bouaké', () => {
    const r = service.calculerEta(
      { trajet, dateDepart: new Date('2026-09-15'), retardMinutes: 0 },
      { latitude: 7.6906, longitude: -5.0303, vitesse: 70, mesureA: new Date() },
    );
    expect(r.eta).not.toBeNull();
    // ~260 km vol d'oiseau × 1.3 ≈ 340 km ; à 70 km/h ≈ 290 min
    expect(r.eta!.distanceKm).toBeGreaterThan(300);
    expect(r.eta!.minutesRestantes).toBeGreaterThan(200);
  });
});

describe('SuiviService.demarrer', () => {
  let prisma: any;
  let service: SuiviService;

  beforeEach(() => {
    process.env.JWT_SECRET = 'y'.repeat(40);
    prisma = {
      depart: {
        findUnique: jest.fn().mockResolvedValue({
          id: 5,
          statut: 'planifie',
          dateDepart: new Date('2026-09-15'),
          demarreA: null,
          termineA: null,
          retardMinutes: 0,
          trajet,
        }),
        update: jest.fn().mockResolvedValue({
          id: 5,
          statut: 'en_route',
          trajet: { ...trajet, villeDepart: { nom: 'Korhogo' } },
        }),
      },
      reservation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new SuiviService(prisma, { notifier: jest.fn() } as never);
  });

  it('démarre un départ planifié et renvoie un jeton de suivi', async () => {
    const res = await service.demarrer(5, staff());
    expect(prisma.depart.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statut: 'en_route' }) }),
    );
    expect(typeof res.suiviToken).toBe('string');
    expect(res.expireA.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuse un départ déjà en cours (409)', async () => {
    prisma.depart.findUnique.mockResolvedValue({
      id: 5,
      statut: 'en_route',
      dateDepart: new Date(),
      trajet,
    });
    await expect(service.demarrer(5, staff())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuse un départ arrivé (400)', async () => {
    prisma.depart.findUnique.mockResolvedValue({
      id: 5,
      statut: 'arrive',
      dateDepart: new Date(),
      trajet,
    });
    await expect(service.demarrer(5, staff())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('SuiviService.declarerRetard', () => {
  let prisma: any;
  let notifier: jest.Mock;
  let service: SuiviService;

  beforeEach(() => {
    notifier = jest.fn();
    prisma = {
      depart: {
        findUnique: jest.fn().mockResolvedValue({
          id: 5,
          statut: 'planifie',
          dateDepart: new Date('2026-09-15'),
          trajet: { ...trajet, villeDepart: { nom: 'Korhogo' } },
        }),
        update: jest.fn().mockResolvedValue({
          id: 5,
          retardMinutes: 45,
          trajet: { ...trajet, villeDepart: { nom: 'Korhogo' } },
        }),
      },
      reservation: {
        findMany: jest.fn().mockResolvedValue([{ utilisateurId: 9 }]),
      },
    };
    service = new SuiviService(prisma, { notifier } as never);
  });

  it('enregistre le retard et notifie les voyageurs', async () => {
    await service.declarerRetard(5, staff(), 45, 'panne');
    expect(prisma.depart.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { retardMinutes: 45, retardNotifieMinutes: 45 },
      }),
    );
    expect(notifier).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ type: 'depart.retard' }),
    );
  });

  it('refuse sur un départ déjà arrivé', async () => {
    prisma.depart.findUnique.mockResolvedValue({
      id: 5,
      statut: 'arrive',
      dateDepart: new Date(),
      trajet,
    });
    await expect(
      service.declarerRetard(5, staff(), 10),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

import { TrajetsService } from './trajets.service';
import { UserRole } from '../../config/constants';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

const admin: AuthenticatedUser = {
  userId: 1,
  telephone: '+2250700000001',
  role: UserRole.ADMIN,
  compagnieId: null,
};

describe('TrajetsService.update — notification de changement d’horaire', () => {
  let prisma: any;
  let notifier: jest.Mock;
  let service: TrajetsService;

  const trajetAvant = {
    id: 3,
    compagnieId: 1,
    heureDepart: new Date('1970-01-01T08:00:00Z'),
    heureArriveeEstimee: new Date('1970-01-01T16:00:00Z'),
  };

  beforeEach(() => {
    notifier = jest.fn();
    prisma = {
      trajet: {
        findUnique: jest.fn().mockResolvedValue(trajetAvant),
        update: jest.fn().mockResolvedValue({
          ...trajetAvant,
          heureDepart: new Date('1970-01-01T09:30:00Z'),
          villeDepart: { nom: 'Korhogo' },
          villeArrivee: { nom: 'Abidjan' },
        }),
      },
      compagnie: {
        findUnique: jest.fn().mockResolvedValue({
          statut: 'actif',
          abonnements: [{ id: 1 }],
        }),
      },
      depart: {
        findMany: jest.fn().mockResolvedValue([{ id: 20 }, { id: 21 }]),
      },
      reservation: {
        findMany: jest.fn().mockResolvedValue([{ utilisateurId: 7 }]),
      },
    };
    service = new TrajetsService(prisma, { notifier } as never);
  });

  it('notifie les voyageurs des départs à venir quand l’heure change', async () => {
    await service.update(3, { heureDepart: '09:30' } as never, admin);

    expect(prisma.depart.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          trajetId: 3,
          statut: { in: ['planifie', 'en_route'] },
        }),
      }),
    );
    expect(notifier).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: 'depart.horaire_modifie' }),
    );
  });

  it('ne notifie pas si l’heure de départ est inchangée', async () => {
    prisma.trajet.update.mockResolvedValue({
      ...trajetAvant,
      villeDepart: { nom: 'Korhogo' },
      villeArrivee: { nom: 'Abidjan' },
    });
    await service.update(3, { prix: 16000 } as never, admin);
    expect(notifier).not.toHaveBeenCalled();
  });
});

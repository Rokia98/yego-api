import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReservationsService } from './reservations.service';
import { UserRole } from '../../config/constants';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

const agent = (compagnieId: number | null): AuthenticatedUser => ({
  userId: 42,
  telephone: '+2250700000003',
  role: UserRole.AGENT,
  compagnieId,
});

describe('ReservationsService.creerAuGuichet', () => {
  let tx: any;
  let prisma: any;
  let audit: { record: jest.Mock };
  let service: ReservationsService;

  const departCompagnie1 = {
    id: 1,
    placesDisponibles: 10,
    trajet: { compagnieId: 1, prix: new Prisma.Decimal(15000) },
  };

  // Départ vendable : planifié, trajet actif, dans 5 jours.
  const departOuvert = {
    statut: 'planifie',
    dateDepart: new Date(Date.now() + 5 * 86_400_000),
    trajet: {
      compagnieId: 1,
      statut: 'actif',
      heureDepart: new Date('1970-01-01T08:00:00Z'),
    },
  };

  beforeEach(() => {
    tx = {
      depart: {
        findUnique: jest.fn().mockResolvedValue(departCompagnie1),
        update: jest.fn().mockResolvedValue({}),
      },
      reservation: {
        create: jest.fn().mockResolvedValue({ id: 100, paiement: null }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ticket: { findMany: jest.fn().mockResolvedValue([]) },
      paiement: { create: jest.fn().mockResolvedValue({ id: 7 }) },
    };
    prisma = {
      $transaction: jest.fn((cb: any) => cb(tx)),
      depart: {
        findUnique: jest.fn().mockResolvedValue(departOuvert),
      },
      // compagnie opérationnelle : statut actif + 1 abonnement valide
      compagnie: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ statut: 'actif', abonnements: [{ id: 1 }] }),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new ReservationsService(prisma, audit as never, {
      notifier: jest.fn().mockResolvedValue(undefined),
    } as never);
  });

  const dto = {
    departId: 1,
    nombrePlaces: 2,
    passager: { nom: 'Kone Ali', telephone: '+2250799999999' },
  };

  it("refuse un agent d'une autre compagnie", async () => {
    await expect(service.creerAuGuichet(dto, agent(2))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.reservation.create).not.toHaveBeenCalled();
  });

  it("n'ouvre AUCUN compte : nom + téléphone posés sur la réservation", async () => {
    await service.creerAuGuichet(dto, agent(1));

    expect(tx.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          canal: 'guichet',
          agentId: 42,
          utilisateurId: null,
          passagerNom: 'Kone Ali',
          passagerTelephone: '+2250799999999',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reservation.guichet' }),
    );
  });

  it('encaisse en espèces si demandé (montant = prix × places)', async () => {
    await service.creerAuGuichet({ ...dto, paiementEspece: true }, agent(1));

    expect(tx.paiement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          moyenPaiement: 'espece',
          statut: 'paye',
        }),
      }),
    );
    const montant = tx.paiement.create.mock.calls[0][0].data.montant;
    expect(montant.toString()).toBe('30000');
  });

  it('stocke les sièges choisis sur la réservation', async () => {
    await service.creerAuGuichet({ ...dto, sieges: ['A1', 'A2'] }, agent(1));

    expect(tx.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sieges: ['A1', 'A2'] }),
      }),
    );
  });

  it('refuse si le nombre de sièges ne correspond pas aux places (400)', async () => {
    await expect(
      service.creerAuGuichet({ ...dto, sieges: ['A1'] }, agent(1)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.reservation.create).not.toHaveBeenCalled();
  });

  it('refuse un siège déjà retenu par une autre réservation (409)', async () => {
    tx.reservation.findMany.mockResolvedValue([{ sieges: ['A1'] }]);

    await expect(
      service.creerAuGuichet({ ...dto, sieges: ['A1', 'A2'] }, agent(1)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.reservation.create).not.toHaveBeenCalled();
  });

  it.each([
    ['annulé', { statut: 'annule' }],
    ['en route', { statut: 'en_route' }],
    ['arrivé', { statut: 'arrive' }],
    ['déjà parti (hier)', { dateDepart: new Date(Date.now() - 86_400_000) }],
    ['sur un trajet inactif', { trajet: { ...departOuvert.trajet, statut: 'inactif' } }],
  ])('refuse la vente sur un départ %s (400)', async (_cas, surcharge) => {
    prisma.depart.findUnique.mockResolvedValue({ ...departOuvert, ...surcharge });
    await expect(service.creerAuGuichet(dto, agent(1))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.reservation.create).not.toHaveBeenCalled();
  });
});

describe('ReservationsService.annuler', () => {
  let tx: any;
  let prisma: any;
  let service: ReservationsService;

  const dans10Jours = new Date(Date.now() + 10 * 86_400_000);

  beforeEach(() => {
    tx = {
      reservation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 5,
          statut: 'confirmee',
          departId: 1,
          nombrePlaces: 2,
          utilisateurId: 42,
          paiement: { statut: 'paye', montant: new Prisma.Decimal(30000) },
          remboursement: null,
          tickets: [{ statut: 'valide' }],
          depart: {
            statut: 'planifie',
            dateDepart: dans10Jours,
            trajet: {
              compagnieId: 1,
              heureDepart: new Date('1970-01-01T08:00:00Z'),
            },
          },
        }),
        update: jest.fn().mockResolvedValue({ id: 5, statut: 'annulee' }),
      },
      depart: { update: jest.fn().mockResolvedValue({}) },
      ticket: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      remboursement: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 9, ...data })),
      },
    };
    prisma = { $transaction: jest.fn((cb: any) => cb(tx)) };
    service = new ReservationsService(
      prisma,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      { notifier: jest.fn().mockResolvedValue(undefined) } as never,
    );
  });

  it('libère les places et crée un remboursement (10 % de frais à >3 j)', async () => {
    const user: AuthenticatedUser = {
      userId: 42,
      telephone: '+225',
      role: UserRole.USER,
      compagnieId: null,
    };
    const res = await service.annuler(5, user);

    expect(tx.depart.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { placesDisponibles: { increment: 2 } },
      }),
    );
    const rb = tx.remboursement.create.mock.calls[0][0].data;
    expect(rb.fraisRetenus.toString()).toBe('3000'); // 10 % de 30000
    expect(rb.montantRembourse.toString()).toBe('27000');
    expect(res.remboursement).toBeTruthy();
  });

  const voyageur: AuthenticatedUser = {
    userId: 42,
    telephone: '+225',
    role: UserRole.USER,
    compagnieId: null,
  };

  it("annule les tickets encore valides : ils ne permettent plus d'embarquer", async () => {
    await service.annuler(5, voyageur);
    expect(tx.ticket.updateMany).toHaveBeenCalledWith({
      where: { reservationId: 5, statut: 'valide' },
      data: { statut: 'annule' },
    });
  });

  it('refuse (400) si un ticket a déjà servi à embarquer — pas de remboursement', async () => {
    const resa = await tx.reservation.findUnique();
    tx.reservation.findUnique.mockResolvedValue({
      ...resa,
      tickets: [{ statut: 'utilise' }],
    });
    await expect(service.annuler(5, voyageur)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.remboursement.create).not.toHaveBeenCalled();
    expect(tx.depart.update).not.toHaveBeenCalled();
  });

  it('refuse (400) si le départ est déjà en route', async () => {
    const resa = await tx.reservation.findUnique();
    tx.reservation.findUnique.mockResolvedValue({
      ...resa,
      depart: { ...resa.depart, statut: 'en_route' },
    });
    await expect(service.annuler(5, voyageur)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.remboursement.create).not.toHaveBeenCalled();
  });
});

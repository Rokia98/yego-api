import { ForbiddenException } from '@nestjs/common';
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

  beforeEach(() => {
    tx = {
      depart: {
        findUnique: jest.fn().mockResolvedValue(departCompagnie1),
        update: jest.fn().mockResolvedValue({}),
      },
      reservation: {
        create: jest.fn().mockResolvedValue({ id: 100, paiement: null }),
      },
      paiement: { create: jest.fn().mockResolvedValue({ id: 7 }) },
    };
    prisma = {
      $transaction: jest.fn((cb: any) => cb(tx)),
      depart: {
        findUnique: jest.fn().mockResolvedValue({ trajet: { compagnieId: 1 } }),
      },
      // compagnie opérationnelle : statut actif + 1 abonnement valide
      compagnie: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ statut: 'actif', abonnements: [{ id: 1 }] }),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new ReservationsService(prisma, audit as never);
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
          depart: {
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
      remboursement: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 9, ...data })),
      },
    };
    prisma = { $transaction: jest.fn((cb: any) => cb(tx)) };
    service = new ReservationsService(prisma, {
      record: jest.fn().mockResolvedValue(undefined),
    } as never);
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
});

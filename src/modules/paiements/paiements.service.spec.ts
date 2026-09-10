import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaiementsService } from './paiements.service';

const VOYAGEUR_ID = 42;

const reservationBase = {
  id: 1,
  utilisateurId: VOYAGEUR_ID,
  nombrePlaces: 2,
  statut: 'confirmee',
  depart: { trajet: { prix: new Prisma.Decimal(15000) } },
  paiement: null as null | { statut: string },
};

describe('PaiementsService.create (relance idempotente)', () => {
  let prisma: any;
  let service: PaiementsService;

  const dto = { reservationId: 1, moyenPaiement: 'wave' };

  beforeEach(() => {
    prisma = {
      reservation: {
        findUnique: jest.fn().mockResolvedValue({ ...reservationBase }),
      },
      paiement: {
        create: jest.fn().mockResolvedValue({ id: 10, statut: 'en_attente' }),
        update: jest.fn().mockResolvedValue({ id: 10, statut: 'en_attente' }),
      },
    };
    service = new PaiementsService(
      prisma,
      { record: jest.fn() } as never,
      { notifier: jest.fn() } as never,
    );
  });

  it('crée un paiement quand il n’en existe pas', async () => {
    await service.create(dto, VOYAGEUR_ID);
    expect(prisma.paiement.create).toHaveBeenCalled();
    expect(prisma.paiement.update).not.toHaveBeenCalled();
  });

  it('réutilise un paiement "en_attente" au lieu d’en recréer un', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...reservationBase,
      paiement: { statut: 'en_attente' },
    });

    await service.create({ ...dto, moyenPaiement: 'orange_money' }, VOYAGEUR_ID);

    expect(prisma.paiement.create).not.toHaveBeenCalled();
    expect(prisma.paiement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reservationId: 1 },
        data: expect.objectContaining({
          moyenPaiement: 'orange_money',
          statut: 'en_attente',
        }),
      }),
    );
  });

  it('relance un paiement "echoue" (pas de cul-de-sac)', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...reservationBase,
      paiement: { statut: 'echoue' },
    });

    await service.create(dto, VOYAGEUR_ID);

    expect(prisma.paiement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statut: 'en_attente' }),
      }),
    );
  });

  it('refuse si le paiement est déjà "paye" (400)', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...reservationBase,
      paiement: { statut: 'paye' },
    });

    await expect(service.create(dto, VOYAGEUR_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuse de payer une réservation annulée (400)', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...reservationBase,
      statut: 'annulee',
    });

    await expect(service.create(dto, VOYAGEUR_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

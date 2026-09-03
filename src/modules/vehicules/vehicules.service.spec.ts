import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VehiculesService } from './vehicules.service';
import { UserRole } from '../../config/constants';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

const user = (role: UserRole, compagnieId: number | null): AuthenticatedUser => ({
  userId: 1,
  telephone: '+2250700000000',
  role,
  compagnieId,
});

describe('VehiculesService', () => {
  let prisma: {
    vehicule: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let service: VehiculesService;

  beforeEach(() => {
    prisma = {
      vehicule: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new VehiculesService(prisma as never);
  });

  it("force la compagnie de l'utilisateur à la création", async () => {
    prisma.vehicule.create.mockImplementation(({ data }) => Promise.resolve(data));
    await service.create(
      { immatriculation: 'CI-1000-AA', capacite: 30, compagnieId: 999 },
      user(UserRole.COMPANY_ADMIN, 5),
    ).catch(() => undefined);
    // resoudreCompagnieCible rejette une autre compagnie -> pas d'appel create
    expect(prisma.vehicule.create).not.toHaveBeenCalled();
  });

  it('crée avec la compagnie de l\'utilisateur quand aucune n\'est fournie', async () => {
    prisma.vehicule.create.mockImplementation(({ data }) => Promise.resolve(data));
    const res = await service.create(
      { immatriculation: 'CI-1000-AA', capacite: 30 },
      user(UserRole.COMPANY_ADMIN, 5),
    );
    expect(res.compagnieId).toBe(5);
  });

  it('filtre la liste par compagnie pour un non-admin', () => {
    prisma.vehicule.findMany.mockResolvedValue([]);
    service.findAll(user(UserRole.AGENT, 5));
    expect(prisma.vehicule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { compagnieId: 5 } }),
    );
  });

  it('ne filtre pas la liste pour un admin', () => {
    prisma.vehicule.findMany.mockResolvedValue([]);
    service.findAll(user(UserRole.ADMIN, null));
    expect(prisma.vehicule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it("interdit l'accès à un véhicule d'une autre compagnie", async () => {
    prisma.vehicule.findUnique.mockResolvedValue({ id: 1, compagnieId: 8 });
    await expect(
      service.findOne(1, user(UserRole.COMPANY_ADMIN, 5)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('traduit la violation d\'unicité en 409', async () => {
    prisma.vehicule.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '5',
      }),
    );
    await expect(
      service.create(
        { immatriculation: 'CI-1000-AA', capacite: 30, compagnieId: 3 },
        user(UserRole.ADMIN, null),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

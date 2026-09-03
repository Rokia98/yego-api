import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { UserRole } from '../../config/constants';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

const user = (
  role: UserRole,
  compagnieId: number | null,
): AuthenticatedUser => ({
  userId: 1,
  telephone: '+2250700000000',
  role,
  compagnieId,
});

describe('AgentsService', () => {
  let prisma: {
    utilisateur: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let service: AgentsService;

  beforeEach(() => {
    prisma = {
      utilisateur: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      },
    };
    service = new AgentsService(prisma as never);
  });

  const dto = {
    nom: 'Agent Test',
    telephone: '+2250788990011',
    motDePasse: 'motdepasse',
  };

  it("crée un agent role=agent rattaché à la compagnie du company_admin", async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(null);
    await service.create(dto, user(UserRole.COMPANY_ADMIN, 5));
    const data = prisma.utilisateur.create.mock.calls[0][0].data;
    expect(data.role).toBe(UserRole.AGENT);
    expect(data.compagnieId).toBe(5);
    expect(data.motDePasseHash).toEqual(expect.any(String));
    expect(data.motDePasseHash).not.toBe('motdepasse');
  });

  it('refuse une compagnie différente demandée par un company_admin', async () => {
    await expect(
      service.create({ ...dto, compagnieId: 9 }, user(UserRole.COMPANY_ADMIN, 5)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuse un téléphone déjà pris', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ id: 99 });
    await expect(
      service.create(dto, user(UserRole.COMPANY_ADMIN, 5)),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('filtre la liste sur la compagnie pour un company_admin', () => {
    service.findAll(user(UserRole.COMPANY_ADMIN, 5));
    expect(prisma.utilisateur.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: UserRole.AGENT, compagnieId: 5 },
      }),
    );
  });

  it("bloque l'accès à un agent d'une autre compagnie", async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({
      id: 2,
      role: UserRole.AGENT,
      compagnieId: 8,
    });
    await expect(
      service.findOne(2, user(UserRole.COMPANY_ADMIN, 5)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('la suppression désactive le compte et incrémente tokenVersion', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({
      id: 2,
      role: UserRole.AGENT,
      compagnieId: 5,
    });
    await service.delete(2, user(UserRole.COMPANY_ADMIN, 5));
    expect(prisma.utilisateur.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 2 },
        data: { actif: false, tokenVersion: { increment: 1 } },
      }),
    );
  });
});

import { ConflictException, NotFoundException } from '@nestjs/common';
import { CompagniesService } from './compagnies.service';

describe('CompagniesService.creerCompteAdmin', () => {
  let prisma: any;
  let service: CompagniesService;

  const dto = { nom: 'Gérant X', telephone: '+2250700000099', email: 'g@x.ci' };

  beforeEach(() => {
    prisma = {
      compagnie: {
        findUnique: jest.fn().mockResolvedValue({ id: 1 }),
      },
      utilisateur: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 50,
          nom: dto.nom,
          telephone: dto.telephone,
        }),
        update: jest.fn().mockResolvedValue({
          id: 7,
          nom: dto.nom,
          telephone: dto.telephone,
        }),
      },
    };
    service = new CompagniesService(prisma);
  });

  it('compagnie inconnue → 404', async () => {
    prisma.compagnie.findUnique.mockResolvedValue(null);
    await expect(service.creerCompteAdmin(1, dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('crée le compte gestionnaire et renvoie un mot de passe temporaire', async () => {
    const res = await service.creerCompteAdmin(1, dto);

    expect(prisma.utilisateur.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'company_admin',
          compagnieId: 1,
          actif: true,
          doitChangerMotDePasse: true,
          telephone: dto.telephone,
        }),
      }),
    );
    expect(res).toMatchObject({ id: 50, telephone: dto.telephone });
    expect(res.motDePasseTemporaire).toEqual(expect.any(String));
    expect(res.motDePasseTemporaire.length).toBeGreaterThanOrEqual(12);
  });

  it('régénère le mot de passe si le numéro est déjà gestionnaire de CETTE compagnie', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({
      id: 7,
      role: 'company_admin',
      compagnieId: 1,
    });

    const res = await service.creerCompteAdmin(1, dto);

    expect(prisma.utilisateur.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({
          motDePasseHash: expect.any(String),
          doitChangerMotDePasse: true,
          tokenVersion: { increment: 1 },
        }),
      }),
    );
    expect(prisma.utilisateur.create).not.toHaveBeenCalled();
    expect(res.motDePasseTemporaire).toEqual(expect.any(String));
  });

  it('409 si le numéro appartient à un autre compte (autre compagnie / autre rôle)', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({
      id: 9,
      role: 'company_admin',
      compagnieId: 2,
    });
    await expect(service.creerCompteAdmin(1, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );

    prisma.utilisateur.findUnique.mockResolvedValue({
      id: 10,
      role: 'user',
      compagnieId: null,
    });
    await expect(service.creerCompteAdmin(1, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

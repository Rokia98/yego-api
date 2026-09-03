import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UserRole } from '../../config/constants';

describe('AuthService', () => {
  let prisma: {
    utilisateur: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let jwt: { sign: jest.Mock };
  let config: { get: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      utilisateur: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      refreshToken: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 99, ...data }),
        ),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    config = { get: jest.fn().mockReturnValue(30) };
    service = new AuthService(prisma as never, jwt as never, config as never);
  });

  describe('register', () => {
    it('refuse un téléphone déjà enregistré', async () => {
      prisma.utilisateur.findUnique.mockResolvedValue({ id: 1 });
      await expect(
        service.register({
          nom: 'Test',
          telephone: '+2250700000000',
          motDePasse: 'motdepasse',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('crée un utilisateur "user", hache le mot de passe et émet un couple de jetons', async () => {
      prisma.utilisateur.findUnique.mockResolvedValue(null);
      prisma.utilisateur.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 7, tokenVersion: 0, compagnieId: null, ...data }),
      );

      const res = await service.register({
        nom: 'Test',
        telephone: '+2250700000000',
        motDePasse: 'motdepasse',
      });

      const createArg = prisma.utilisateur.create.mock.calls[0][0].data;
      expect(createArg.role).toBe(UserRole.USER);
      expect(createArg.motDePasseHash).not.toBe('motdepasse');
      expect(res.accessToken).toBe('signed.jwt.token');
      expect(res.refreshToken).toEqual(expect.any(String));
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('rejette des identifiants invalides', async () => {
      prisma.utilisateur.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ telephone: '+2250700000000', motDePasse: 'x' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('retourne des jetons quand le mot de passe correspond', async () => {
      const motDePasseHash = await bcrypt.hash('bonmotdepasse', 4);
      prisma.utilisateur.findUnique.mockResolvedValue({
        id: 3,
        telephone: '+2250700000000',
        role: 'user',
        actif: true,
        compagnieId: null,
        tokenVersion: 2,
        motDePasseHash,
      });

      const res = await service.login({
        telephone: '+2250700000000',
        motDePasse: 'bonmotdepasse',
      });

      expect(res.accessToken).toBe('signed.jwt.token');
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 3, role: 'user', tv: 2, cid: null }),
      );
    });
  });

  describe('refresh', () => {
    it('révoque toute la lignée si un jeton révoqué est réutilisé', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 10,
        utilisateurId: 3,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 100000),
      });

      await expect(service.refresh('a'.repeat(64))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
      );
    });

    it('effectue une rotation quand le jeton est valide', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 10,
        utilisateurId: 3,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
      });
      prisma.utilisateur.findUnique.mockResolvedValue({
        id: 3,
        telephone: '+2250700000000',
        role: 'user',
        compagnieId: null,
        tokenVersion: 0,
      });

      const res = await service.refresh('b'.repeat(64));

      expect(res.refreshToken).toEqual(expect.any(String));
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });
  });
});

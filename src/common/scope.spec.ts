import { ForbiddenException } from '@nestjs/common';
import { assertCompagnieScope, resoudreCompagnieCible } from './scope';
import { UserRole } from '../config/constants';
import { AuthenticatedUser } from '../modules/auth/strategies/jwt.strategy';

const u = (role: UserRole, compagnieId: number | null): AuthenticatedUser => ({
  userId: 1,
  telephone: '+2250700000000',
  role,
  compagnieId,
});

describe('assertCompagnieScope', () => {
  it("laisse passer l'admin plateforme quelle que soit la compagnie", () => {
    expect(() => assertCompagnieScope(u(UserRole.ADMIN, null), 42)).not.toThrow();
  });

  it('laisse passer un company_admin sur sa compagnie', () => {
    expect(() =>
      assertCompagnieScope(u(UserRole.COMPANY_ADMIN, 7), 7),
    ).not.toThrow();
  });

  it('bloque un company_admin sur une autre compagnie', () => {
    expect(() => assertCompagnieScope(u(UserRole.COMPANY_ADMIN, 7), 8)).toThrow(
      ForbiddenException,
    );
  });

  it('bloque un rôle sans compagnie', () => {
    expect(() => assertCompagnieScope(u(UserRole.AGENT, null), 7)).toThrow(
      ForbiddenException,
    );
  });
});

describe('resoudreCompagnieCible', () => {
  it("force la compagnie de l'agent, ignore une valeur absente", () => {
    expect(resoudreCompagnieCible(u(UserRole.AGENT, 7), undefined)).toBe(7);
  });

  it('rejette une compagnie différente demandée par un company_admin', () => {
    expect(() =>
      resoudreCompagnieCible(u(UserRole.COMPANY_ADMIN, 7), 9),
    ).toThrow(ForbiddenException);
  });

  it("exige compagnieId pour l'admin plateforme", () => {
    expect(() => resoudreCompagnieCible(u(UserRole.ADMIN, null), undefined)).toThrow(
      ForbiddenException,
    );
    expect(resoudreCompagnieCible(u(UserRole.ADMIN, null), 5)).toBe(5);
  });
});

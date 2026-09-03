import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS } from '../../config/permissions';
import { UserRole } from '../../config/constants';

function ctxWithUser(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let reflector: Reflector;
  let guard: PermissionsGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  it('laisse passer une route sans @RequirePermissions()', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(ctxWithUser({ role: UserRole.USER }))).toBe(true);
  });

  it('autorise le rôle qui possède la permission', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([PERMISSIONS.TRAJET_MANAGE]);
    expect(
      guard.canActivate(ctxWithUser({ role: UserRole.COMPANY_ADMIN })),
    ).toBe(true);
  });

  it("refuse le rôle qui n'a pas la permission", () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([PERMISSIONS.TRAJET_MANAGE]);
    expect(() =>
      guard.canActivate(ctxWithUser({ role: UserRole.AGENT })),
    ).toThrow(ForbiddenException);
  });

  it('accorde tout à l\'admin plateforme', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([PERMISSIONS.COMPAGNIE_MODERATE, PERMISSIONS.AUDIT_READ]);
    expect(guard.canActivate(ctxWithUser({ role: UserRole.ADMIN }))).toBe(true);
  });

  it('refuse une requête non authentifiée', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([PERMISSIONS.AUDIT_READ]);
    expect(() => guard.canActivate(ctxWithUser(undefined))).toThrow(
      ForbiddenException,
    );
  });
});

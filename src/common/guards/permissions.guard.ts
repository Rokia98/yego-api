import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { Permission, aLaPermission } from '../../config/permissions';

/**
 * Contrôle d'accès basé sur les permissions. S'exécute APRÈS JwtAuthGuard
 * (request.user doit être renseigné). Une route sans @RequirePermissions()
 * n'est pas restreinte ici.
 *
 * NB : ce guard vérifie la *capacité* (le rôle a la permission). La restriction
 * au périmètre d'une compagnie se fait dans les services via assertCompagnieScope.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requises = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requises || requises.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('Authentification requise');
    }

    const autorise = requises.every((p) => aLaPermission(user.role, p));
    if (!autorise) {
      throw new ForbiddenException(
        "Vous n'avez pas les droits nécessaires pour cette action",
      );
    }

    return true;
  }
}

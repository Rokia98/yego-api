import { SetMetadata } from '@nestjs/common';
import { Permission } from '../../config/permissions';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Exige que l'utilisateur authentifié possède TOUTES les permissions listées.
 * À combiner avec JwtAuthGuard + PermissionsGuard.
 *
 * @example
 *   @UseGuards(JwtAuthGuard, PermissionsGuard)
 *   @RequirePermissions(PERMISSIONS.TRAJET_MANAGE)
 *   @Post()
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

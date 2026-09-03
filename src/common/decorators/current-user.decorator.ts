import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../../modules/auth/strategies/jwt.strategy';

/**
 * Injecte l'utilisateur authentifié (issu du JWT vérifié par JwtStrategy).
 * N'est renseigné que sur les routes protégées par JwtAuthGuard.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;
    return data ? user?.[data] : user;
  },
);

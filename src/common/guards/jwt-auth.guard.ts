import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AUTORISE_MDP_TEMPORAIRE } from '../decorators/mot-de-passe-temporaire.decorator';
import { AuthenticatedUser } from '../../modules/auth/strategies/jwt.strategy';

// JWT valide + mot de passe temporaire changé. Le statut est relu en base à
// chaque requête (JwtStrategy.validate) : un compte créé par un tiers
// (POST /compagnies/:id/compte-admin…) doit d'abord passer par
// PATCH /auth/mot-de-passe.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user?.doitChangerMotDePasse) return true;

    const autorise = this.reflector.getAllAndOverride<boolean>(AUTORISE_MDP_TEMPORAIRE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (autorise) return true;

    throw new ForbiddenException({
      statusCode: 403,
      code: 'MOT_DE_PASSE_A_CHANGER',
      message: 'Changez votre mot de passe temporaire (PATCH /auth/mot-de-passe) pour continuer',
    });
  }
}

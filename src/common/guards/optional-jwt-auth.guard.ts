import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Pour une route publique qui enrichit sa réponse quand l'appelant est
 * identifié (ex. données réservées au personnel). Un Bearer valide renseigne
 * request.user ; absent ou invalide, la requête passe en anonyme (user = null)
 * au lieu d'un 401.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(_err: unknown, user: TUser): TUser | null {
    return user || null;
  }
}

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

// Protège les endpoints appelés par des serveurs tiers (webhooks opérateurs
// mobile money) plutôt que par un utilisateur connecté : on exige un secret
// partagé transmis dans l'en-tête 'x-webhook-secret', jamais un JWT.
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;

    if (!secret) {
      // Mal configuré : on refuse plutôt que d'accepter n'importe quel appel.
      throw new ForbiddenException('Webhook non configuré');
    }

    const provided = request.headers['x-webhook-secret'];
    if (typeof provided !== 'string' || !this.egal(provided, secret)) {
      throw new ForbiddenException('Secret webhook invalide');
    }

    return true;
  }

  // Comparaison à temps constant : ne divulgue pas le secret via le timing.
  private egal(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}

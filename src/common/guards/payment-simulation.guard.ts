import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

/**
 * Protège l'endpoint de simulation de paiement. Il n'existe que si
 * PAYMENT_SIMULATION=true — sinon on renvoie 404 (on ne divulgue pas qu'un
 * mode simulation existe). Ce flag ne doit JAMAIS être activé sur une vraie
 * production : il permet de marquer un paiement « payé » sans transaction réelle.
 */
@Injectable()
export class PaymentSimulationGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.PAYMENT_SIMULATION !== 'true') {
      throw new NotFoundException();
    }
    return true;
  }
}

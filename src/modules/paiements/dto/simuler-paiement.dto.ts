import { IsIn } from 'class-validator';

// Simulation de la réponse d'un opérateur mobile money (mode PAYMENT_SIMULATION).
export class SimulerPaiementDto {
  // 'succes' → paiement confirmé (comme le webhook opérateur).
  // 'echec'  → paiement 'echoue' ; la réservation reste réservée, repayable.
  @IsIn(['succes', 'echec'])
  resultat: 'succes' | 'echec';
}

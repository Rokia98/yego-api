import { IsIn, IsOptional } from 'class-validator';

export class ConfirmerRemboursementDto {
  // 'jeko'   → transfert automatique vers le numéro Mobile Money qui a payé
  //            (défaut pour un paiement encaissé en ligne via Jèko).
  // 'manuel' → le décaissement a été fait hors plateforme (espèces, virement) :
  //            on le constate seulement (défaut pour les autres paiements).
  @IsOptional()
  @IsIn(['jeko', 'manuel'])
  mode?: 'jeko' | 'manuel';
}

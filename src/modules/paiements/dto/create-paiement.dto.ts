import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class CreatePaiementDto {
  @IsInt()
  reservationId: number;

  // Le montant n'est PAS fourni par le client : il est recalculé côté
  // serveur à partir du prix réel du trajet (voir PaiementsService.create),
  // pour empêcher de payer un montant arbitraire.
  @IsIn(['orange_money', 'mtn_money', 'moov_money', 'wave', 'espece'])
  moyenPaiement: string;

  @IsOptional()
  @IsString()
  referenceTransaction?: string;
}

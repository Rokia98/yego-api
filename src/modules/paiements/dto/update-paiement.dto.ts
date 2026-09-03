import { IsIn, IsOptional, IsString } from 'class-validator';

// Le statut n'est volontairement PAS modifiable ici : il ne doit changer que
// via le webhook opérateur (PaiementsService.confirmer) ou un flux de
// remboursement. Sinon un utilisateur pourrait s'auto-déclarer "payé".
export class UpdatePaiementDto {
  @IsOptional()
  @IsIn(['orange_money', 'mtn_money', 'moov_money', 'wave', 'espece'])
  moyenPaiement?: string;

  @IsOptional()
  @IsString()
  referenceTransaction?: string;
}

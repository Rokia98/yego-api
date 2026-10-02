import { IsIn, IsOptional, IsString } from 'class-validator';
import { MOYENS_PAIEMENT } from '../../../common/moyens-paiement';

// Le statut n'est volontairement PAS modifiable ici : il ne doit changer que
// via le webhook opérateur (PaiementsService.confirmer) ou un flux de
// remboursement. Sinon un utilisateur pourrait s'auto-déclarer "payé".
export class UpdatePaiementDto {
  @IsOptional()
  @IsIn(MOYENS_PAIEMENT)
  moyenPaiement?: string;

  @IsOptional()
  @IsString()
  referenceTransaction?: string;
}

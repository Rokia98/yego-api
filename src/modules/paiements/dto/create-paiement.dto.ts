import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches } from 'class-validator';
import {
  MOYENS_PAIEMENT,
  TELEPHONE_MOBILE_MONEY_CI,
} from '../../../common/moyens-paiement';
import { normaliserTelephone } from '../../../common/telephone';

export class CreatePaiementDto {
  @IsInt()
  reservationId: number;

  // Le montant n'est PAS fourni par le client : il est recalculé côté
  // serveur à partir du prix réel du trajet (voir PaiementsService.create),
  // pour empêcher de payer un montant arbitraire.
  @IsIn(MOYENS_PAIEMENT)
  moyenPaiement: string;

  @IsOptional()
  @IsString()
  referenceTransaction?: string;

  // Numéro Mobile Money qui paie (paiement Jèko). Par défaut : le téléphone du
  // compte voyageur. Accepte la saisie locale (07 01 02 03 04).
  @IsOptional()
  @Transform(({ value }) => normaliserTelephone(value))
  @Matches(TELEPHONE_MOBILE_MONEY_CI, {
    message: 'telephonePayeur doit être un numéro mobile ivoirien (+225 01/05/07…)',
  })
  telephonePayeur?: string;
}

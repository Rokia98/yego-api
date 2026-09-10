import { IsOptional, IsString, Matches } from 'class-validator';
import { SIEGE_REGEX } from '../../../common/sieges';

export class GenererTicketDto {
  // Ex. « A1 », « 12 », « B14 ». Optionnel : si la réservation porte déjà des
  // sièges choisis (avant paiement), le prochain est attribué automatiquement.
  @IsOptional()
  @IsString()
  @Matches(SIEGE_REGEX, {
    message: 'Siège invalide (ex. "A1", "12", "B14")',
  })
  siege?: string;
}

import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  Matches,
  Min,
} from 'class-validator';
import { SIEGE_REGEX } from '../../../common/sieges';

export class CreateReservationDto {
  @IsInt()
  @IsPositive()
  departId: number;

  @IsInt()
  @Min(1)
  nombrePlaces: number;

  // Sièges souhaités (un par place), choisis AVANT le paiement. Optionnel :
  // sans valeur, placement libre. Si fourni, doit compter exactement
  // `nombrePlaces` entrées, toutes libres sur ce départ (sinon 409).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @Matches(SIEGE_REGEX, {
    each: true,
    message: 'Siège invalide (ex. "A1", "12", "B14")',
  })
  sieges?: string[];

  // Le canal ('en_ligne') et l'utilisateurId sont déterminés côté serveur :
  // cet endpoint ne sert qu'à la réservation en ligne par le voyageur lui-même.
  // Pour une vente au guichet, voir POST /reservations/guichet.
}

import { IsInt, IsPositive, Min } from 'class-validator';

export class CreateReservationDto {
  @IsInt()
  @IsPositive()
  departId: number;

  @IsInt()
  @Min(1)
  nombrePlaces: number;

  // Le canal ('en_ligne') et l'utilisateurId sont déterminés côté serveur :
  // cet endpoint ne sert qu'à la réservation en ligne par le voyageur lui-même.
  // Pour une vente au guichet, voir POST /reservations/guichet.
}

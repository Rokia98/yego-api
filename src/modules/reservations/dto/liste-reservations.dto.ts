import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

// Filtres de GET /reservations (tous optionnels, combinés en ET, toujours à
// l'intérieur du cloisonnement : voyageur → siennes, personnel → sa compagnie).
export class ListeReservationsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  take?: number;

  @IsOptional()
  @IsIn(['confirmee', 'annulee', 'expiree'])
  statut?: string;

  @IsOptional()
  @IsIn(['en_ligne', 'guichet'])
  canal?: string;

  // non_paye = aucun paiement, ou paiement dans un autre statut que 'paye'.
  @IsOptional()
  @IsIn(['paye', 'non_paye'])
  paiement?: 'paye' | 'non_paye';

  // Bornes incluses sur la date du départ (YYYY-MM-DD).
  @IsOptional()
  @Matches(JOUR, { message: 'du doit être au format YYYY-MM-DD' })
  du?: string;

  @IsOptional()
  @Matches(JOUR, { message: 'au doit être au format YYYY-MM-DD' })
  au?: string;

  // Bornes incluses sur la date de RÉSERVATION (YYYY-MM-DD, UTC = heure
  // d'Abidjan). Se combinent avec du/au (date du départ).
  @IsOptional()
  @Matches(JOUR, { message: 'reserveDu doit être au format YYYY-MM-DD' })
  reserveDu?: string;

  @IsOptional()
  @Matches(JOUR, { message: 'reserveAu doit être au format YYYY-MM-DD' })
  reserveAu?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  departId?: number;

  // Nom / téléphone du passager ou du compte voyageur ; "#12" ou "12" → id.
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(80)
  q?: string;

  // Admin plateforme uniquement ; ignoré pour les autres (cloisonnement).
  @IsOptional()
  @IsInt()
  @IsPositive()
  compagnieId?: number;
}

import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
} from 'class-validator';

export const STATUTS_ABONNEMENT = ['actif', 'expire', 'annule'] as const;

export class UpdateAbonnementDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  montant?: number;

  // Renouvellement : nouvelle date de fin.
  @IsOptional()
  @IsDateString()
  dateFin?: string;

  @IsOptional()
  @IsIn(STATUTS_ABONNEMENT)
  statut?: (typeof STATUTS_ABONNEMENT)[number];
}

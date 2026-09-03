import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const STATUTS_VEHICULE = ['actif', 'maintenance', 'hors_service'] as const;

export class CreateVehiculeDto {
  // Ignoré pour un agent/company_admin (forcé à leur compagnie) ;
  // requis pour l'admin plateforme.
  @IsOptional()
  @IsInt()
  @IsPositive()
  compagnieId?: number;

  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9- ]{4,20}$/, {
    message: 'Immatriculation invalide (4 à 20 caractères A-Z, 0-9, - ou espace)',
  })
  immatriculation: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  typeVehicule?: string;

  @IsInt()
  @IsPositive()
  capacite: number;

  @IsOptional()
  @IsIn(STATUTS_VEHICULE)
  statut?: (typeof STATUTS_VEHICULE)[number];
}

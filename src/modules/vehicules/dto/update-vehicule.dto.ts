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
import { STATUTS_VEHICULE } from './create-vehicule.dto';

export class UpdateVehiculeDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9- ]{4,20}$/, {
    message: 'Immatriculation invalide (4 à 20 caractères A-Z, 0-9, - ou espace)',
  })
  immatriculation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  typeVehicule?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  capacite?: number;

  @IsOptional()
  @IsIn(STATUTS_VEHICULE)
  statut?: (typeof STATUTS_VEHICULE)[number];
}

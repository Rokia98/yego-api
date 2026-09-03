import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const TELEPHONE_REGEX = /^\+?[0-9]{8,15}$/;

export class CreateChauffeurDto {
  // Ignoré pour un agent/company_admin (forcé à leur compagnie) ;
  // requis pour l'admin plateforme.
  @IsOptional()
  @IsInt()
  @IsPositive()
  compagnieId?: number;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(120)
  nom: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '') : value,
  )
  @Matches(TELEPHONE_REGEX, {
    message: 'Numéro de téléphone invalide (8 à 15 chiffres, "+" optionnel)',
  })
  telephone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  numeroPermis?: string;
}

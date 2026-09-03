import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const TELEPHONE_REGEX = /^\+?[0-9]{8,15}$/;

export class CreateAgentDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(120)
  nom: string;

  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '') : value,
  )
  @Matches(TELEPHONE_REGEX, {
    message: 'Numéro de téléphone invalide (8 à 15 chiffres, "+" optionnel)',
  })
  telephone: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  motDePasse: string;

  // Ignoré pour un company_admin (forcé à sa compagnie) ; requis pour l'admin.
  @IsOptional()
  @IsInt()
  @IsPositive()
  compagnieId?: number;
}

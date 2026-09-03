import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const TELEPHONE_REGEX = /^\+?[0-9]{8,15}$/;

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(120)
  nom?: string;

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
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  motDePasse?: string;

  // false = désactive le compte (déconnexion immédiate).
  @IsOptional()
  @IsBoolean()
  actif?: boolean;
}

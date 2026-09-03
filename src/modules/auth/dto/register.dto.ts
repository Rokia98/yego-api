import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Format E.164 souple : '+' optionnel puis 8 à 15 chiffres.
const TELEPHONE_REGEX = /^\+?[0-9]{8,15}$/;

export class RegisterDto {
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
  @MinLength(8, { message: 'Le mot de passe doit faire au moins 8 caractères' })
  @MaxLength(72, { message: 'Le mot de passe ne peut pas dépasser 72 caractères' })
  motDePasse: string;
}

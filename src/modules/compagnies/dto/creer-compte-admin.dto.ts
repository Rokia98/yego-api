import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TelephoneNormalise } from '../../../common/decorators/telephone-normalise.decorator';

// Création (ou régénération du mot de passe) du compte gestionnaire d'une
// compagnie, par l'administrateur plateforme.
export class CreerCompteAdminDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(120)
  nom: string;

  @IsString()
  @TelephoneNormalise()
  telephone: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;
}

import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { EstLogoValide } from '../../../common/validators/logo.validator';

// Le statut n'est PAS modifiable ici : c'est une action de modération réservée
// à l'admin plateforme (PATCH /compagnies/:id/statut).
export class UpdateCompagnieDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telephone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // URL http(s) OU data:image/(png|jpeg|webp);base64 (≤ 40 Ko décodé).
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  @EstLogoValide()
  logoUrl?: string;
}

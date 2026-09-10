import { IsString, IsOptional, IsEmail, MaxLength } from 'class-validator';
import { EstLogoValide } from '../../../common/validators/logo.validator';

export class CreateCompagnieDto {
  @IsString()
  @MaxLength(120)
  nom: string;

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

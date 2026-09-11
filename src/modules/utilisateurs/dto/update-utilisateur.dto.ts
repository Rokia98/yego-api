import { IsString, IsOptional, IsEmail, MaxLength, MinLength } from 'class-validator';
import { EstImageValide } from '../../../common/validators/image.validator';

export class UpdateUtilisateurDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  nom?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  motDePasse?: string;

  // URL http(s) OU data:image/(png|jpeg|webp);base64 (≤ 40 Ko décodé) —
  // compressée côté client, pas d'upload de fichier côté API.
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  @EstImageValide()
  photoUrl?: string;
}

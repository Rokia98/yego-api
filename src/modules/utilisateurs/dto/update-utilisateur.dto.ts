import { IsString, IsOptional, IsEmail, MaxLength, MinLength } from 'class-validator';

// Pas de mot de passe ici : il se change uniquement par PATCH /auth/mot-de-passe,
// qui exige l'ancien et coupe les autres sessions. Un jeton volé ne doit pas
// suffire à prendre le compte (champ inconnu → 400).
import { EstImageValide } from '../../../common/validators/image.validator';

export class UpdateUtilisateurDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  nom?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // URL http(s) OU data:image/(png|jpeg|webp);base64 (≤ 40 Ko décodé) —
  // compressée côté client, pas d'upload de fichier côté API.
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  @EstImageValide()
  photoUrl?: string;
}

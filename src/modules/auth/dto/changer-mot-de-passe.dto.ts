import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangerMotDePasseDto {
  @IsString()
  @MaxLength(72)
  ancienMotDePasse: string;

  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit faire au moins 8 caractères' })
  @MaxLength(72, { message: 'Le mot de passe ne peut pas dépasser 72 caractères' })
  nouveauMotDePasse: string;
}

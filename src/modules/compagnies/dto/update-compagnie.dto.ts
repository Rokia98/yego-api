import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;
}

import { IsString, IsOptional, IsEmail, MinLength } from 'class-validator';

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
}

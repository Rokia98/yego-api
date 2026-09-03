import { IsString, IsOptional, IsEmail } from 'class-validator';

export class CreateCompagnieDto {
  @IsString()
  nom: string;

  @IsOptional()
  @IsString()
  telephone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

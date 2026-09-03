import { IsString, MinLength } from 'class-validator';

export class CreateVilleDto {
  @IsString()
  @MinLength(2)
  nom: string;
}

import {
  IsDateString,
  IsInt,
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateAbonnementDto {
  @IsInt()
  @IsPositive()
  compagnieId: number;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  plan: string;

  @IsNumber()
  @IsPositive()
  montant: number;

  @IsDateString()
  dateDebut: string;

  @IsDateString()
  dateFin: string;
}

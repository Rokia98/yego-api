import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RechercheDepartDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  depart: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  arrivee: string;

  // Date (YYYY-MM-DD). Sans `dateFin`, on cherche ce jour précis ;
  // avec `dateFin`, `date` devient le début d'une fourchette.
  @IsDateString()
  date: string;

  @IsOptional()
  @IsDateString()
  dateFin?: string;
}

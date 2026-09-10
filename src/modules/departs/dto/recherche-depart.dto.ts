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

  // Date (YYYY-MM-DD). Optionnelle : sans elle, la recherche part d'aujourd'hui.
  // `date` est toujours le début d'une fourchette ; sans `dateFin`, celle-ci
  // s'étend sur RECHERCHE_DEPART.FENETRE_DEFAUT_JOURS jours.
  // Pour ne cibler qu'un jour précis : passer `date` et `dateFin` identiques.
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsDateString()
  dateFin?: string;
}

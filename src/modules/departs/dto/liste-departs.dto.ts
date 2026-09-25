import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  Matches,
  Min,
} from 'class-validator';
import { DepartStatut } from '../../../config/constants';

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

// Filtres de GET /departs (tous optionnels, combinés en ET).
export class ListeDepartsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  take?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  compagnieId?: number;

  @IsOptional()
  @IsIn(Object.values(DepartStatut))
  statut?: string;

  // Bornes incluses sur dateDepart (YYYY-MM-DD).
  @IsOptional()
  @Matches(JOUR, { message: 'du doit être au format YYYY-MM-DD' })
  du?: string;

  @IsOptional()
  @Matches(JOUR, { message: 'au doit être au format YYYY-MM-DD' })
  au?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  trajetId?: number;

  // Tri sur la date puis l'heure de départ. Défaut : asc.
  @IsOptional()
  @IsIn(['asc', 'desc'])
  ordre?: 'asc' | 'desc';
}

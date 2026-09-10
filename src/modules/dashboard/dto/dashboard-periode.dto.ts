import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsPositive } from 'class-validator';

export class DashboardPeriodeDto {
  // Bornes de la période (YYYY-MM-DD). Sans elles : les
  // DASHBOARD.PERIODE_DEFAUT_JOURS derniers jours (voir DashboardService).
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // Admin uniquement : filtre sur une compagnie précise (sinon, toutes).
  // Ignoré pour un company_admin, qui est toujours restreint à la sienne.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  compagnieId?: number;
}

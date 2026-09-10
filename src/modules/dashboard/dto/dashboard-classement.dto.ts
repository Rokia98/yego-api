import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DashboardPeriodeDto } from './dashboard-periode.dto';

export class DashboardClassementDto extends DashboardPeriodeDto {
  // Taille du classement (défaut/borne : voir DASHBOARD.CLASSEMENT_LIMITE_*).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

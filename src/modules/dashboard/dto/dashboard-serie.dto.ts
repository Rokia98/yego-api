import { IsIn, IsOptional } from 'class-validator';
import { DashboardPeriodeDto } from './dashboard-periode.dto';

export class DashboardSerieDto extends DashboardPeriodeDto {
  // Granularité des points. `jour` seul pour l'instant (champ prévu pour
  // `semaine` / `mois` plus tard).
  @IsOptional()
  @IsIn(['jour'])
  granularite?: 'jour';
}

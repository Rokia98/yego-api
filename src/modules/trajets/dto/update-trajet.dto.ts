import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PRIX_BILLET_MAX, PRIX_BILLET_MIN } from '../../../config/constants';

export class UpdateTrajetDto {
  @IsOptional()
  @IsInt()
  compagnieId?: number;

  @IsOptional()
  @IsInt()
  villeDepartId?: number;

  @IsOptional()
  @IsInt()
  villeArriveeId?: number;

  @IsOptional()
  @IsString()
  heureDepart?: string;

  @IsOptional()
  @IsString()
  heureArriveeEstimee?: string;

  @IsOptional()
  @IsNumber()
  @Min(PRIX_BILLET_MIN)
  @Max(PRIX_BILLET_MAX)
  prix?: number;

  @IsOptional()
  @IsString()
  joursRecurrence?: string;

  @IsOptional()
  @IsIn(['actif', 'inactif'])
  statut?: string;
}

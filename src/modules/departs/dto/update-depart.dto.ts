import { IsIn, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';
import { DepartStatut } from '../../../config/constants';

export class UpdateDepartDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  vehiculeId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  chauffeurId?: number;

  @IsOptional()
  @IsString()
  dateDepart?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  placesTotales?: number;

  @IsOptional()
  @IsIn(Object.values(DepartStatut))
  statut?: string;
}

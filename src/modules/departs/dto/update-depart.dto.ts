import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

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
  @IsString()
  statut?: string;
}

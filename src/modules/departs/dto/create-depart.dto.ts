import { IsInt, IsOptional, IsString } from 'class-validator';

export class CreateDepartDto {
  @IsInt()
  trajetId: number;

  @IsString()
  dateDepart: string; // format 'YYYY-MM-DD'

  @IsInt()
  placesTotales: number;

  @IsOptional()
  @IsInt()
  vehiculeId?: number;

  @IsOptional()
  @IsInt()
  chauffeurId?: number;
}

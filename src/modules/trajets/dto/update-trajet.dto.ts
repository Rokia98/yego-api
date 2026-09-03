import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

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
  prix?: number;

  @IsOptional()
  @IsString()
  joursRecurrence?: string;

  @IsOptional()
  @IsString()
  statut?: string;
}

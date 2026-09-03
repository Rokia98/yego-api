import { IsInt, IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateTrajetDto {
  @IsInt()
  compagnieId: number;

  @IsInt()
  villeDepartId: number;

  @IsInt()
  villeArriveeId: number;

  @IsString()
  heureDepart: string; // format 'HH:mm'

  @IsOptional()
  @IsString()
  heureArriveeEstimee?: string;

  @IsNumber()
  prix: number;

  @IsOptional()
  @IsString()
  joursRecurrence?: string;
}

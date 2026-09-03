import { IsNumber, IsPositive, IsOptional, IsString } from 'class-validator';

export class UpdateReservationDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  nombrePlaces?: number;

  @IsOptional()
  @IsString()
  statut?: string;
}

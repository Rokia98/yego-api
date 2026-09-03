import { IsNumber, IsPositive, IsString, IsOptional } from 'class-validator';

export class CreateTicketDto {
  @IsNumber()
  @IsPositive()
  reservationId: number;

  @IsOptional()
  @IsString()
  siege?: string;
}

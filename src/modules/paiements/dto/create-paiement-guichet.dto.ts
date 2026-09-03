import { IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class CreatePaiementGuichetDto {
  @IsInt()
  @IsPositive()
  reservationId: number;

  @IsIn(['orange_money', 'mtn_money', 'moov_money', 'wave', 'espece'])
  moyenPaiement: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  referenceTransaction?: string;
}

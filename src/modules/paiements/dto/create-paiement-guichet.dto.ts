import { IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { MOYENS_PAIEMENT } from '../../../common/moyens-paiement';

export class CreatePaiementGuichetDto {
  @IsInt()
  @IsPositive()
  reservationId: number;

  @IsIn(MOYENS_PAIEMENT)
  moyenPaiement: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  referenceTransaction?: string;
}

import { IsInt, IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { PRIX_BILLET_MAX, PRIX_BILLET_MIN } from '../../../config/constants';

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

  // Borné : un prix nul ou négatif donnerait des billets gratuits (et Jèko
  // refuse un encaissement sous 5 F).
  @IsNumber()
  @Min(PRIX_BILLET_MIN)
  @Max(PRIX_BILLET_MAX)
  prix: number;

  @IsOptional()
  @IsString()
  joursRecurrence?: string;
}

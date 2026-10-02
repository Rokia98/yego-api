import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, Matches, Max, Min } from 'class-validator';
import {
  MOYENS_MOBILE_MONEY,
  TELEPHONE_MOBILE_MONEY_CI,
} from '../../../common/moyens-paiement';
import { normaliserTelephone } from '../../../common/telephone';

export class CreerReversementDto {
  @IsInt()
  @IsPositive()
  compagnieId: number;
}

// Compte Mobile Money qui reçoit les reversements de la compagnie.
export class CoordonneesReversementDto {
  @IsIn(MOYENS_MOBILE_MONEY)
  moyen: string;

  @Transform(({ value }) => normaliserTelephone(value))
  @Matches(TELEPHONE_MOBILE_MONEY_CI, {
    message: 'telephone doit être un numéro mobile ivoirien (+225 01/05/07…)',
  })
  telephone: string;
}

export class ListeReversementsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  compagnieId?: number;

  @IsOptional()
  @IsIn(['en_cours', 'effectue', 'echoue'])
  statut?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}

export class ApercuReversementQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  compagnieId?: number;
}

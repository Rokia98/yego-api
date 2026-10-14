import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  MOYENS_ENCAISSEMENT_YEGO,
  MOYENS_MOBILE_MONEY,
  MoyenEncaissementYego,
  TELEPHONE_MOBILE_MONEY_CI,
} from '../../../common/moyens-paiement';
import { normaliserTelephone } from '../../../common/telephone';

export class CreerReversementDto {
  @IsInt()
  @IsPositive()
  compagnieId: number;

  // Opérateur du numéro de Yègo qui reçoit les fonds à remettre.
  @IsIn(MOYENS_ENCAISSEMENT_YEGO)
  moyen: MoyenEncaissementYego;
}

export class ApprouverDemandeReversementDto {
  @IsIn(MOYENS_ENCAISSEMENT_YEGO)
  moyen: MoyenEncaissementYego;
}

export class RemiseReversementDto {
  // Ex. « remis en espèces à M. Koné, reçu n° 12 ».
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
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

  // true : fonds arrivés chez Yègo, pas encore remis à la compagnie.
  @IsOptional()
  @IsIn(['true', 'false'])
  aRemettre?: string;

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

export class DemanderReversementDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  commentaire?: string;
}

export class RejeterDemandeReversementDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  motif: string;
}

export class ListeDemandesReversementQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  compagnieId?: number;

  @IsOptional()
  @IsIn(['en_attente', 'approuvee', 'rejetee', 'annulee'])
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

// Retrait de la part Yègo : le numéro est fixé côté serveur
// (RETRAIT_YEGO_TELEPHONE), seul l'opérateur se choisit.
export class CreerRetraitDto {
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(2_000_000)
  montant: number;

  @IsIn(MOYENS_ENCAISSEMENT_YEGO)
  moyen: MoyenEncaissementYego;

  // Mot de passe de l'admin, redemandé avant toute sortie d'argent.
  @IsString()
  @MinLength(1)
  motDePasse: string;
}

export class ApercuReversementQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  compagnieId?: number;
}

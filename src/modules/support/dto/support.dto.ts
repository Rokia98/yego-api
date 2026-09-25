import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SUPPORT } from '../../../config/constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreerDemandeDto {
  @IsIn(SUPPORT.CATEGORIES)
  categorie: string;

  @IsString()
  @Transform(trim)
  @MinLength(SUPPORT.SUJET_MIN)
  @MaxLength(SUPPORT.SUJET_MAX)
  sujet: string;

  // Premier message de la demande.
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(SUPPORT.MESSAGE_MAX)
  message: string;

  // Réservation concernée : la sienne (voyageur) ou une de sa compagnie
  // (personnel). Sert aussi à rattacher la demande à la compagnie.
  @IsOptional()
  @IsInt()
  @IsPositive()
  reservationId?: number;
}

export class AjouterMessageDto {
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(SUPPORT.MESSAGE_MAX)
  contenu: string;

  // Note interne : admin uniquement (403 sinon).
  @IsOptional()
  @IsBoolean()
  interne?: boolean;
}

export class ModifierDemandeDto {
  @IsOptional()
  @IsIn(SUPPORT.STATUTS)
  statut?: string;

  @IsOptional()
  @IsIn(SUPPORT.PRIORITES)
  priorite?: string;
}

// Filtres de GET /support/demandes (tous optionnels, dans la portée).
export class ListeDemandesDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  take?: number;

  @IsOptional()
  @IsIn(SUPPORT.STATUTS)
  statut?: string;

  @IsOptional()
  @IsIn(SUPPORT.CATEGORIES)
  categorie?: string;

  // voyageur = demande ouverte par un voyageur ; compagnie = par le personnel.
  @IsOptional()
  @IsIn(['voyageur', 'compagnie'])
  origine?: 'voyageur' | 'compagnie';

  // Admin plateforme uniquement ; ignoré pour les autres.
  @IsOptional()
  @IsInt()
  @IsPositive()
  compagnieId?: number;

  // Sujet, nom de l'auteur, ou "#12" / "12" pour l'id.
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(80)
  q?: string;
}

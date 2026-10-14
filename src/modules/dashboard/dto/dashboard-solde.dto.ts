import { IsOptional, Matches } from 'class-validator';
import { ApercuReversementQuery } from '../../reversements/dto/reversement.dto';

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

// GET /dashboard/solde : compagnieId (admin) + période optionnelle, sur la
// date de paiement, appliquée au bloc guichet seulement.
export class DashboardSoldeDto extends ApercuReversementQuery {
  @IsOptional()
  @Matches(JOUR, { message: 'du doit être au format YYYY-MM-DD' })
  du?: string;

  @IsOptional()
  @Matches(JOUR, { message: 'au doit être au format YYYY-MM-DD' })
  au?: string;
}

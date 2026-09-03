import { API_CONFIG } from '../config/constants';

const MAX = API_CONFIG.PAGINATION.MAX_TAKE; // 100
const DEFAULT_TAKE = API_CONFIG.PAGINATION.DEFAULT_TAKE; // 10

/**
 * Normalise les paramètres de pagination reçus en query string :
 * - skip : entier ≥ 0 (0 par défaut) ;
 * - take : entier entre 1 et MAX_TAKE (10 par défaut).
 * Empêche `?take=999999` de charger toute la table.
 */
export function paginer(
  skip?: number | string,
  take?: number | string,
): { skip: number; take: number } {
  const s = Math.trunc(Number(skip));
  const t = Math.trunc(Number(take));
  return {
    skip: Number.isFinite(s) && s > 0 ? s : 0,
    take: Number.isFinite(t) && t > 0 ? Math.min(t, MAX) : DEFAULT_TAKE,
  };
}

// Moyens de paiement côté Yègo, et leur correspondance chez Jèko.
//
// La base et les fronts gardent les noms Yègo historiques (orange_money,
// mtn_money…) ; seul le client Jèko parle en noms Jèko (orange, mtn…).

export const MOYENS_MOBILE_MONEY = [
  'orange_money',
  'mtn_money',
  'moov_money',
  'wave',
  'djamo',
] as const;

export const MOYENS_PAIEMENT = [...MOYENS_MOBILE_MONEY, 'espece'] as const;

export type MoyenMobileMoney = (typeof MOYENS_MOBILE_MONEY)[number];

export type MoyenJeko = 'orange' | 'mtn' | 'moov' | 'wave' | 'djamo';

const VERS_JEKO: Record<MoyenMobileMoney, MoyenJeko> = {
  orange_money: 'orange',
  mtn_money: 'mtn',
  moov_money: 'moov',
  wave: 'wave',
  djamo: 'djamo',
};

export function versMoyenJeko(moyen: string): MoyenJeko | null {
  return VERS_JEKO[moyen as MoyenMobileMoney] ?? null;
}

export function depuisMoyenJeko(moyen: string | undefined): MoyenMobileMoney | null {
  const trouve = Object.entries(VERS_JEKO).find(([, j]) => j === moyen);
  return (trouve?.[0] as MoyenMobileMoney | undefined) ?? null;
}

// MTN et Moov confirment par USSD poussé sur le téléphone : pas de page
// opérateur, l'app affiche un écran d'attente.
export function confirmeParUssd(moyen: string): boolean {
  return moyen === 'mtn_money' || moyen === 'moov_money';
}

// Format exigé par Jèko pour un payeur / bénéficiaire mobile money ivoirien.
export const TELEPHONE_MOBILE_MONEY_CI = /^\+225(01|05|07)[0-9]{8}$/;

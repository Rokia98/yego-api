import { Prisma } from '@prisma/client';

// Frais de service Yègo sur un achat en ligne, arrondis au franc (pas de
// centimes en XOF) : 5 % de 15 000 F = 750 F.
export function calculerFraisService(
  montant: Prisma.Decimal,
  pourcent: number,
): Prisma.Decimal {
  return montant
    .times(pourcent)
    .dividedBy(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
}

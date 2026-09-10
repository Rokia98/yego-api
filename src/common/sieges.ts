import { Prisma } from '@prisma/client';

// Format accepté pour un numéro de siège : ex. « A1 », « 12 », « B14 ».
export const SIEGE_REGEX = /^[A-Za-z]{0,2}[0-9]{1,3}$/;

// Accepte le client Prisma ou un client de transaction.
type DbClient = Pick<Prisma.TransactionClient, 'ticket' | 'reservation'>;

/**
 * Sièges déjà pris sur un départ :
 *  - siège porté par un ticket non annulé,
 *  - siège retenu par une réservation confirmée (le voyageur choisit sa place
 *    AVANT le paiement ; le siège est réservé dès la création de la réservation).
 *
 * `exclureReservationId` : ne compte pas les sièges retenus par cette
 * réservation (utile pour revalider la sienne, ou générer son ticket sans
 * entrer en collision avec son propre choix).
 */
export async function siegesOccupesDepart(
  db: DbClient,
  departId: number,
  exclureReservationId?: number,
): Promise<Set<string>> {
  const [tickets, reservations] = await Promise.all([
    db.ticket.findMany({
      where: {
        statut: { not: 'annule' },
        siege: { not: null },
        reservation: { departId },
      },
      select: { siege: true },
    }),
    db.reservation.findMany({
      where: {
        departId,
        statut: 'confirmee',
        ...(exclureReservationId ? { id: { not: exclureReservationId } } : {}),
      },
      select: { sieges: true },
    }),
  ]);

  const pris = new Set<string>();
  for (const t of tickets) if (t.siege) pris.add(t.siege);
  for (const r of reservations) for (const s of r.sieges) pris.add(s);
  return pris;
}

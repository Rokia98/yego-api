import { PrismaService } from '../prisma.service';
import { Notif, NotificationsService } from '../modules/notifications/notifications.service';

/**
 * Notifie tous les voyageurs ayant une réservation confirmée (et un compte) sur
 * l'un des départs donnés. Best-effort — ne lève jamais (voir NotificationsService).
 * Renvoie le nombre de voyageurs notifiés.
 */
export async function notifierVoyageursDeparts(
  prisma: PrismaService,
  notifications: NotificationsService,
  departIds: number[],
  notif: Notif,
): Promise<number> {
  if (departIds.length === 0) return 0;

  const reservations = await prisma.reservation.findMany({
    where: {
      departId: { in: departIds },
      statut: 'confirmee',
      utilisateurId: { not: null },
    },
    select: { utilisateurId: true },
  });

  for (const r of reservations) {
    await notifications.notifier(r.utilisateurId, notif);
  }
  return reservations.length;
}

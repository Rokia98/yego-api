import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CompagnieStatut } from '../config/constants';

/**
 * Une compagnie est « opérationnelle » (peut publier des trajets/départs et
 * vendre) si :
 *  - son statut plateforme est 'actif' (validée, non suspendue), ET
 *  - elle a au moins un abonnement 'actif' non expiré.
 *
 * Utilisé pour bloquer les écritures métier d'une compagnie non à jour.
 * N'empêche PAS d'honorer les tickets déjà vendus ni les annulations.
 */
export async function assertCompagnieOperationnelle(
  prisma: PrismaService,
  compagnieId: number,
): Promise<void> {
  const compagnie = await prisma.compagnie.findUnique({
    where: { id: compagnieId },
    select: {
      statut: true,
      abonnements: {
        where: { statut: 'actif', dateFin: { gte: new Date() } },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!compagnie) {
    throw new ForbiddenException('Compagnie introuvable');
  }
  if (compagnie.statut !== CompagnieStatut.ACTIF) {
    throw new ForbiddenException(
      "Cette compagnie n'est pas active (en attente de validation ou suspendue)",
    );
  }
  if (compagnie.abonnements.length === 0) {
    throw new ForbiddenException(
      "Cette compagnie n'a pas d'abonnement actif à la plateforme",
    );
  }
}

// Fragment Prisma pour ne lister que les compagnies opérationnelles
// (recherche voyageur).
export function filtreCompagnieOperationnelle() {
  return {
    statut: CompagnieStatut.ACTIF,
    abonnements: {
      some: { statut: 'actif', dateFin: { gte: new Date() } },
    },
  };
}

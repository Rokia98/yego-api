import { ForbiddenException } from '@nestjs/common';
import { ROLES_LIES_COMPAGNIE, UserRole } from '../config/constants';
import { AuthenticatedUser } from '../modules/auth/strategies/jwt.strategy';

/**
 * Une ressource "voyageur" (réservation, ticket, paiement) est visible par :
 * - l'admin plateforme ;
 * - le voyageur propriétaire ;
 * - un agent / company_admin de la compagnie qui opère le départ concerné.
 */
export function peutVoirRessourceVoyageur(
  user: AuthenticatedUser,
  proprietaireId: number | null,
  compagnieId: number,
): boolean {
  if (user.role === UserRole.ADMIN) return true;
  if (proprietaireId != null && proprietaireId === user.userId) return true;
  if (
    ROLES_LIES_COMPAGNIE.includes(user.role) &&
    user.compagnieId != null &&
    user.compagnieId === compagnieId
  ) {
    return true;
  }
  return false;
}

/**
 * Restreint une action à la compagnie de l'utilisateur.
 * - admin plateforme : accès total.
 * - agent / company_admin : uniquement les ressources de leur compagnie.
 * - autres rôles : refusé (ils ne devraient pas atteindre ce point).
 */
export function assertCompagnieScope(
  user: AuthenticatedUser,
  compagnieId: number,
): void {
  if (user.role === UserRole.ADMIN) return;

  if (user.compagnieId == null || user.compagnieId !== compagnieId) {
    throw new ForbiddenException(
      "Action limitée aux ressources de votre compagnie",
    );
  }
}

/**
 * Pour une création : détermine la compagnie cible.
 * - admin : doit fournir compagnieId explicitement.
 * - agent / company_admin : forcé à leur propre compagnie (toute autre valeur
 *   fournie est rejetée).
 */
export function resoudreCompagnieCible(
  user: AuthenticatedUser,
  compagnieIdDemande: number | undefined,
): number {
  if (user.role === UserRole.ADMIN) {
    if (compagnieIdDemande == null) {
      throw new ForbiddenException(
        'compagnieId est requis pour un administrateur plateforme',
      );
    }
    return compagnieIdDemande;
  }

  if (user.compagnieId == null) {
    throw new ForbiddenException("Votre compte n'est rattaché à aucune compagnie");
  }
  if (compagnieIdDemande != null && compagnieIdDemande !== user.compagnieId) {
    throw new ForbiddenException(
      'Vous ne pouvez agir que pour votre propre compagnie',
    );
  }
  return user.compagnieId;
}

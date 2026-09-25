import { UserRole } from './constants';

/**
 * Permissions applicatives. Chaque permission représente une capacité précise ;
 * une route déclare celles qu'elle exige via @RequirePermissions().
 *
 * Le rôle donne l'ensemble des permissions (matrice ci-dessous). Pour les rôles
 * liés à une compagnie (agent, company_admin), la permission autorise l'action
 * *mais* un contrôle de périmètre (assertCompagnieScope) la restreint ensuite
 * aux ressources de la compagnie de l'utilisateur.
 */
export const PERMISSIONS = {
  // Compagnies
  COMPAGNIE_CREATE: 'compagnie:create',
  COMPAGNIE_UPDATE: 'compagnie:update', // infos (nom, logo, contact)
  COMPAGNIE_MODERATE: 'compagnie:moderate', // statut : en_attente / actif / suspendu
  COMPAGNIE_DELETE: 'compagnie:delete',
  // Référentiel géographique
  VILLE_MANAGE: 'ville:manage',
  // Offre de transport
  TRAJET_MANAGE: 'trajet:manage',
  DEPART_MANAGE: 'depart:manage',
  // Flotte (véhicules & chauffeurs)
  FLOTTE_READ: 'flotte:read',
  VEHICULE_MANAGE: 'vehicule:manage',
  CHAUFFEUR_MANAGE: 'chauffeur:manage',
  // Exploitation
  RESERVATION_GUICHET: 'reservation:guichet',
  TICKET_VALIDATE: 'ticket:validate',
  REMBOURSEMENT_CONFIRM: 'remboursement:confirm',
  // Personnel
  AGENT_MANAGE: 'agent:manage', // gérer les agents guichet de sa compagnie
  // Abonnement plateforme
  ABONNEMENT_MANAGE: 'abonnement:manage', // créer / renouveler (admin)
  ABONNEMENT_READ: 'abonnement:read', // consulter celui de sa compagnie
  // Pilotage
  DASHBOARD_READ: 'dashboard:read', // statistiques (admin : toutes compagnies ; company_admin : la sienne)
  // Support (demandes d'assistance)
  SUPPORT_CREATE: 'support:create', // ouvrir une demande (voyageur, personnel compagnie)
  SUPPORT_MANAGE: 'support:manage', // traiter (admin ; company_admin : demandes voyageurs de sa compagnie)
  // Administration
  UTILISATEUR_LIST: 'utilisateur:list',
  UTILISATEUR_CREATE: 'utilisateur:create',
  UTILISATEUR_SET_ROLE: 'utilisateur:set_role',
  AUDIT_READ: 'audit:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// L'admin plateforme a toutes les permissions (sentinelle '*').
const TOUTES = '*' as const;

export const MATRICE_PERMISSIONS: Record<UserRole, Permission[] | typeof TOUTES> = {
  [UserRole.USER]: [PERMISSIONS.SUPPORT_CREATE],

  [UserRole.AGENT]: [
    PERMISSIONS.DEPART_MANAGE,
    PERMISSIONS.FLOTTE_READ,
    PERMISSIONS.RESERVATION_GUICHET,
    PERMISSIONS.TICKET_VALIDATE,
    PERMISSIONS.UTILISATEUR_CREATE,
    PERMISSIONS.SUPPORT_CREATE,
  ],

  [UserRole.COMPANY_ADMIN]: [
    PERMISSIONS.COMPAGNIE_UPDATE,
    PERMISSIONS.TRAJET_MANAGE,
    PERMISSIONS.DEPART_MANAGE,
    PERMISSIONS.FLOTTE_READ,
    PERMISSIONS.VEHICULE_MANAGE,
    PERMISSIONS.CHAUFFEUR_MANAGE,
    PERMISSIONS.RESERVATION_GUICHET,
    PERMISSIONS.TICKET_VALIDATE,
    PERMISSIONS.REMBOURSEMENT_CONFIRM,
    PERMISSIONS.AGENT_MANAGE,
    PERMISSIONS.ABONNEMENT_READ,
    PERMISSIONS.UTILISATEUR_CREATE,
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.SUPPORT_CREATE,
    PERMISSIONS.SUPPORT_MANAGE,
  ],

  [UserRole.ADMIN]: TOUTES,
};

export function aLaPermission(role: UserRole, permission: Permission): boolean {
  const accordees = MATRICE_PERMISSIONS[role];
  if (accordees === TOUTES) return true;
  return accordees.includes(permission);
}

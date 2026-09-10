export const API_CONFIG = {
  VERSION: 'v1',
  BASE_PATH: 'api/v1',
  PAGINATION: {
    DEFAULT_SKIP: 0,
    DEFAULT_TAKE: 10,
    MAX_TAKE: 100,
  },
};

// Rôles applicatifs. Stockés dans Utilisateur.role et portés par le JWT.
// Le contrôle d'accès fin se fait par permissions (voir config/permissions.ts,
// PermissionsGuard + @RequirePermissions()).
export enum UserRole {
  USER = 'user', // voyageur
  AGENT = 'agent', // agent de guichet d'une compagnie
  COMPANY_ADMIN = 'company_admin', // gestionnaire d'une compagnie
  ADMIN = 'admin', // administrateur de la plateforme
}

// Rôles liés à une compagnie : pour ceux-ci, Utilisateur.compagnieId est requis
// et les actions sont limitées aux ressources de cette compagnie.
export const ROLES_LIES_COMPAGNIE: UserRole[] = [
  UserRole.AGENT,
  UserRole.COMPANY_ADMIN,
];

export enum ReservationStatut {
  CONFIRMEE = 'confirmee',
  ANNULEE = 'annulee',
  // Réservation non payée dans le délai imparti : places libérées.
  EXPIREE = 'expiree',
}

// Recherche de départs côté voyageur : quand aucune date (ou pas de `dateFin`)
// n'est fournie, on balaie une fenêtre à partir d'aujourd'hui plutôt que d'exiger
// un jour exact. La fenêtre est bornée pour éviter les balayages trop larges.
export const RECHERCHE_DEPART = {
  FENETRE_DEFAUT_JOURS: 30,
  FENETRE_MAX_JOURS: 90,
} as const;

export enum CompagnieStatut {
  EN_ATTENTE = 'en_attente',
  ACTIF = 'actif',
  SUSPENDU = 'suspendu',
}

// Barème des frais retenus en cas d'annulation, selon le délai avant le départ.
// Le reste est remboursé au voyageur.
export const FRAIS_ANNULATION = [
  { joursMin: 3, fraction: 0.1 }, // 3 jours ou plus avant : 10 %
  { joursMin: 1, fraction: 0.25 }, // 1 à 2 jours avant : 25 %
  { joursMin: 0, fraction: 0.5 }, // jour du départ : 50 %
] as const;
// Départ déjà passé : aucun remboursement (100 % de frais).
export const FRAIS_ANNULATION_DEPART_PASSE = 1;

export enum PaiementStatut {
  EN_ATTENTE = 'en_attente',
  PAYE = 'paye',
  ECHOUE = 'echoue',
  REMBOURSE = 'rembourse',
}

export enum TicketStatut {
  VALIDE = 'valide',
  UTILISE = 'utilise',
  ANNULE = 'annule',
}

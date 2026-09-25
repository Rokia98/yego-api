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

export enum DepartStatut {
  PLANIFIE = 'planifie',
  EN_ROUTE = 'en_route',
  ARRIVE = 'arrive',
  ANNULE = 'annule',
}

export enum CompagnieDocumentType {
  REGISTRE_COMMERCE = 'registre_commerce',
  AUTORISATION_TRANSPORT = 'autorisation_transport',
  PIECE_IDENTITE_GERANT = 'piece_identite_gerant',
  AUTRE = 'autre',
}

export enum CompagnieDocumentStatut {
  EN_ATTENTE = 'en_attente',
  VALIDE = 'valide',
  REFUSE = 'refuse',
}

// Pièces d'inscription d'une compagnie : stockage sur disque (volume Docker),
// jamais en base — voir common/stockage-fichiers.ts et modules/documents.
export const DOCUMENTS = {
  TAILLE_MAX_OCTETS: 5 * 1024 * 1024, // 5 Mo
  MIME_AUTORISES: ['application/pdf', 'image/png', 'image/jpeg'] as const,
} as const;

// Suivi GPS temps réel d'un départ en cours.
export const SUIVI = {
  // Durée de vie du jeton de suivi remis au chauffeur au démarrage.
  TOKEN_TTL_HEURES: 24,
  // Au-delà, la dernière position est considérée périmée (plus de "live").
  POSITION_FRAICHE_SECONDES: 120,
  // Trajet routier ≈ distance à vol d'oiseau × ce facteur.
  FACTEUR_ROUTE: 1.3,
  // Vitesse de repli quand aucune vitesse fiable n'est disponible (km/h).
  VITESSE_DEFAUT_KMH: 65,
  // Retard (min) à partir duquel on considère un départ "en retard".
  RETARD_SEUIL_MINUTES: 20,
  // Palier de ré-notification : on ne renotifie qu'au franchissement d'un
  // nouveau multiple de cette valeur.
  RETARD_PALIER_MINUTES: 15,
  // Rétention des points GPS après la fin du trajet.
  RETENTION_POSITIONS_HEURES: 48,
  // Historique renvoyé par l'API (nb max de points).
  HISTORIQUE_MAX_POINTS: 500,
} as const;

// Dashboard : période par défaut (sans `from`/`to`) et bornes pour éviter
// d'agréger un historique trop large en une seule requête.
export const DASHBOARD = {
  PERIODE_DEFAUT_JOURS: 30,
  PERIODE_MAX_JOURS: 366,
  CLASSEMENT_LIMITE_DEFAUT: 10,
  CLASSEMENT_LIMITE_MAX: 50,
  // Série temporelle (courbes) : fenêtre bornée plus court, un point par jour.
  SERIE_MAX_JOURS: 92,
} as const;

// Support : demandes d'assistance (voyageurs + personnel des compagnies).
export const SUPPORT = {
  CATEGORIES: [
    'reservation',
    'paiement',
    'remboursement',
    'ticket',
    'compte',
    'abonnement',
    'technique',
    'autre',
  ],
  STATUTS: ['ouverte', 'en_cours', 'resolue', 'fermee'],
  PRIORITES: ['normale', 'haute'],
  SUJET_MIN: 5,
  SUJET_MAX: 150,
  MESSAGE_MAX: 4000,
} as const;

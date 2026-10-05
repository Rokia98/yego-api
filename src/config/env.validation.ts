import { plainToInstance, Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUrl,
  Max,
  Min,
  IsString,
  MinLength,
  validateSync,
} from 'class-validator';

// docker-compose transmet `VAR: ${VAR:-}` comme chaîne vide : on la traite
// comme absente, sinon @IsUrl / @MinLength la rejetteraient.
const videVersAbsent = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export enum Environnement {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Schéma des variables d'environnement. Validé au démarrage (voir
 * ConfigModule.forRoot({ validate }) dans app.module.ts) : si une variable
 * requise est absente ou faible, le process refuse de démarrer.
 */
export class EnvironmentVariables {
  @IsEnum(Environnement)
  NODE_ENV: Environnement = Environnement.Development;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  PORT = 3000;

  @IsString()
  DATABASE_URL: string;

  // Un secret faible est aussi dangereux qu'une absence de secret.
  @IsString()
  @MinLength(32, {
    message:
      'JWT_SECRET doit faire au moins 32 caractères. Générez-le avec: openssl rand -base64 48',
  })
  JWT_SECRET: string;

  // Durée de vie de l'access token. Courte volontairement : la révocation
  // repose sur cette fenêtre + le refresh token.
  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN = '15m';

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  REFRESH_TOKEN_EXPIRES_DAYS = 30;

  // Délai de paiement d'une réservation avant libération automatique des places.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  RESERVATION_PAIEMENT_TTL_MINUTES = 30;

  @IsString()
  @MinLength(16, {
    message:
      'PAYMENT_WEBHOOK_SECRET doit faire au moins 16 caractères et être distinct de JWT_SECRET.',
  })
  PAYMENT_WEBHOOK_SECRET: string;

  // Mode simulation de paiement : expose POST /paiements/reservation/:id/simuler
  // qui marque un paiement « payé » sans transaction réelle. Pour le dev et les
  // tests d'intégration de l'app. NE JAMAIS activer sur une vraie production.
  @IsOptional()
  @IsIn(['true', 'false'])
  PAYMENT_SIMULATION?: string;

  // ── Jèko (paiement en ligne + transferts) ─────────────────────────────────
  // Tout ou rien : dès que JEKO_API_KEY est fourni, les autres variables JEKO_*
  // sont exigées (voir validate()). Absentes = paiement en ligne non branché
  // (seuls la simulation et le guichet fonctionnent).
  @IsOptional()
  @Transform(videVersAbsent)
  @IsString()
  JEKO_API_KEY?: string;

  @IsOptional()
  @Transform(videVersAbsent)
  @IsString()
  JEKO_API_KEY_ID?: string;

  // Magasin Jèko de Yègo : encaisse les billets, débite les transferts.
  @IsOptional()
  @Transform(videVersAbsent)
  @IsString()
  JEKO_STORE_ID?: string;

  // Secret de signature des webhooks (Jeko-Signature = HMAC-SHA256 hex du corps).
  @IsOptional()
  @Transform(videVersAbsent)
  @IsString()
  @MinLength(16, { message: 'JEKO_WEBHOOK_SECRET doit faire au moins 16 caractères.' })
  JEKO_WEBHOOK_SECRET?: string;

  // Pages où l'opérateur ramène le payeur (reservationId et reference ajoutés
  // en query). Une redirection n'est PAS une preuve de paiement.
  @IsOptional()
  @Transform(videVersAbsent)
  @IsUrl({ require_tld: false, require_protocol: true })
  JEKO_SUCCESS_URL?: string;

  @IsOptional()
  @Transform(videVersAbsent)
  @IsUrl({ require_tld: false, require_protocol: true })
  JEKO_ERROR_URL?: string;

  @IsOptional()
  @Transform(videVersAbsent)
  @IsUrl({ require_tld: false, require_protocol: true })
  JEKO_API_URL = 'https://api.jeko.africa';

  // Deep link de l'app mobile vers lequel relaie GET /jeko/retour/:statut.
  @IsOptional()
  @Transform(videVersAbsent)
  @IsString()
  APP_DEEP_LINK_PAIEMENT?: string;

  // Frais de service Yègo ajoutés au prix des billets achetés en ligne (en %).
  // Payés par le voyageur, ni remboursés ni reversés à la compagnie.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @Min(0)
  @Max(20)
  FRAIS_SERVICE_POURCENT = 5;

  // Commission Yègo retenue sur chaque reversement aux compagnies (en %).
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @Min(0)
  @Max(50)
  REVERSEMENT_COMMISSION_POURCENT = 0;

  // Seed au démarrage du conteneur (comptes de démo aux mots de passe publics,
  // cf. README). Interdit en production — voir validate().
  @IsOptional()
  @IsIn(['true', 'false'])
  SEED_ON_START?: string;

  // Clé privée Ed25519 (PEM PKCS#8) qui signe les QR des tickets pour la
  // validation hors-ligne. Optionnelle : sans elle, une paire éphémère est
  // générée au démarrage (dev). À définir en production.
  @IsOptional()
  @IsString()
  TICKET_SIGNING_PRIVATE_KEY?: string;

  // Dossier de stockage des documents uploadés (compagnies…). En conteneur,
  // pointe vers un volume Docker dédié pour survivre aux redéploiements.
  @IsOptional()
  @IsString()
  UPLOADS_DIR = './uploads';

  // Liste d'origines séparées par des virgules. Vide/absent = aucune origine
  // navigateur autorisée (les clients non-navigateur ne sont pas concernés).
  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;

  @IsOptional()
  @IsString()
  LOG_LEVEL = 'log';

  // Nombre de proxys de confiance devant l'API (ngrok, load balancer…) : l'IP
  // du visiteur est alors lue dans X-Forwarded-For, sinon tous les visiteurs
  // partagent l'IP du proxy et la limitation de débit devient commune (un
  // attaquant bloque les connexions de tout le monde). 0 = accès direct :
  // ne PAS l'activer sans proxy, l'en-tête serait falsifiable.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY = 0;

  // Notifications push (Firebase Cloud Messaging). Toutes optionnelles :
  // sans elles, les notifications sont persistées (fil in-app) mais pas
  // envoyées en push — utile en dev / sans compte Firebase.
  @IsOptional()
  @IsString()
  FCM_PROJECT_ID?: string;

  @IsOptional()
  @IsString()
  FCM_CLIENT_EMAIL?: string;

  @IsOptional()
  @IsString()
  FCM_PRIVATE_KEY?: string;
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('\n  - ');
    throw new Error(
      `Configuration d'environnement invalide :\n  - ${details}\n` +
        'Copiez .env.example vers .env et renseignez les valeurs.',
    );
  }

  if (validated.PAYMENT_WEBHOOK_SECRET === validated.JWT_SECRET) {
    throw new Error(
      'PAYMENT_WEBHOOK_SECRET doit être distinct de JWT_SECRET.',
    );
  }

  if (validated.JEKO_API_KEY) {
    const manquantes = (
      [
        'JEKO_API_KEY_ID',
        'JEKO_STORE_ID',
        'JEKO_WEBHOOK_SECRET',
        'JEKO_SUCCESS_URL',
        'JEKO_ERROR_URL',
      ] as const
    ).filter((k) => !validated[k]);
    if (manquantes.length > 0) {
      throw new Error(
        `JEKO_API_KEY est défini mais il manque : ${manquantes.join(', ')}.`,
      );
    }
    if (
      validated.JEKO_WEBHOOK_SECRET === validated.JWT_SECRET ||
      validated.JEKO_WEBHOOK_SECRET === validated.PAYMENT_WEBHOOK_SECRET
    ) {
      throw new Error(
        'JEKO_WEBHOOK_SECRET doit être distinct de JWT_SECRET et de PAYMENT_WEBHOOK_SECRET.',
      );
    }
  }

  if (
    validated.NODE_ENV === Environnement.Production &&
    (!validated.CORS_ORIGIN || validated.CORS_ORIGIN.trim() === '*')
  ) {
    throw new Error(
      'En production, CORS_ORIGIN doit lister explicitement les origines autorisées (jamais "*").',
    );
  }

  // Deux flags de dev qui, en production, reviennent à ouvrir la caisse :
  // paiements confirmables sans transaction, comptes aux mots de passe connus.
  if (validated.NODE_ENV === Environnement.Production) {
    if (validated.PAYMENT_SIMULATION === 'true') {
      throw new Error(
        'PAYMENT_SIMULATION=true est interdit en production (paiements confirmables sans transaction réelle).',
      );
    }
    if (validated.SEED_ON_START === 'true') {
      throw new Error(
        'SEED_ON_START=true est interdit en production (comptes de démonstration aux mots de passe publics).',
      );
    }
  }

  return validated;
}

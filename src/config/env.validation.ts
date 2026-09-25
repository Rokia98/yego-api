import { plainToInstance, Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
  validateSync,
} from 'class-validator';

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

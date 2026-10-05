import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Derrière un proxy (ngrok, load balancer) : IP réelle du visiteur pour la
  // limitation de débit et l'audit (voir TRUST_PROXY).
  const proxys = Number(config.get('TRUST_PROXY') ?? 0);
  if (proxys > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', proxys);
  }

  // En-têtes HTTP de sécurité (XSS, sniffing, clickjacking, HSTS, etc.).
  app.use(helmet());

  // Limite la taille des corps de requête : réduit la surface d'attaque DoS.
  // `verify` conserve le corps brut (req.rawBody) : la signature des webhooks
  // Jèko porte sur les octets reçus, pas sur le JSON reparsé.
  app.use(
    json({
      limit: '100kb',
      verify: (req, _res, buf) => {
        (req as typeof req & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '100kb' }));

  // CORS : liste blanche d'origines (CORS_ORIGIN, séparées par des virgules).
  // Les identifiants ne sont autorisés que si une liste explicite est fournie
  // (le couple origin:'*' + credentials:true est invalide côté navigateur).
  // Absent = aucune origine navigateur autorisée (comme annoncé dans
  // env.validation) ; '*' doit être demandé explicitement (dev uniquement,
  // refusé en production). Les apps mobiles ne sont pas concernées par CORS.
  const corsOrigin = config.get<string>('CORS_ORIGIN')?.trim();
  if (!corsOrigin) {
    app.enableCors({ origin: false });
  } else if (corsOrigin === '*') {
    app.enableCors({ origin: '*', credentials: false });
  } else {
    app.enableCors({
      origin: corsOrigin.split(',').map((o) => o.trim()),
      credentials: true,
    });
  }

  app.useGlobalFilters(new AllExceptionsFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.setGlobalPrefix('api/v1');

  // Ferme proprement les connexions Prisma sur SIGTERM/SIGINT (arrêt conteneur).
  app.enableShutdownHooks();

  // Documentation OpenAPI — désactivée en production sauf SWAGGER_ENABLED=true.
  if (
    config.get('NODE_ENV') !== 'production' ||
    config.get('SWAGGER_ENABLED') === 'true'
  ) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Yègo API')
      .setDescription('API de réservation de tickets de transport interurbain')
      .setVersion(process.env.npm_package_version ?? '0.29.1')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/v1/docs', app, document);
  }

  if (config.get('PAYMENT_SIMULATION') === 'true') {
    logger.warn(
      '⚠️  PAYMENT_SIMULATION=true : les paiements peuvent être confirmés sans ' +
        'transaction réelle (POST /paiements/reservation/:id/simuler). ' +
        'À désactiver sur une vraie production.',
    );
  }

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`Yègo API démarrée sur le port ${port} (préfixe /api/v1)`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Erreur au démarrage:', err);
  process.exit(1);
});

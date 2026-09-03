import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // En-têtes HTTP de sécurité (XSS, sniffing, clickjacking, HSTS, etc.).
  app.use(helmet());

  // Limite la taille des corps de requête : réduit la surface d'attaque DoS.
  app.use(json({ limit: '100kb' }));
  app.use(urlencoded({ extended: true, limit: '100kb' }));

  // CORS : liste blanche d'origines (CORS_ORIGIN, séparées par des virgules).
  // Les identifiants ne sont autorisés que si une liste explicite est fournie
  // (le couple origin:'*' + credentials:true est invalide côté navigateur).
  const corsOrigin = config.get<string>('CORS_ORIGIN')?.trim();
  if (!corsOrigin || corsOrigin === '*') {
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
      .setVersion('0.11.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/v1/docs', app, document);
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

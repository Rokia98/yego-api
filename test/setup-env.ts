// Variables d'environnement pour les tests e2e — chargées avant AppModule
// (qui valide le schéma d'environnement au démarrage).
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'e2e-secret-au-moins-trente-deux-caracteres!!';
process.env.JWT_EXPIRES_IN = '15m';
process.env.PAYMENT_WEBHOOK_SECRET =
  process.env.PAYMENT_WEBHOOK_SECRET ?? 'e2e-webhook-secret-16+';
process.env.RESERVATION_PAIEMENT_TTL_MINUTES = '30';
// La base de test : schéma dédié dans la base de dev, ou DATABASE_URL_TEST en CI.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  process.env.DATABASE_URL ??
  'postgresql://yego:yego@localhost:5432/yego_test?schema=public';

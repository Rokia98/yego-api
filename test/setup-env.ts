// Variables d'environnement pour les tests e2e — chargées avant AppModule
// (qui valide le schéma d'environnement au démarrage).
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'e2e-secret-au-moins-trente-deux-caracteres!!';
process.env.JWT_EXPIRES_IN = '15m';
process.env.PAYMENT_WEBHOOK_SECRET =
  process.env.PAYMENT_WEBHOOK_SECRET ?? 'e2e-webhook-secret-16+';
process.env.PAYMENT_SIMULATION = 'true';
process.env.UPLOADS_DIR = process.env.UPLOADS_DIR ?? './uploads-test';
process.env.RESERVATION_PAIEMENT_TTL_MINUTES = '30';
// Jèko désactivé par défaut, quel que soit le .env local (pas de vrai appel
// depuis les tests) ; jeko-env.ts le réactive vers un faux serveur.
for (const k of [
  'JEKO_API_KEY',
  'JEKO_API_KEY_ID',
  'JEKO_STORE_ID',
  'JEKO_WEBHOOK_SECRET',
  'JEKO_SUCCESS_URL',
  'JEKO_ERROR_URL',
  'JEKO_API_URL',
  'REVERSEMENT_COMMISSION_POURCENT',
  // Pas de vrai Firebase depuis les tests (push en mode journalisation).
  'FCM_PROJECT_ID',
  'FCM_CLIENT_EMAIL',
  'FCM_PRIVATE_KEY',
  // Base hébergée de l'API Docker : jamais utilisée par les tests.
  'API_DATABASE_URL',
]) {
  process.env[k] = '';
}
// La base de test : schéma dédié dans la base de dev, ou DATABASE_URL_TEST en CI.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  process.env.DATABASE_URL ??
  'postgresql://yego:yego@localhost:5432/yego_test?schema=public';

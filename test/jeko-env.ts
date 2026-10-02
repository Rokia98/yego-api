// Active Jèko pour jeko.e2e-spec.ts, AVANT l'import d'AppModule (la config est
// validée à l'import). Les appels partent vers un faux serveur Jèko local.
export const JEKO_PORT_STUB = 4599;
export const JEKO_WEBHOOK_SECRET_E2E = 'jeko-webhook-secret-e2e';

process.env.JEKO_API_KEY = 'cle-e2e';
process.env.JEKO_API_KEY_ID = 'id-cle-e2e';
process.env.JEKO_STORE_ID = 'store-e2e';
process.env.JEKO_WEBHOOK_SECRET = JEKO_WEBHOOK_SECRET_E2E;
process.env.JEKO_SUCCESS_URL = 'https://yego.test/paiement/succes';
process.env.JEKO_ERROR_URL = 'https://yego.test/paiement/echec';
process.env.JEKO_API_URL = `http://127.0.0.1:${JEKO_PORT_STUB}`;
process.env.REVERSEMENT_COMMISSION_POURCENT = '10';

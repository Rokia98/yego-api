import { validate } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  PAYMENT_WEBHOOK_SECRET: 'y'.repeat(16),
};

describe('validate (env)', () => {
  it('accepte une configuration minimale valide', () => {
    expect(() => validate({ ...base })).not.toThrow();
  });

  it('convertit PORT (chaîne) en entier', () => {
    const res = validate({ ...base, PORT: '8080' });
    expect(res.PORT).toBe(8080);
  });

  it('rejette un JWT_SECRET trop court', () => {
    expect(() => validate({ ...base, JWT_SECRET: 'trop-court' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('rejette PAYMENT_WEBHOOK_SECRET égal à JWT_SECRET', () => {
    const secret = 'z'.repeat(32);
    expect(() =>
      validate({ ...base, JWT_SECRET: secret, PAYMENT_WEBHOOK_SECRET: secret }),
    ).toThrow(/distinct/);
  });

  it('rejette CORS_ORIGIN="*" en production', () => {
    expect(() =>
      validate({ ...base, NODE_ENV: 'production', CORS_ORIGIN: '*' }),
    ).toThrow(/CORS_ORIGIN/);
  });

  it('accepte une liste CORS_ORIGIN explicite en production', () => {
    expect(() =>
      validate({
        ...base,
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.yego.ci',
      }),
    ).not.toThrow();
  });
});

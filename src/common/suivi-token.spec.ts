import { signerSuiviToken, verifierSuiviToken } from './suivi-token';

describe('suivi-token', () => {
  const OLD = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'x'.repeat(40);
  });
  afterAll(() => {
    process.env.JWT_SECRET = OLD;
  });

  it('signe puis relit le departId', () => {
    const { token, expireA } = signerSuiviToken(42, 3600);
    expect(expireA.getTime()).toBeGreaterThan(Date.now());
    expect(verifierSuiviToken(token)).toBe(42);
  });

  it('rejette un jeton expiré', () => {
    const { token } = signerSuiviToken(42, -10);
    expect(verifierSuiviToken(token)).toBeNull();
  });

  it('rejette une signature altérée', () => {
    const { token } = signerSuiviToken(7, 3600);
    const [payload] = token.split('.');
    expect(verifierSuiviToken(`${payload}.zzzz`)).toBeNull();
  });

  it('rejette un format invalide', () => {
    expect(verifierSuiviToken('nimportequoi')).toBeNull();
  });
});

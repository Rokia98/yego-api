import {
  ChargeTicket,
  clePubliquePem,
  estJetonSigne,
  signerTicket,
  verifierTicket,
} from './ticket-signature';

const charge: ChargeTicket = {
  t: 42,
  r: 7,
  d: 3,
  c: 1,
  s: '12',
  dd: '2026-09-15',
};

describe('ticket-signature', () => {
  it('signe puis vérifie un jeton (aller-retour)', () => {
    const jeton = signerTicket(charge);
    expect(estJetonSigne(jeton)).toBe(true);

    const verif = verifierTicket(jeton);
    expect(verif.valide).toBe(true);
    expect(verif.charge).toEqual(charge);
  });

  it('rejette une signature altérée', () => {
    const jeton = signerTicket(charge);
    const [prefixe, corps] = jeton.split('.');
    const falsifie = `${prefixe}.${corps}.${Buffer.from('faux').toString('base64url')}`;

    const verif = verifierTicket(falsifie);
    expect(verif.valide).toBe(false);
    expect(verif.raison).toBe('signature');
  });

  it('rejette une charge modifiée (siège changé)', () => {
    const jeton = signerTicket(charge);
    const [prefixe, , signature] = jeton.split('.');
    const autreCorps = Buffer.from(
      JSON.stringify({ ...charge, s: '99' }),
    ).toString('base64url');

    const verif = verifierTicket(`${prefixe}.${autreCorps}.${signature}`);
    expect(verif.valide).toBe(false);
  });

  it('rejette un format non-Yègo', () => {
    expect(verifierTicket('550e8400-e29b-41d4-a716-446655440000').raison).toBe(
      'format',
    );
    expect(estJetonSigne('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('expose une clé publique PEM SPKI', () => {
    expect(clePubliquePem()).toContain('BEGIN PUBLIC KEY');
  });
});

import { EstLogoValideConstraint, tailleBase64Octets } from './logo.validator';

const v = new EstLogoValideConstraint();
const dataUri = (mime: string, octets: number) =>
  `data:${mime};base64,${'A'.repeat(Math.ceil((octets * 4) / 3))}`;

describe('EstLogoValide', () => {
  it('accepte une URL http(s)', () => {
    expect(v.validate('https://cdn.exemple.ci/logo.png')).toBe(true);
    expect(v.validate('http://exemple.ci/l.svg')).toBe(true);
  });

  it('accepte un data-URI image sous la limite', () => {
    expect(v.validate(dataUri('image/png', 10 * 1024))).toBe(true);
    expect(v.validate(dataUri('image/jpeg', 1024))).toBe(true);
    expect(v.validate(dataUri('image/webp', 1024))).toBe(true);
  });

  it('refuse un data-URI trop lourd (> 40 Ko décodé)', () => {
    expect(v.validate(dataUri('image/png', 45 * 1024))).toBe(false);
  });

  it('refuse un type MIME non autorisé', () => {
    expect(v.validate(dataUri('image/gif', 1024))).toBe(false);
    expect(v.validate(dataUri('image/svg+xml', 1024))).toBe(false);
    expect(v.validate('data:text/html;base64,AAAA')).toBe(false);
  });

  it('accepte vide / absent (champ optionnel)', () => {
    expect(v.validate('')).toBe(true);
    expect(v.validate(undefined)).toBe(true);
    expect(v.validate(null)).toBe(true);
  });

  it('refuse une chaîne quelconque', () => {
    expect(v.validate('pas-une-url')).toBe(false);
  });

  it('tailleBase64Octets tient compte du padding', () => {
    expect(tailleBase64Octets('AAAA')).toBe(3);
    expect(tailleBase64Octets('AAA=')).toBe(2);
    expect(tailleBase64Octets('AA==')).toBe(1);
  });
});

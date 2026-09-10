import { genererMotDePasse } from './motdepasse';

describe('genererMotDePasse', () => {
  it('respecte la longueur demandée (12 par défaut)', () => {
    expect(genererMotDePasse()).toHaveLength(12);
    expect(genererMotDePasse(16)).toHaveLength(16);
  });

  it('n\'utilise pas de caractères ambigus (O, 0, l, 1, I)', () => {
    const echantillon = Array.from({ length: 200 }, () => genererMotDePasse(20)).join('');
    expect(echantillon).not.toMatch(/[O0lI1]/);
  });

  it('produit des valeurs différentes', () => {
    const set = new Set(Array.from({ length: 50 }, () => genererMotDePasse()));
    expect(set.size).toBe(50);
  });
});

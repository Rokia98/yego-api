import { normaliserTelephone } from './telephone';

describe('normaliserTelephone', () => {
  it('préfixe un numéro local à 10 chiffres commençant par 0', () => {
    expect(normaliserTelephone('0798496595')).toBe('+2250798496595');
    expect(normaliserTelephone('0701020304')).toBe('+2250701020304');
  });

  it('nettoie espaces, points, tirets, parenthèses', () => {
    expect(normaliserTelephone('07 98 49 65 95')).toBe('+2250798496595');
    expect(normaliserTelephone('07.98.49.65.95')).toBe('+2250798496595');
    expect(normaliserTelephone(' (07) 98-49-65-95 ')).toBe('+2250798496595');
  });

  it("ajoute le + à un indicatif pays sans +", () => {
    expect(normaliserTelephone('2250798496595')).toBe('+2250798496595');
  });

  it('est idempotent sur une forme canonique', () => {
    expect(normaliserTelephone('+2250798496595')).toBe('+2250798496595');
    expect(normaliserTelephone(normaliserTelephone('0798496595'))).toBe(
      '+2250798496595',
    );
  });

  it('laisse passer les valeurs non exploitables (rejet ensuite par @Matches)', () => {
    expect(normaliserTelephone('abc')).toBe('abc');
    expect(normaliserTelephone('12345')).toBe('12345');
    expect(normaliserTelephone(undefined)).toBeUndefined();
    expect(normaliserTelephone(42)).toBe(42);
  });
});

import { haversineKm } from './geo';

describe('haversineKm', () => {
  it('renvoie 0 pour le même point', () => {
    expect(haversineKm({ latitude: 5.36, longitude: -4.0 }, { latitude: 5.36, longitude: -4.0 })).toBe(0);
  });

  it('Abidjan → Korhogo ≈ 490 km à vol d’oiseau', () => {
    const d = haversineKm(
      { latitude: 5.3599, longitude: -4.0083 },
      { latitude: 9.4581, longitude: -5.6296 },
    );
    expect(d).toBeGreaterThan(450);
    expect(d).toBeLessThan(530);
  });
});

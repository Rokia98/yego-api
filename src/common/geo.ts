// Utilitaires géographiques pour l'ETA du suivi GPS.
//
// L'estimation est volontairement grossière : distance à vol d'oiseau vers la
// ville d'arrivée, corrigée d'un facteur route, divisée par une vitesse. Sans
// géométrie d'itinéraire ni service de routage, c'est suffisant pour l'affichage
// de la carte et l'alerte de retard, pas pour une heure d'arrivée à la minute.

export interface Point {
  latitude: number;
  longitude: number;
}

const RAYON_TERRE_KM = 6371;

export function haversineKm(a: Point, b: Point): number {
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * RAYON_TERRE_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function radians(deg: number): number {
  return (deg * Math.PI) / 180;
}

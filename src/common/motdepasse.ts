import { randomInt } from 'crypto';

// Alphabet sans caractères ambigus (pas de O/0, l/1/I) — un mot de passe
// temporaire est souvent recopié à la main / dicté.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * Génère un mot de passe temporaire aléatoire (par défaut 12 caractères).
 * Utilisé pour les comptes créés par l'administrateur (compte gestionnaire
 * d'une compagnie) : renvoyé en clair une seule fois, jamais restocké.
 */
export function genererMotDePasse(longueur = 12): string {
  let out = '';
  for (let i = 0; i < longueur; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

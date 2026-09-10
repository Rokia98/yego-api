// Normalisation des numéros de téléphone vers la forme canonique E.164
// ivoirienne : `+225` suivi de 10 chiffres (ex. `+2250701020304`).
//
// L'app et le back-office laissent l'utilisateur saisir un numéro local
// (`07 01 02 03 04`, `0701020304`, `225 07…`) ; on le ramène toujours à la
// même forme avant de le stocker ou de l'utiliser comme identifiant de compte.

// Garde-fou après normalisation : `+` optionnel puis 8 à 15 chiffres.
export const TELEPHONE_E164_REGEX = /^\+?[0-9]{8,15}$/;

/**
 * Renvoie la forme canonique d'un numéro, ou la valeur d'entrée inchangée si
 * elle n'est pas une chaîne exploitable (laissée au `@Matches` qui suit).
 * Idempotent : `normaliserTelephone('+2250701020304')` === `'+2250701020304'`.
 */
export function normaliserTelephone(input: unknown): unknown {
  if (typeof input !== 'string') return input;

  const s = input.trim().replace(/[\s.()\-]/g, '');
  if (s === '') return s;

  // Déjà en forme internationale.
  if (s.startsWith('+')) return s;

  // Indicatif pays sans le `+`.
  if (s.startsWith('225')) return `+${s}`;

  // Numéro local à 10 chiffres commençant par 0 (format courant en CI).
  if (/^0[0-9]{9}$/.test(s)) return `+225${s}`;

  // Autre chose : on laisse la validation `@Matches` rejeter avec un message.
  return s;
}

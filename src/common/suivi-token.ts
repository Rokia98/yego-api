import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Jeton éphémère de suivi GPS, lié à UN départ.
 *
 * Le chauffeur n'a pas de compte : quand un agent / gestionnaire démarre un
 * départ (`POST /departs/:id/demarrer`), l'API renvoie ce jeton. Le téléphone
 * du chauffeur l'utilise en `Authorization: Bearer <jeton>` pour poster ses
 * positions, sans autre authentification.
 *
 * Format : `<payloadBase64url>.<hmacBase64url>` où payload = `{ d: departId,
 * exp: epochSeconds }`, HMAC-SHA256 avec `JWT_SECRET` + séparateur de domaine.
 */

const SEPARATEUR_DOMAINE = 'yego-suivi-v1';

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET requis pour signer un jeton de suivi');
  return s + SEPARATEUR_DOMAINE;
}

function hmac(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function signerSuiviToken(departId: number, dureeSecondes: number): {
  token: string;
  expireA: Date;
} {
  const exp = Math.floor(Date.now() / 1000) + dureeSecondes;
  const payload = Buffer.from(JSON.stringify({ d: departId, exp })).toString(
    'base64url',
  );
  return {
    token: `${payload}.${hmac(payload)}`,
    expireA: new Date(exp * 1000),
  };
}

/** Renvoie le departId si le jeton est valide et non expiré, sinon null. */
export function verifierSuiviToken(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  const attendue = hmac(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(attendue);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const { d, exp } = JSON.parse(
      Buffer.from(payload, 'base64url').toString(),
    ) as { d: number; exp: number };
    if (typeof d !== 'number' || typeof exp !== 'number') return null;
    if (exp * 1000 < Date.now()) return null;
    return d;
  } catch {
    return null;
  }
}

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
  sign,
  verify,
} from 'crypto';
import { Logger } from '@nestjs/common';

/**
 * Signature des tickets pour la validation HORS-LIGNE au contrôle.
 *
 * Le `codeQr` d'un ticket est un jeton `YEGO1.<charge>.<signature>` :
 *   - `charge`   : JSON compact (base64url) — identifiants + date + siège.
 *   - `signature`: Ed25519 (base64url) de `charge`, faite avec la clé privée
 *                  du serveur.
 *
 * Le contrôleur récupère la clé publique + un manifeste de départ tant qu'il a
 * du réseau, puis vérifie les signatures et l'absence de révocation entièrement
 * hors-ligne. Les scans sont rejoués via `POST /tickets/validations/sync`.
 *
 * En production : définir `TICKET_SIGNING_PRIVATE_KEY` (PEM PKCS#8 Ed25519,
 * sauts de ligne réels ou `\n` échappés). Sans elle, une paire éphémère est
 * générée au démarrage — pratique en dev, mais les QR déjà émis ne seront plus
 * vérifiables après un redémarrage.
 */

const logger = new Logger('TicketSignature');
const PREFIXE = 'YEGO1';

let clePrivee: KeyObject | null = null;
let clePublique: KeyObject | null = null;

function init(): void {
  if (clePrivee) return;

  const pem = process.env.TICKET_SIGNING_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  if (pem) {
    clePrivee = createPrivateKey(pem);
    clePublique = createPublicKey(clePrivee);
    return;
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  clePrivee = privateKey;
  clePublique = publicKey;
  logger.warn(
    'TICKET_SIGNING_PRIVATE_KEY absent : clé de signature éphémère générée pour ' +
      'cette instance. Les QR émis ne survivront pas à un redémarrage — définir ' +
      'une clé Ed25519 (PEM PKCS#8) en production.',
  );
}

export interface ChargeTicket {
  /** ticketId */
  t: number;
  /** reservationId */
  r: number;
  /** departId */
  d: number;
  /** compagnieId */
  c: number;
  /** siège (null si placement libre) */
  s: string | null;
  /** date de départ, `YYYY-MM-DD` */
  dd: string;
}

export function signerTicket(charge: ChargeTicket): string {
  init();
  const corps = Buffer.from(JSON.stringify(charge)).toString('base64url');
  const signature = sign(null, Buffer.from(corps), clePrivee as KeyObject).toString(
    'base64url',
  );
  return `${PREFIXE}.${corps}.${signature}`;
}

export interface ResultatVerification {
  valide: boolean;
  charge: ChargeTicket | null;
  raison?: 'format' | 'signature' | 'charge';
}

export function verifierTicket(jeton: string): ResultatVerification {
  init();
  const parts = jeton.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIXE) {
    return { valide: false, charge: null, raison: 'format' };
  }
  const [, corps, signature] = parts;

  let signatureOk = false;
  try {
    signatureOk = verify(
      null,
      Buffer.from(corps),
      clePublique as KeyObject,
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { valide: false, charge: null, raison: 'signature' };

  try {
    const charge = JSON.parse(
      Buffer.from(corps, 'base64url').toString(),
    ) as ChargeTicket;
    return { valide: true, charge };
  } catch {
    return { valide: false, charge: null, raison: 'charge' };
  }
}

/** Un jeton signé Yègo (par opposition à un ancien codeQr UUID). */
export function estJetonSigne(codeQr: string): boolean {
  return codeQr.startsWith(`${PREFIXE}.`);
}

export function clePubliquePem(): string {
  init();
  return (clePublique as KeyObject)
    .export({ type: 'spki', format: 'pem' })
    .toString();
}

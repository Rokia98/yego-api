import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { MoyenJeko } from '../../common/moyens-paiement';

export type StatutJeko = 'pending' | 'success' | 'error';

export interface DemandePaiementJeko {
  id: string;
  reference: string;
  status: StatutJeko;
  paymentMethod: string;
  redirectUrl: string | null;
  errorReason: string | null;
}

export interface TransfertJeko {
  id: string;
  reference?: string;
  status: StatutJeko;
  amount?: { amount: number; currency: string };
  fees?: { amount: number; currency: string };
  paymentMethod?: string;
  beneficiary?: string;
}

// Erreur renvoyée par l'API Jèko : `id` est le code stable (ex.
// third_party_payment_provider_error, payment_request_exists_with_reference).
export class JekoApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

/**
 * Client de l'API partenaire Jèko (https://developer.jeko.africa).
 *
 * Pas de sandbox chez Jèko : toute requête est réelle. Les montants Yègo sont
 * en FCFA, Jèko attend des centimes (1 FCFA = 100 centimes).
 */
@Injectable()
export class JekoService {
  private readonly logger = new Logger(JekoService.name);

  constructor(private config: ConfigService) {}

  estConfigure(): boolean {
    return !!this.config.get<string>('JEKO_API_KEY');
  }

  // Encaissement direct opérateur (forceProviderDirect) : Orange / Wave / Djamo
  // renvoient l'URL de l'opérateur, MTN / Moov poussent un USSD au payeur.
  creerDemandePaiement(p: {
    reference: string;
    montantFcfa: number;
    moyen: MoyenJeko;
    telephonePayeur: string;
    reservationId: number;
  }): Promise<DemandePaiementJeko> {
    const retour = (cle: string) => {
      const url = new URL(this.config.getOrThrow<string>(cle));
      url.searchParams.set('reservationId', String(p.reservationId));
      url.searchParams.set('reference', p.reference);
      return url.toString();
    };
    return this.requete<DemandePaiementJeko>('POST', '/partner_api/payment_requests', {
      storeId: this.storeId(),
      amountCents: versCentimes(p.montantFcfa),
      currency: 'XOF',
      reference: p.reference,
      paymentDetails: {
        type: 'redirect',
        data: {
          paymentMethod: p.moyen,
          forceProviderDirect: true,
          payerPhone: p.telephonePayeur,
          successUrl: retour('JEKO_SUCCESS_URL'),
          errorUrl: retour('JEKO_ERROR_URL'),
        },
      },
    });
  }

  lireDemandePaiement(id: string): Promise<DemandePaiementJeko> {
    return this.requete('GET', `/partner_api/payment_requests/${encodeURIComponent(id)}`);
  }

  // Contact bénéficiaire Mobile Money, préalable à un transfert.
  async creerContact(p: {
    nom: string;
    moyen: MoyenJeko;
    telephone: string;
  }): Promise<string> {
    const contact = await this.requete<{ id: string }>('POST', '/partner_api/contacts', {
      name: p.nom.slice(0, 100),
      paymentMethod: p.moyen,
      identifier: { number: p.telephone },
    });
    return contact.id;
  }

  creerTransfert(p: {
    contactId: string;
    montantFcfa: number;
    reference: string;
    description: string;
  }): Promise<TransfertJeko> {
    return this.requete('POST', '/partner_api/transfers', {
      storeId: this.storeId(),
      contactId: p.contactId,
      amountCents: versCentimes(p.montantFcfa),
      currency: 'XOF',
      description: p.description.slice(0, 255),
      reference: p.reference,
    });
  }

  lireTransfert(id: string): Promise<TransfertJeko> {
    return this.requete('GET', `/partner_api/transfers/${encodeURIComponent(id)}`);
  }

  // Solde disponible du magasin, en FCFA. null si la forme de la réponse n'est
  // pas reconnue (la doc Jèko ne la fige pas) : l'appelant ne bloque pas dessus,
  // Jèko refusera de toute façon un transfert sans provision.
  async lireSoldeFcfa(): Promise<number | null> {
    const res = await this.requete<Record<string, unknown>>(
      'GET',
      `/partner_api/stores/${encodeURIComponent(this.storeId())}/balance`,
    );
    const centimes = extraireMontant(res);
    return centimes == null ? null : depuisCentimes(centimes);
  }

  // Jeko-Signature = HMAC-SHA256 (hex) du corps BRUT, jamais du JSON reparsé.
  verifierSignature(corpsBrut: Buffer, signature: string | undefined): boolean {
    const secret = this.config.get<string>('JEKO_WEBHOOK_SECRET');
    if (!secret || !signature) return false;
    const attendu = Buffer.from(
      createHmac('sha256', secret).update(corpsBrut).digest('hex'),
    );
    const recu = Buffer.from(signature.trim().toLowerCase());
    return recu.length === attendu.length && timingSafeEqual(recu, attendu);
  }

  private storeId(): string {
    return this.config.getOrThrow<string>('JEKO_STORE_ID');
  }

  private async requete<T>(methode: 'GET' | 'POST', chemin: string, corps?: unknown): Promise<T> {
    if (!this.estConfigure()) {
      throw new ServiceUnavailableException('Paiement Jèko non configuré');
    }
    const base = this.config.get<string>('JEKO_API_URL') ?? 'https://api.jeko.africa';
    let res: Response;
    try {
      res = await fetch(`${base.replace(/\/$/, '')}${chemin}`, {
        method: methode,
        headers: {
          'X-API-KEY': this.config.getOrThrow<string>('JEKO_API_KEY'),
          'X-API-KEY-ID': this.config.getOrThrow<string>('JEKO_API_KEY_ID'),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: corps === undefined ? undefined : JSON.stringify(corps),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(`Jèko injoignable (${methode} ${chemin}) : ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        'Service de paiement momentanément indisponible, réessayez',
      );
    }

    const texte = await res.text();
    let json: any = null;
    try {
      json = texte ? JSON.parse(texte) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const code = typeof json?.id === 'string' ? json.id : undefined;
      const message = json?.message ?? `HTTP ${res.status}`;
      this.logger.warn(`Jèko ${methode} ${chemin} → ${res.status} ${code ?? ''} ${message}`);
      throw new JekoApiError(res.status, code, String(message));
    }
    return json as T;
  }
}

/**
 * Traduit une erreur Jèko en réponse HTTP pour le client Yègo. Les détails
 * (clé invalide, solde…) restent dans les logs : le client ne voit qu'un
 * message actionnable.
 */
export function erreurJekoVersHttp(err: unknown, contexte: string): never {
  if (!(err instanceof JekoApiError)) throw err;
  if (err.status === 400 && err.code === 'third_party_payment_provider_error') {
    throw new BadGatewayException(
      "L'opérateur Mobile Money a refusé la demande. Vérifiez le numéro et le moyen choisis, puis réessayez.",
    );
  }
  if (err.status === 422 || err.status === 400) {
    throw new BadRequestException(`${contexte} refusé par Jèko : ${err.message}`);
  }
  throw new BadGatewayException(`${contexte} : erreur du service de paiement (${err.status})`);
}

export function versCentimes(fcfa: number): number {
  return Math.round(fcfa * 100);
}

export function depuisCentimes(centimes: number): number {
  return centimes / 100;
}

// Le solde peut arriver sous forme { amount: n } ou { balance: { amount: n } }
// selon la version de l'API : on lit le premier montant numérique trouvé.
function extraireMontant(res: Record<string, any>): number | null {
  const candidats = [
    res?.amount,
    res?.amount?.amount,
    res?.balance,
    res?.balance?.amount,
    res?.availableBalance,
    res?.availableBalance?.amount,
  ];
  const n = candidats.find((v) => typeof v === 'number');
  return n ?? null;
}

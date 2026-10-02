import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { JekoApiError, JekoService, erreurJekoVersHttp } from './jeko.service';

const ENV: Record<string, string> = {
  JEKO_API_KEY: 'cle',
  JEKO_API_KEY_ID: 'id-cle',
  JEKO_STORE_ID: 'store-1',
  JEKO_WEBHOOK_SECRET: 'secret-webhook-jeko',
  JEKO_SUCCESS_URL: 'https://yego.ci/paiement/succes?src=app',
  JEKO_ERROR_URL: 'https://yego.ci/paiement/echec',
  JEKO_API_URL: 'https://api.jeko.test/',
};

const config = (env: Record<string, string | undefined> = ENV) =>
  ({
    get: (k: string) => env[k],
    getOrThrow: (k: string) => {
      if (env[k] === undefined) throw new Error(k);
      return env[k];
    },
  }) as never;

const reponse = (status: number, corps: unknown) =>
  ({ ok: status < 400, status, text: async () => JSON.stringify(corps) }) as Response;

describe('JekoService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
  });

  it('n’est pas configuré sans JEKO_API_KEY', () => {
    expect(new JekoService(config({})).estConfigure()).toBe(false);
  });

  it('crée une demande de paiement direct opérateur en centimes', async () => {
    fetchMock.mockResolvedValue(
      reponse(200, { id: 'pr-1', status: 'pending', redirectUrl: 'https://op/x' }),
    );
    const res = await new JekoService(config()).creerDemandePaiement({
      reference: 'YEGO-P7-T1',
      montantFcfa: 15000,
      moyen: 'orange',
      telephonePayeur: '+2250701020304',
      reservationId: 3,
    });

    expect(res.id).toBe('pr-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.jeko.test/partner_api/payment_requests');
    expect(init.headers).toMatchObject({ 'X-API-KEY': 'cle', 'X-API-KEY-ID': 'id-cle' });
    const corps = JSON.parse(init.body);
    expect(corps).toMatchObject({
      storeId: 'store-1',
      amountCents: 1500000,
      currency: 'XOF',
      reference: 'YEGO-P7-T1',
      paymentDetails: {
        type: 'redirect',
        data: {
          paymentMethod: 'orange',
          forceProviderDirect: true,
          payerPhone: '+2250701020304',
        },
      },
    });
    const succes = new URL(corps.paymentDetails.data.successUrl);
    expect(succes.searchParams.get('src')).toBe('app');
    expect(succes.searchParams.get('reservationId')).toBe('3');
    expect(succes.searchParams.get('reference')).toBe('YEGO-P7-T1');
  });

  it('remonte le code d’erreur Jèko', async () => {
    fetchMock.mockResolvedValue(
      reponse(400, { id: 'third_party_payment_provider_error', message: 'retry' }),
    );
    await expect(
      new JekoService(config()).lireDemandePaiement('pr-1'),
    ).rejects.toMatchObject({ status: 400, code: 'third_party_payment_provider_error' });
  });

  it('lit le solde quel que soit l’emballage, null si inconnu', async () => {
    const service = new JekoService(config());
    fetchMock.mockResolvedValueOnce(reponse(200, { amount: { amount: 250000 } }));
    await expect(service.lireSoldeFcfa()).resolves.toBe(2500);
    fetchMock.mockResolvedValueOnce(reponse(200, { autre: 'forme' }));
    await expect(service.lireSoldeFcfa()).resolves.toBeNull();
  });

  describe('verifierSignature', () => {
    const corps = Buffer.from('{"id":"txn_1","status":"success"}');
    const signe = (secret: string) =>
      createHmac('sha256', secret).update(corps).digest('hex');

    it('accepte la signature HMAC-SHA256 hex du corps brut', () => {
      expect(new JekoService(config()).verifierSignature(corps, signe(ENV.JEKO_WEBHOOK_SECRET))).toBe(true);
    });

    it('refuse une signature d’un autre secret, absente ou tronquée', () => {
      const service = new JekoService(config());
      expect(service.verifierSignature(corps, signe('autre-secret-xxxxx'))).toBe(false);
      expect(service.verifierSignature(corps, undefined)).toBe(false);
      expect(service.verifierSignature(corps, signe(ENV.JEKO_WEBHOOK_SECRET).slice(2))).toBe(false);
    });

    it('refuse tout si le secret n’est pas configuré', () => {
      expect(new JekoService(config({})).verifierSignature(corps, 'abc')).toBe(false);
    });
  });

  describe('erreurJekoVersHttp', () => {
    it('erreur opérateur → 502 actionnable', () => {
      expect(() =>
        erreurJekoVersHttp(new JekoApiError(400, 'third_party_payment_provider_error', 'x'), 'Paiement'),
      ).toThrow(BadGatewayException);
    });

    it('validation → 400', () => {
      expect(() => erreurJekoVersHttp(new JekoApiError(422, undefined, 'payerPhone'), 'Paiement')).toThrow(
        BadRequestException,
      );
    });

    it('laisse passer les erreurs non Jèko', () => {
      const autre = new Error('boom');
      expect(() => erreurJekoVersHttp(autre, 'Paiement')).toThrow(autre);
    });
  });
});

import { JEKO_PORT_STUB, JEKO_WEBHOOK_SECRET_E2E } from './jeko-env';
import { createServer, IncomingMessage, Server } from 'http';
import { createHmac, randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { JekoWebhookService } from '../src/modules/jeko/jeko-webhook.service';
import { reinitialiser, Fixture } from './fixture';

// ── Faux serveur Jèko ────────────────────────────────────────────────────────
interface Appel {
  methode: string;
  chemin: string;
  corps: any;
  entetes: IncomingMessage['headers'];
}

const appels: Appel[] = [];
// Statut renvoyé par GET payment_requests/:id et GET transfers/:id.
const statuts = new Map<string, string>();
// Prochaine réponse forcée pour un chemin POST (ex. erreur opérateur).
const erreursForcees = new Map<string, { status: number; corps: unknown }>();
// Solde du magasin renvoyé par GET stores/:id/balance (centimes).
let soldeStubCentimes = 1_000_000_000;

function demarrerStub(): Promise<Server> {
  const server = createServer((req, res) => {
    let brut = '';
    req.on('data', (c) => (brut += c));
    req.on('end', () => {
      const corps = brut ? JSON.parse(brut) : null;
      const chemin = req.url ?? '';
      appels.push({ methode: req.method ?? '', chemin, corps, entetes: req.headers });
      const repondre = (status: number, json: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.headers['x-api-key'] !== 'cle-e2e') return repondre(401, { id: 'unauthorized' });

      const forcee = req.method === 'POST' ? erreursForcees.get(chemin) : undefined;
      if (forcee) {
        erreursForcees.delete(chemin);
        return repondre(forcee.status, forcee.corps);
      }
      if (req.method === 'POST' && chemin === '/partner_api/payment_requests') {
        const id = randomUUID();
        const moyen = corps.paymentDetails.data.paymentMethod;
        return repondre(200, {
          id,
          reference: corps.reference,
          status: 'pending',
          paymentMethod: moyen,
          redirectUrl:
            moyen === 'mtn' || moyen === 'moov'
              ? `https://pay.jeko.africa/pay_request/pr/${id}`
              : `https://webpay.orange.ci/${id}`,
          errorReason: null,
        });
      }
      if (req.method === 'GET' && chemin.startsWith('/partner_api/payment_requests/')) {
        const id = chemin.split('/').pop()!;
        return repondre(200, {
          id,
          reference: statuts.get(`ref:${id}`),
          status: statuts.get(id) ?? 'pending',
          errorReason: statuts.get(id) === 'error' ? 'expired' : null,
        });
      }
      if (req.method === 'POST' && chemin === '/partner_api/contacts') {
        return repondre(200, { id: `ct_${randomUUID()}`, ...corps });
      }
      if (req.method === 'POST' && chemin === '/partner_api/transfers') {
        return repondre(200, {
          id: `wth_${randomUUID()}`,
          reference: corps.reference,
          status: 'pending',
          amount: { amount: corps.amountCents, currency: 'XOF' },
          fees: { amount: 10000, currency: 'XOF' },
        });
      }
      if (req.method === 'GET' && chemin.startsWith('/partner_api/transfers/')) {
        const id = chemin.split('/').pop()!;
        return repondre(200, { id, status: statuts.get(id) ?? 'pending' });
      }
      if (req.method === 'GET' && chemin.endsWith('/balance')) {
        return repondre(200, { amount: { amount: soldeStubCentimes, currency: 'XOF' } });
      }
      repondre(404, { id: 'not_found' });
    });
  });
  return new Promise((ok) => server.listen(JEKO_PORT_STUB, '127.0.0.1', () => ok(server)));
}

const dernierAppel = (methode: string, chemin: string) =>
  [...appels].reverse().find((a) => a.methode === methode && a.chemin === chemin);

// ── Suite ────────────────────────────────────────────────────────────────────
describe('Intégration Jèko (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stub: Server;
  let http: () => ReturnType<typeof request>;
  let fx: Fixture;
  const tok: Record<string, string> = {};

  const auth = (role: string) => ({ Authorization: `Bearer ${tok[role]}` });

  const webhook = (corps: unknown, opts: { signature?: string; evenement?: string } = {}) => {
    const brut = JSON.stringify(corps);
    const signature =
      opts.signature ?? createHmac('sha256', JEKO_WEBHOOK_SECRET_E2E).update(brut).digest('hex');
    return http()
      .post('/api/v1/jeko/webhook')
      .set('Content-Type', 'application/json')
      .set('Jeko-Signature', signature)
      .set('Jeko-Event', opts.evenement ?? 'TRANSACTION_COMPLETED')
      .send(brut);
  };

  const paiementReussi = (reference: string, centimes: number, extra: object = {}) => ({
    id: `txn_${randomUUID()}`,
    amount: { amount: centimes, currency: 'XOF' },
    fees: { amount: 100, currency: 'XOF' },
    status: 'success',
    transactionType: 'payment',
    paymentMethod: 'orange',
    counterpartIdentifier: '+2250701020304',
    executedAt: '2026-10-02 10:00:00',
    transactionDetails: { reference },
    ...extra,
  });

  const transfert = (reference: string, status: 'success' | 'error') => ({
    id: `txn_${randomUUID()}`,
    status,
    transactionType: 'transfer',
    amount: { amount: 0, currency: 'XOF' },
    fees: { amount: 10000, currency: 'XOF' },
    transactionDetails: { reference },
  });

  const reserver = async (departId = fx.departFuturId, nombrePlaces = 1) =>
    (
      await http()
        .post('/api/v1/reservations')
        .set(auth('voyageur'))
        .send({ departId, nombrePlaces })
        .expect(201)
    ).body.id as number;

  beforeAll(async () => {
    stub = await demarrerStub();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_GUARD)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    http = () => request(app.getHttpServer());
    fx = await reinitialiser(prisma);

    for (const [role, c] of Object.entries(fx.comptes)) {
      const res = await http().post('/api/v1/auth/login').send(c).expect(201);
      tok[role] = res.body.accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
    await new Promise((ok) => stub.close(ok));
  });

  // ---------------------------------------------------------------------------
  describe('Paiement en ligne (direct opérateur)', () => {
    let reservationId: number;
    let paiementId: number;
    let referenceT1: string;

    it('ouvre une demande Jèko au montant serveur, en centimes', async () => {
      reservationId = await reserver(fx.departFuturId, 2);
      const res = await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'orange_money', telephonePayeur: '07 01 02 03 04' })
        .expect(201);

      paiementId = res.body.id;
      referenceT1 = `YEGO-P${paiementId}-T1`;
      expect(res.body).toMatchObject({
        statut: 'en_attente',
        actionRequise: 'redirection',
        jekoReference: referenceT1,
        telephonePayeur: '+2250701020304',
      });
      expect(res.body.urlPaiement).toMatch(/^https:\/\/webpay\.orange\.ci\//);
      expect(Number(res.body.montant)).toBe(30000);
      expect(Number(res.body.fraisService)).toBe(1050);

      const appel = dernierAppel('POST', '/partner_api/payment_requests')!;
      expect(appel.entetes['x-api-key-id']).toBe('id-cle-e2e');
      expect(appel.corps).toMatchObject({
        storeId: 'store-e2e',
        // 2 billets à 15 000 F + 3,5 % de frais de service = 31 050 F.
        amountCents: 31_050 * 100,
        currency: 'XOF',
        reference: referenceT1,
        paymentDetails: {
          type: 'redirect',
          data: { paymentMethod: 'orange', forceProviderDirect: true, payerPhone: '+2250701020304' },
        },
      });
      expect(appel.corps.paymentDetails.data.successUrl).toContain(`reservationId=${reservationId}`);
    });

    it('une relance identique renvoie la demande en cours (pas de 2e demande payable)', async () => {
      const avant = appels.length;
      const res = await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'orange_money', telephonePayeur: '+2250701020304' })
        .expect(201);
      expect(res.body.jekoReference).toBe(referenceT1);
      expect(appels.length).toBe(avant);
    });

    it('changer de moyen ouvre une nouvelle tentative (USSD pour MTN)', async () => {
      const res = await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'mtn_money', telephonePayeur: '0501020304' })
        .expect(201);
      expect(res.body.jekoReference).toBe(`YEGO-P${paiementId}-T2`);
      expect(res.body.actionRequise).toBe('ussd');
    });

    it('espèces en ligne → 400 ; numéro non ivoirien → 400', async () => {
      await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'espece' })
        .expect(400);
      await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'wave', telephonePayeur: '+33612345678' })
        .expect(400);
    });

    it('webhook non signé ou mal signé → 401, rien ne bouge', async () => {
      await http()
        .post('/api/v1/jeko/webhook')
        .set('Jeko-Event', 'TRANSACTION_COMPLETED')
        .send(paiementReussi(referenceT1, 3_105_000))
        .expect(401);
      await webhook(paiementReussi(referenceT1, 3_105_000), { signature: 'ab'.repeat(32) }).expect(401);
      const p = await prisma.paiement.findUniqueOrThrow({ where: { id: paiementId } });
      expect(p.statut).toBe('en_attente');
    });

    it('le webhook au prix SANS les frais est refusé (le voyageur doit payer les frais)', async () => {
      await webhook(paiementReussi(referenceT1, 3_000_000)).expect(200);
      const p = await prisma.paiement.findUniqueOrThrow({ where: { id: paiementId } });
      expect(p.statut).toBe('en_attente');
    });

    it('GET /paiements/frais-service → 3,5 %', () =>
      http()
        .get('/api/v1/paiements/frais-service')
        .set(auth('voyageur'))
        .expect(200)
        .then((r) => expect(r.body).toEqual({ pourcent: 3.5 })));

    it('webhook au mauvais montant → ignoré (200) et audité', async () => {
      await webhook(paiementReussi(referenceT1, 100)).expect(200);
      const p = await prisma.paiement.findUniqueOrThrow({ where: { id: paiementId } });
      expect(p.statut).toBe('en_attente');
      expect(
        await prisma.auditLog.count({ where: { action: 'paiement.jeko_montant_incoherent', entiteId: paiementId } }),
      ).toBe(2);
    });

    it('la tentative T1 (Orange) payée → paiement "paye", moyen réel conservé', async () => {
      const tx = paiementReussi(referenceT1, 3_105_000);
      await webhook(tx).expect(200);
      const p = await prisma.paiement.findUniqueOrThrow({ where: { id: paiementId } });
      expect(p).toMatchObject({
        statut: 'paye',
        moyenPaiement: 'orange_money',
        telephonePayeur: '+2250701020304',
        referenceTransaction: tx.id,
      });

      // Rejeu du même webhook : no-op.
      await webhook(tx).expect(200);
      // Le ticket est générable.
      await http()
        .post(`/api/v1/tickets/reservation/${reservationId}`)
        .set(auth('voyageur'))
        .send({})
        .expect(201);
    });

    it('un second paiement sur une demande déjà soldée est audité (trop-perçu)', async () => {
      await webhook(paiementReussi(`YEGO-P${paiementId}-T2`, 3_105_000)).expect(200);
      expect(
        await prisma.auditLog.count({ where: { action: 'paiement.jeko_doublon', entiteId: paiementId } }),
      ).toBe(1);
    });

    it('retour opérateur → 302 vers le deep link de l’app, paramètres filtrés', async () => {
      const res = await http()
        .get(`/api/v1/jeko/retour/succes?reservationId=${reservationId}&reference=${referenceT1}&x=https://evil.test`)
        .expect(302);
      expect(res.headers.location).toBe(
        `yego://paiement?statut=succes&reservationId=${reservationId}&reference=${referenceT1}`,
      );
      const echec = await http()
        .get('/api/v1/jeko/retour/nimporte?reservationId=abc&reference=<script>')
        .expect(302);
      expect(echec.headers.location).toBe('yego://paiement?statut=echec');
    });

    it('dashboard : frais de service encaissés visibles par l’admin seulement', async () => {
      const admin = await http().get('/api/v1/dashboard/resume').set(auth('admin')).expect(200);
      // Paiement T1 confirmé : 2 billets → 1 050 F de frais.
      expect(Number(admin.body.chiffreAffaires.fraisService)).toBe(1050);
      expect(Number(admin.body.chiffreAffaires.parStatutPaiement.paye.montant)).toBe(30000);
      const gestionnaire = await http().get('/api/v1/dashboard/resume').set(auth('gestionnaire')).expect(200);
      expect(gestionnaire.body.chiffreAffaires.fraisService).toBeUndefined();
    });

    it('ancien webhook à secret partagé coupé quand Jèko est actif (404)', () =>
      http()
        .patch(`/api/v1/paiements/reservation/${reservationId}/confirmer`)
        .set('x-webhook-secret', process.env.PAYMENT_WEBHOOK_SECRET!)
        .expect(404));

    it('événement non transactionnel → 200 ignoré', () =>
      webhook({ id: 'x', status: 'pending' }, { evenement: 'SERVICE_PROVIDER_LINK_REQUEST' }).expect(200));
  });

  // ---------------------------------------------------------------------------
  describe('Vérification à la demande + réconciliation', () => {
    it('demande expirée chez Jèko → "echoue" via /verifier, puis repayable', async () => {
      const reservationId = await reserver();
      const pay = await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'wave' })
        .expect(201);
      // Numéro du compte voyageur par défaut.
      expect(pay.body.telephonePayeur).toBe('+2250701234567');

      statuts.set(pay.body.jekoPaymentRequestId, 'error');
      const v = await http()
        .post(`/api/v1/paiements/reservation/${reservationId}/verifier`)
        .set(auth('voyageur'))
        .expect(201);
      expect(v.body.statut).toBe('echoue');

      // Relance : nouvelle tentative, payée, constatée par la réconciliation.
      const relance = await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'wave' })
        .expect(201);
      expect(relance.body.jekoReference).toMatch(/-T2$/);
      statuts.set(relance.body.jekoPaymentRequestId, 'success');
      statuts.set(`ref:${relance.body.jekoPaymentRequestId}`, relance.body.jekoReference);

      const bilan = await app.get(JekoWebhookService).reconcilier();
      expect(bilan.paiements).toBeGreaterThanOrEqual(1);
      const p = await prisma.paiement.findUniqueOrThrow({ where: { reservationId } });
      expect(p.statut).toBe('paye');
    });

    it('erreur opérateur à la création → 502, paiement "echoue", référence consommée', async () => {
      const reservationId = await reserver();
      erreursForcees.set('/partner_api/payment_requests', {
        status: 400,
        corps: { id: 'third_party_payment_provider_error', message: 'please retry' },
      });
      await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'orange_money' })
        .expect(502);
      const p = await prisma.paiement.findUniqueOrThrow({ where: { reservationId } });
      expect(p.statut).toBe('echoue');

      const relance = await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'orange_money' })
        .expect(201);
      expect(relance.body.jekoReference).toBe(`YEGO-P${p.id}-T2`);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Remboursement voyageur par transfert', () => {
    const payerEnLigne = async () => {
      const reservationId = await reserver();
      const pay = await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'orange_money', telephonePayeur: '0701020304' })
        .expect(201);
      await webhook(paiementReussi(pay.body.jekoReference, 1_552_500)).expect(200);
      await http()
        .patch(`/api/v1/reservations/${reservationId}/annuler`)
        .set(auth('voyageur'))
        .expect(200);
      const r = await prisma.remboursement.findUniqueOrThrow({ where: { reservationId } });
      return { reservationId, remboursement: r };
    };

    it('confirmer → transfert Jèko vers le numéro payeur, puis "rembourse" au webhook', async () => {
      const { reservationId, remboursement } = await payerEnLigne();
      // Départ dans un mois : 10 % de frais retenus, calculés sur le billet.
      // Les 525 F de frais de service payés en plus ne sont pas remboursés.
      expect(remboursement.montantRembourse.toNumber()).toBe(13500);
      const paye = await prisma.paiement.findUniqueOrThrow({ where: { reservationId } });
      expect(paye.fraisService.toNumber()).toBe(525);

      // La liste back-office expose le paiement d'origine (choix du bouton).
      const liste = await http()
        .get('/api/v1/remboursements/statut/en_attente')
        .set(auth('gestionnaire'))
        .expect(200);
      const ligne = liste.body.find((r: { id: number }) => r.id === remboursement.id);
      expect(ligne.reservation.paiement).toMatchObject({
        moyenPaiement: 'orange_money',
        telephonePayeur: '+2250701020304',
        reversementId: null,
      });
      expect(ligne.reservation.paiement.jekoReference).toMatch(/^YEGO-P\d+-T1$/);

      const res = await http()
        .patch(`/api/v1/remboursements/${remboursement.id}/confirmer`)
        .set(auth('gestionnaire'))
        .send({})
        .expect(200);
      expect(res.body.statut).toBe('en_cours');
      expect(res.body.jekoReference).toBe(`YEGO-RB${remboursement.id}-T1`);

      const contact = dernierAppel('POST', '/partner_api/contacts')!;
      expect(contact.corps).toMatchObject({
        paymentMethod: 'orange',
        identifier: { number: '+2250701020304' },
      });
      const t = dernierAppel('POST', '/partner_api/transfers')!;
      expect(t.corps).toMatchObject({
        storeId: 'store-e2e',
        amountCents: 1_350_000,
        reference: `YEGO-RB${remboursement.id}-T1`,
      });

      // Pas de double transfert pendant qu'il est en cours.
      await http()
        .patch(`/api/v1/remboursements/${remboursement.id}/confirmer`)
        .set(auth('gestionnaire'))
        .send({})
        .expect(409);

      await webhook(transfert(`YEGO-RB${remboursement.id}-T1`, 'success')).expect(200);
      const r = await prisma.remboursement.findUniqueOrThrow({ where: { id: remboursement.id } });
      expect(r.statut).toBe('rembourse');
      const p = await prisma.paiement.findUniqueOrThrow({ where: { reservationId } });
      expect(p.statut).toBe('rembourse');
    });

    it('transfert échoué → "echoue" avec motif, relançable (T2)', async () => {
      const { remboursement } = await payerEnLigne();
      await http()
        .patch(`/api/v1/remboursements/${remboursement.id}/confirmer`)
        .set(auth('gestionnaire'))
        .send({})
        .expect(200);
      await webhook(transfert(`YEGO-RB${remboursement.id}-T1`, 'error')).expect(200);
      const r = await prisma.remboursement.findUniqueOrThrow({ where: { id: remboursement.id } });
      expect(r.statut).toBe('echoue');
      expect(r.motifEchec).toBeTruthy();

      const relance = await http()
        .patch(`/api/v1/remboursements/${remboursement.id}/confirmer`)
        .set(auth('gestionnaire'))
        .send({})
        .expect(200);
      expect(relance.body).toMatchObject({ statut: 'en_cours', jekoReference: `YEGO-RB${remboursement.id}-T2` });

      // La réconciliation solde le transfert si le webhook se perd.
      statuts.set(relance.body.jekoTransferId, 'success');
      await app.get(JekoWebhookService).reconcilier();
      const fin = await prisma.remboursement.findUniqueOrThrow({ where: { id: remboursement.id } });
      expect(fin.statut).toBe('rembourse');
    });

    it("mode manuel : refusé à la compagnie (l'argent est chez Yègo), possible pour l'admin", async () => {
      const { remboursement } = await payerEnLigne();
      await http()
        .patch(`/api/v1/remboursements/${remboursement.id}/confirmer`)
        .set(auth('gestionnaire'))
        .send({ mode: 'manuel' })
        .expect(403);
      const res = await http()
        .patch(`/api/v1/remboursements/${remboursement.id}/confirmer`)
        .set(auth('admin'))
        .send({ mode: 'manuel' })
        .expect(200);
      expect(res.body.statut).toBe('rembourse');
    });
  });

  // ---------------------------------------------------------------------------
  describe('Reversement compagnie', () => {
    // Paiements Jèko soldés sur un départ passé (hier) : non annulables,
    // donc reversables. Créés en base (la vente est fermée sur un départ passé).
    const paiementPasse = async (montant: number) => {
      const resa = await prisma.reservation.create({
        data: {
          utilisateurId: (await prisma.utilisateur.findFirstOrThrow({ where: { role: 'user' } })).id,
          departId: fx.departId,
          nombrePlaces: 1,
          canal: 'en_ligne',
          statut: 'confirmee',
        },
      });
      return prisma.paiement.create({
        data: {
          reservationId: resa.id,
          montant,
          moyenPaiement: 'wave',
          statut: 'paye',
          datePaiement: new Date(),
          jekoReference: `YEGO-P${resa.id}000-T1`,
        },
      });
    };

    it('sans compte renseigné : coordonnees = { moyen: null, telephone: null }', async () => {
      const apercu = await http().get('/api/v1/reversements/apercu').set(auth('gestionnaire')).expect(200);
      expect(apercu.body.coordonnees).toEqual({ moyen: null, telephone: null });
      const coord = await http()
        .get(`/api/v1/reversements/coordonnees/${fx.compagnieId}`)
        .set(auth('gestionnaire'))
        .expect(200);
      expect(coord.body).toEqual({ moyen: null, telephone: null });
    });

    it('le gestionnaire renseigne son compte Mobile Money ; un agent ne peut pas', async () => {
      await http()
        .put(`/api/v1/reversements/coordonnees/${fx.compagnieId}`)
        .set(auth('agent'))
        .send({ moyen: 'wave', telephone: '0707070707' })
        .expect(403);
      await http()
        .put(`/api/v1/reversements/coordonnees/${fx.autreCompagnieId}`)
        .set(auth('gestionnaire'))
        .send({ moyen: 'wave', telephone: '0707070707' })
        .expect(403);
      const res = await http()
        .put(`/api/v1/reversements/coordonnees/${fx.compagnieId}`)
        .set(auth('gestionnaire'))
        .send({ moyen: 'wave', telephone: '07 07 07 07 07' })
        .expect(200);
      expect(res.body).toEqual({ moyen: 'wave', telephone: '+2250707070707' });
    });

    it('aperçu : départs passés + frais retenus des remboursements, commission 10 %', async () => {
      await paiementPasse(15000);
      await paiementPasse(15000);
      const res = await http()
        .get('/api/v1/reversements/apercu')
        .set(auth('gestionnaire'))
        .expect(200);
      // 2 × 15 000 (départ passé) + 3 × 1 500 de frais retenus (remboursements
      // soldés ci-dessus, 10 % de 15 000).
      expect(res.body.nombrePaiements).toBe(5);
      expect(Number(res.body.montantBrut)).toBe(34500);
      expect(Number(res.body.commission)).toBe(3450);
      expect(Number(res.body.montantNet)).toBe(31050);
      expect(res.body.coordonnees).toEqual({ moyen: 'wave', telephone: '+2250707070707' });
    });

    it('seul l’admin déclenche ; le net part vers le numéro de Yègo, puis remise en main propre', async () => {
      await http()
        .post('/api/v1/reversements')
        .set(auth('gestionnaire'))
        .send({ compagnieId: fx.compagnieId, moyen: 'wave' })
        .expect(403);
      // Opérateur du numéro Yègo obligatoire : Wave ou Orange Money.
      await http()
        .post('/api/v1/reversements')
        .set(auth('admin'))
        .send({ compagnieId: fx.compagnieId })
        .expect(400);
      // Plus de délai de 24 h : la compagnie ne reçoit rien sur son compte.
      const apercuLibre = await http().get('/api/v1/reversements/apercu').set(auth('gestionnaire')).expect(200);
      expect(apercuLibre.body.bloqueJusquA).toBeNull();

      const res = await http()
        .post('/api/v1/reversements')
        .set(auth('admin'))
        .send({ compagnieId: fx.compagnieId, moyen: 'wave' })
        .expect(201);
      expect(res.body).toMatchObject({
        statut: 'en_cours',
        nombrePaiements: 5,
        jekoReference: `YEGO-RV${res.body.id}`,
        moyen: 'wave',
        beneficiaire: '+2250798496595',
      });
      const t = dernierAppel('POST', '/partner_api/transfers')!;
      expect(t.corps).toMatchObject({ amountCents: 3_105_000, reference: `YEGO-RV${res.body.id}` });
      expect(dernierAppel('POST', '/partner_api/contacts')!.corps).toMatchObject({
        paymentMethod: 'wave',
        identifier: { number: '+2250798496595' },
      });

      // Plus rien d'éligible : les paiements sont verrouillés sur ce reversement.
      const apercu = await http().get('/api/v1/reversements/apercu').set(auth('gestionnaire')).expect(200);
      expect(apercu.body.nombrePaiements).toBe(0);
      await http()
        .post('/api/v1/reversements')
        .set(auth('admin'))
        .send({ compagnieId: fx.compagnieId, moyen: 'wave' })
        .expect(400);

      // Remise impossible tant que les fonds ne sont pas arrivés chez Yègo.
      await http().post(`/api/v1/reversements/${res.body.id}/remise`).set(auth('admin')).send({}).expect(400);

      await webhook(transfert(`YEGO-RV${res.body.id}`, 'success')).expect(200);
      const detail = await http()
        .get(`/api/v1/reversements/${res.body.id}`)
        .set(auth('gestionnaire'))
        .expect(200);
      expect(detail.body).toMatchObject({ statut: 'effectue', remisLe: null });
      expect(detail.body.paiements).toHaveLength(5);
      expect(await prisma.notification.count({ where: { type: 'reversement.pret' } })).toBeGreaterThanOrEqual(1);

      const aRemettre = await http().get('/api/v1/reversements?aRemettre=true').set(auth('admin')).expect(200);
      expect(aRemettre.body.map((r: { id: number }) => r.id)).toEqual([res.body.id]);

      // Remise : admin seulement, une seule fois, compagnie prévenue.
      await http().post(`/api/v1/reversements/${res.body.id}/remise`).set(auth('gestionnaire')).send({}).expect(403);
      const remis = await http()
        .post(`/api/v1/reversements/${res.body.id}/remise`)
        .set(auth('admin'))
        .send({ note: 'Espèces remises au gérant, reçu n° 1' })
        .expect(201);
      expect(remis.body.remisLe).toBeTruthy();
      expect(remis.body.remiseNote).toBe('Espèces remises au gérant, reçu n° 1');
      await http().post(`/api/v1/reversements/${res.body.id}/remise`).set(auth('admin')).send({}).expect(409);
      expect(await prisma.notification.count({ where: { type: 'reversement.remis' } })).toBeGreaterThanOrEqual(1);
    });

    it('transfert échoué → "echoue" et paiements libérés pour un prochain reversement', async () => {
      await paiementPasse(8000);
      const res = await http()
        .post('/api/v1/reversements')
        .set(auth('admin'))
        .send({ compagnieId: fx.compagnieId, moyen: 'orange_money' })
        .expect(201);
      await webhook(transfert(`YEGO-RV${res.body.id}`, 'error')).expect(200);

      const rev = await prisma.reversement.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(rev.statut).toBe('echoue');
      const apercu = await http().get('/api/v1/reversements/apercu').set(auth('gestionnaire')).expect(200);
      expect(apercu.body.nombrePaiements).toBe(1);
    });

    it('GET /dashboard/solde : disponible, en attente, déjà reversé', async () => {
      // À ce stade : 1 reversement effectué (31 050 net), 1 échoué, et le
      // paiement de 8 000 redevenu éligible.
      const futur = await paiementPasse(12000);
      await prisma.reservation.update({
        where: { id: futur.reservationId },
        data: { departId: fx.departFuturId },
      });
      const avant = await http().get('/api/v1/dashboard/solde').set(auth('gestionnaire')).expect(200);
      expect(avant.body).toMatchObject({
        compagnieId: fx.compagnieId,
        commissionPourcent: 10,
        disponible: { nombrePaiements: 1 },
        enCoursDeReversement: { nombre: 0 },
        totalReverse: { nombre: 1 },
      });
      expect(Number(avant.body.disponible.montantBrut)).toBe(8000);
      expect(Number(avant.body.disponible.commission)).toBe(800);
      expect(Number(avant.body.disponible.montantNet)).toBe(7200);
      expect(Number(avant.body.totalReverse.montant)).toBe(31050);
      expect(avant.body.dernierReversement.remisLe).toBeTruthy();
      // Départ à venir : encaissé, pas encore reversable.
      expect(avant.body.enAttente.nombrePaiements).toBeGreaterThanOrEqual(1);
      expect(Number(avant.body.enAttente.montantBrut)).toBeGreaterThanOrEqual(12000);

      // Le disponible suit l'aperçu du prochain reversement.
      const apercu = await http().get('/api/v1/reversements/apercu').set(auth('gestionnaire')).expect(200);
      expect(Number(apercu.body.montantNet)).toBe(7200);

      // Admin : compagnieId requis ; agent : pas d'accès ; pas de solde d'autrui.
      await http().get('/api/v1/dashboard/solde').set(auth('admin')).expect(403);
      const admin = await http()
        .get(`/api/v1/dashboard/solde?compagnieId=${fx.compagnieId}`)
        .set(auth('admin'))
        .expect(200);
      expect(Number(admin.body.disponible.montantNet)).toBe(7200);
      const autre = await http()
        .get(`/api/v1/dashboard/solde?compagnieId=${fx.autreCompagnieId}`)
        .set(auth('admin'))
        .expect(200);
      expect(Number(autre.body.disponible.montantBrut)).toBe(0);
      expect(autre.body.dernierReversement).toBeNull();
      await http()
        .get(`/api/v1/dashboard/solde?compagnieId=${fx.autreCompagnieId}`)
        .set(auth('gestionnaire'))
        .expect(403);
      await http().get('/api/v1/dashboard/solde').set(auth('agent')).expect(403);

      // Remis sur le départ passé pour ne pas changer la suite (lot éligible).
      await prisma.paiement.delete({ where: { id: futur.id } });
      await prisma.reservation.delete({ where: { id: futur.reservationId } });
    });

    it('cloisonnement : l’autre compagnie ne voit pas ces reversements', async () => {
      const liste = await http().get('/api/v1/reversements').set(auth('gestionnaire')).expect(200);
      expect(liste.body.length).toBe(2);
      await http()
        .get(`/api/v1/reversements/apercu?compagnieId=${fx.autreCompagnieId}`)
        .set(auth('gestionnaire'))
        .expect(403);
    });

    it('un paiement déjà reversé ne peut plus être remboursé par Jèko', async () => {
      const rev = await prisma.reversement.findFirstOrThrow({ where: { statut: 'effectue' } });
      const p = await prisma.paiement.findFirstOrThrow({
        where: { reversementId: rev.id, statut: 'paye' },
      });
      await prisma.reservation.update({ where: { id: p.reservationId }, data: { statut: 'annulee' } });
      const r = await prisma.remboursement.create({
        data: { reservationId: p.reservationId, montantRembourse: 15000 },
      });
      await http()
        .patch(`/api/v1/remboursements/${r.id}/confirmer`)
        .set(auth('admin'))
        .send({ mode: 'jeko' })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Demande de reversement (compagnie → admin)', () => {
    // État hérité : le paiement de 8 000 (net 7 200) est éligible, compte
    // Wave de la compagnie confirmé par l'admin.
    it('un agent ne peut pas demander ; le gestionnaire oui, une seule à la fois', async () => {
      await http().post('/api/v1/reversements/demandes').set(auth('agent')).send({}).expect(403);
      const d = await http()
        .post('/api/v1/reversements/demandes')
        .set(auth('gestionnaire'))
        .send({ commentaire: 'Fin de semaine' })
        .expect(201);
      expect(d.body).toMatchObject({ statut: 'en_attente', compagnieId: fx.compagnieId });
      expect(Number(d.body.montantNetEstime)).toBe(7200);
      expect(
        await prisma.notification.count({ where: { type: 'reversement.demande' } }),
      ).toBeGreaterThanOrEqual(1);

      await http().post('/api/v1/reversements/demandes').set(auth('gestionnaire')).send({}).expect(409);
      const solde = await http().get('/api/v1/dashboard/solde').set(auth('gestionnaire')).expect(200);
      expect(solde.body.demandeEnAttente.id).toBe(d.body.id);
    });

    it('rejet par l’admin seulement, avec motif ; puis annulation par la compagnie', async () => {
      const [d] = (
        await http().get('/api/v1/reversements/demandes?statut=en_attente').set(auth('admin')).expect(200)
      ).body;
      await http()
        .post(`/api/v1/reversements/demandes/${d.id}/rejeter`)
        .set(auth('gestionnaire'))
        .send({ motif: 'non' })
        .expect(403);
      await http().post(`/api/v1/reversements/demandes/${d.id}/rejeter`).set(auth('admin')).send({}).expect(400);
      const rej = await http()
        .post(`/api/v1/reversements/demandes/${d.id}/rejeter`)
        .set(auth('admin'))
        .send({ motif: 'Vérification du compte en cours' })
        .expect(201);
      expect(rej.body).toMatchObject({ statut: 'rejetee', motifRejet: 'Vérification du compte en cours' });
      await http()
        .post(`/api/v1/reversements/demandes/${d.id}/approuver`)
        .set(auth('admin'))
        .send({ moyen: 'wave' })
        .expect(409);

      const d2 = await http().post('/api/v1/reversements/demandes').set(auth('gestionnaire')).send({}).expect(201);
      const ann = await http()
        .post(`/api/v1/reversements/demandes/${d2.body.id}/annuler`)
        .set(auth('gestionnaire'))
        .expect(201);
      expect(ann.body.statut).toBe('annulee');
    });

    it('transfert refusé par Jèko → la demande repasse en attente', async () => {
      const d = await http().post('/api/v1/reversements/demandes').set(auth('gestionnaire')).send({}).expect(201);
      erreursForcees.set('/partner_api/transfers', {
        status: 400,
        corps: { id: 'third_party_payment_provider_error', message: 'please retry' },
      });
      const r = await http().post(`/api/v1/reversements/demandes/${d.body.id}/approuver`).set(auth('admin')).send({ moyen: 'wave' });
      expect(r.status).toBeGreaterThanOrEqual(400);
      const apres = await prisma.demandeReversement.findUniqueOrThrow({ where: { id: d.body.id } });
      expect(apres).toMatchObject({ statut: 'en_attente', reversementId: null });
      expect(
        await prisma.notification.count({ where: { type: 'reversement.echoue' } }),
      ).toBeGreaterThanOrEqual(1);
    });

    it('approbation → transfert Jèko du net vers la compagnie, prévenue à la réception', async () => {
      const [d] = (
        await http().get('/api/v1/reversements/demandes?statut=en_attente').set(auth('gestionnaire')).expect(200)
      ).body;
      const res = await http()
        .post(`/api/v1/reversements/demandes/${d.id}/approuver`)
        .set(auth('admin'))
        .send({ moyen: 'wave' })
        .expect(201);
      expect(res.body).toMatchObject({
        statut: 'approuvee',
        reversement: { statut: 'en_cours', nombrePaiements: 1 },
      });
      const t = dernierAppel('POST', '/partner_api/transfers')!;
      expect(t.corps).toMatchObject({ amountCents: 720_000, reference: `YEGO-RV${res.body.reversementId}` });
      // Pas de « reçu » tant que Jèko n'a pas confirmé le transfert.
      const recus = () => prisma.notification.count({ where: { type: 'reversement.pret' } });
      const avant = await recus();
      await webhook(transfert(`YEGO-RV${res.body.reversementId}`, 'success')).expect(200);
      expect(await recus()).toBeGreaterThan(avant);
      expect(dernierAppel('POST', '/partner_api/contacts')!.corps).toMatchObject({
        identifier: { number: '+2250798496595' },
      });

      // Sur le dashboard de la compagnie : « à remettre » jusqu'à la remise.
      const solde = async () =>
        (await http().get('/api/v1/dashboard/solde').set(auth('gestionnaire')).expect(200)).body;
      const s1 = await solde();
      expect(s1.enCoursDeReversement.nombre).toBe(1);
      expect(Number(s1.enCoursDeReversement.montant)).toBe(7200);
      await http()
        .post(`/api/v1/reversements/${res.body.reversementId}/remise`)
        .set(auth('admin'))
        .send({})
        .expect(201);
      const s2 = await solde();
      expect(s2.enCoursDeReversement.nombre).toBe(0);
      expect(Number(s2.totalReverse.montant)).toBe(31050 + 7200);

      // Plus rien à demander tant que de nouveaux billets ne sont pas éligibles.
      await http().post('/api/v1/reversements/demandes').set(auth('gestionnaire')).send({}).expect(400);
      // La compagnie ne voit que ses demandes.
      const liste = await http().get('/api/v1/reversements/demandes').set(auth('gestionnaire')).expect(200);
      expect(liste.body.every((x: { compagnieId: number }) => x.compagnieId === fx.compagnieId)).toBe(true);
      expect(liste.body).toHaveLength(3);
      expect(liste.body.map((x: { statut: string }) => x.statut).sort()).toEqual([
        'annulee',
        'approuvee',
        'rejetee',
      ]);
    });

    it('montant choisi par la compagnie : billets entiers, les plus anciens d’abord', async () => {
      // Deux billets éligibles : 8 000 (plus ancien, net 7 200) puis 3 000 (net 2 700).
      const billet = async (montant: number, datePaiement: Date) => {
        const resa = await prisma.reservation.create({
          data: {
            utilisateurId: (await prisma.utilisateur.findFirstOrThrow({ where: { role: 'user' } })).id,
            departId: fx.departId,
            nombrePlaces: 1,
            canal: 'en_ligne',
            statut: 'confirmee',
          },
        });
        await prisma.paiement.create({
          data: {
            reservationId: resa.id,
            montant,
            moyenPaiement: 'wave',
            statut: 'paye',
            datePaiement,
            jekoReference: `YEGO-P${resa.id}000-T1`,
          },
        });
      };
      await billet(8000, new Date(Date.now() - 3600_000));
      await billet(3000, new Date());
      const demander = (corps: object) =>
        http().post('/api/v1/reversements/demandes').set(auth('gestionnaire')).send(corps);

      expect((await demander({ montant: 50 })).status).toBe(400); // minimum 100
      const trop = await demander({ montant: 10_000 });
      expect(trop.status).toBe(400);
      expect(trop.body.message).toMatch(/9900/);

      // 5 000 : le plus ancien billet (7 200 net) ne tient pas → 400 explicite,
      // la demande reste en attente.
      const petite = await demander({ montant: 5000 });
      expect(petite.status).toBe(201);
      expect(petite.body).toMatchObject({ montantDemande: '5000' });
      expect(Number(petite.body.montantNetEstime)).toBe(9900);
      const refus = await http()
        .post(`/api/v1/reversements/demandes/${petite.body.id}/approuver`)
        .set(auth('admin'))
        .send({ moyen: 'wave' })
        .expect(400);
      expect(refus.body.message).toMatch(/billet entier/);
      expect(
        (await prisma.demandeReversement.findUniqueOrThrow({ where: { id: petite.body.id } })).statut,
      ).toBe('en_attente');
      const solde = await http().get('/api/v1/dashboard/solde').set(auth('gestionnaire')).expect(200);
      expect(solde.body.demandeEnAttente.montantDemande).toBe('5000');
      await http()
        .post(`/api/v1/reversements/demandes/${petite.body.id}/annuler`)
        .set(auth('gestionnaire'))
        .expect(201);

      // 8 000 : seul le billet de 8 000 (7 200 net) tient ; celui de 3 000 reste disponible.
      const d = await demander({ montant: 8000 });
      expect(d.status).toBe(201);
      const ok = await http()
        .post(`/api/v1/reversements/demandes/${d.body.id}/approuver`)
        .set(auth('admin'))
        .send({ moyen: 'wave' })
        .expect(201);
      expect(ok.body.montantDemande).toBe('8000');
      expect(ok.body.reversement).toMatchObject({ nombrePaiements: 1 });
      expect(Number(ok.body.reversement.montantNet)).toBe(7200);
      await webhook(transfert(`YEGO-RV${ok.body.reversementId}`, 'success')).expect(200);
      const apres = await http().get('/api/v1/dashboard/solde').set(auth('gestionnaire')).expect(200);
      expect(Number(apres.body.disponible.montantNet)).toBe(2700);
      expect(apres.body.demandeEnAttente).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  describe('Retrait de la part Yègo', () => {
    const apercu = async () =>
      (await http().get('/api/v1/retraits/apercu').set(auth('admin')).expect(200)).body;

    it('réservé à l’admin plateforme', async () => {
      // (POST /retraits limité à 5 appels/min : les tests suivants en font 5.)
      await http().get('/api/v1/retraits/apercu').set(auth('gestionnaire')).expect(403);
      await http().get('/api/v1/retraits').set(auth('gestionnaire')).expect(403);
    });

    it('retirable = solde Jèko − argent des compagnies et voyageurs', async () => {
      const a = await apercu();
      // Solde réglé à engagements + 50 000 : seuls 50 000 sont à Yègo, frais
      // Jèko du retrait (1,5 %) compris : 49 261 + 739 = 50 000.
      soldeStubCentimes = (Number(a.engagements.total) + 50_000) * 100;
      const b = await apercu();
      expect(Number(b.retirable)).toBe(49_261);
      expect(b.fraisTransfertPourcent).toBe(1.5);
      // Frais des transferts à venir réservés sur l'argent des compagnies.
      expect(Number(b.engagements.fraisTransfertsAVenir)).toBe(
        Math.ceil(
          ((Number(b.engagements.billetsNonReverses) +
            Number(b.engagements.fraisRetenusNonReverses)) *
            1.5) /
            100,
        ),
      );
      expect(b.beneficiaire).toBe('+2250798496595');
      expect(b.moyens).toEqual(['wave', 'orange_money']);
      expect(Number(b.engagements.reversementsEnCours)).toBe(0);
    });

    it('mot de passe exigé, montant borné au retirable, opérateur Wave/Orange seulement', async () => {
      await http()
        .post('/api/v1/retraits')
        .set(auth('admin'))
        .send({ montant: 30_000, moyen: 'wave', motDePasse: 'mauvais' })
        .expect(403);
      await http()
        .post('/api/v1/retraits')
        .set(auth('admin'))
        .send({ montant: 60_000, moyen: 'wave', motDePasse: fx.comptes.admin.motDePasse })
        .expect(400);
      await http()
        .post('/api/v1/retraits')
        .set(auth('admin'))
        .send({ montant: 30_000, moyen: 'mtn_money', motDePasse: fx.comptes.admin.motDePasse })
        .expect(400);
    });

    it('retrait vers le numéro Yègo, puis soldé par la réconciliation', async () => {
      const res = await http()
        .post('/api/v1/retraits')
        .set(auth('admin'))
        .send({ montant: 30_000, moyen: 'orange_money', motDePasse: fx.comptes.admin.motDePasse })
        .expect(201);
      expect(res.body).toMatchObject({
        statut: 'en_cours',
        beneficiaire: '+2250798496595',
        jekoReference: `YEGO-RT${res.body.id}`,
      });
      expect(dernierAppel('POST', '/partner_api/contacts')!.corps).toMatchObject({
        paymentMethod: 'orange',
        identifier: { number: '+2250798496595' },
      });
      expect(dernierAppel('POST', '/partner_api/transfers')!.corps).toMatchObject({
        amountCents: 3_000_000,
        reference: `YEGO-RT${res.body.id}`,
      });

      // Un seul retrait à la fois ; celui en cours est déduit du retirable.
      await http()
        .post('/api/v1/retraits')
        .set(auth('admin'))
        .send({ montant: 1000, moyen: 'wave', motDePasse: fx.comptes.admin.motDePasse })
        .expect(409);
      expect(Number((await apercu()).retirable)).toBe(19_704);

      statuts.set(res.body.jekoTransferId, 'success');
      const bilan = await app.get(JekoWebhookService).reconcilier();
      expect(bilan.retraits).toBe(1);
      const liste = await http().get('/api/v1/retraits').set(auth('admin')).expect(200);
      expect(liste.body[0]).toMatchObject({ id: res.body.id, statut: 'effectue' });
      expect(Number((await apercu()).dejaRetire)).toBe(30_000);
    });
  });
});

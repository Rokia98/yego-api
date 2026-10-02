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
        return repondre(200, { amount: { amount: 1_000_000_000, currency: 'XOF' } });
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
      expect(Number(res.body.fraisService)).toBe(1500);

      const appel = dernierAppel('POST', '/partner_api/payment_requests')!;
      expect(appel.entetes['x-api-key-id']).toBe('id-cle-e2e');
      expect(appel.corps).toMatchObject({
        storeId: 'store-e2e',
        // 2 billets à 15 000 F + 5 % de frais de service = 31 500 F.
        amountCents: 31_500 * 100,
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
        .send(paiementReussi(referenceT1, 3_150_000))
        .expect(401);
      await webhook(paiementReussi(referenceT1, 3_150_000), { signature: 'ab'.repeat(32) }).expect(401);
      const p = await prisma.paiement.findUniqueOrThrow({ where: { id: paiementId } });
      expect(p.statut).toBe('en_attente');
    });

    it('le webhook au prix SANS les frais est refusé (le voyageur doit payer les frais)', async () => {
      await webhook(paiementReussi(referenceT1, 3_000_000)).expect(200);
      const p = await prisma.paiement.findUniqueOrThrow({ where: { id: paiementId } });
      expect(p.statut).toBe('en_attente');
    });

    it('GET /paiements/frais-service → 5 %', () =>
      http()
        .get('/api/v1/paiements/frais-service')
        .set(auth('voyageur'))
        .expect(200)
        .then((r) => expect(r.body).toEqual({ pourcent: 5 })));

    it('webhook au mauvais montant → ignoré (200) et audité', async () => {
      await webhook(paiementReussi(referenceT1, 100)).expect(200);
      const p = await prisma.paiement.findUniqueOrThrow({ where: { id: paiementId } });
      expect(p.statut).toBe('en_attente');
      expect(
        await prisma.auditLog.count({ where: { action: 'paiement.jeko_montant_incoherent', entiteId: paiementId } }),
      ).toBe(2);
    });

    it('la tentative T1 (Orange) payée → paiement "paye", moyen réel conservé', async () => {
      const tx = paiementReussi(referenceT1, 3_150_000);
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
      await webhook(paiementReussi(`YEGO-P${paiementId}-T2`, 3_150_000)).expect(200);
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
      // Paiement T1 confirmé : 2 billets → 1 500 F de frais.
      expect(Number(admin.body.chiffreAffaires.fraisService)).toBe(1500);
      expect(Number(admin.body.chiffreAffaires.parStatutPaiement.paye.montant)).toBe(30000);
      const gestionnaire = await http().get('/api/v1/dashboard/resume').set(auth('gestionnaire')).expect(200);
      expect(gestionnaire.body.chiffreAffaires.fraisService).toBeUndefined();
    });

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
      await webhook(paiementReussi(pay.body.jekoReference, 1_575_000)).expect(200);
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
      // Les 750 F de frais de service payés en plus ne sont pas remboursés.
      expect(remboursement.montantRembourse.toNumber()).toBe(13500);
      const paye = await prisma.paiement.findUniqueOrThrow({ where: { reservationId } });
      expect(paye.fraisService.toNumber()).toBe(750);

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

    it('mode manuel reste possible (décaissement hors plateforme)', async () => {
      const { remboursement } = await payerEnLigne();
      const res = await http()
        .patch(`/api/v1/remboursements/${remboursement.id}/confirmer`)
        .set(auth('gestionnaire'))
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

    it('seul l’admin déclenche ; transfert du net vers le contact compagnie', async () => {
      await http()
        .post('/api/v1/reversements')
        .set(auth('gestionnaire'))
        .send({ compagnieId: fx.compagnieId })
        .expect(403);

      const res = await http()
        .post('/api/v1/reversements')
        .set(auth('admin'))
        .send({ compagnieId: fx.compagnieId })
        .expect(201);
      expect(res.body).toMatchObject({
        statut: 'en_cours',
        nombrePaiements: 5,
        jekoReference: `YEGO-RV${res.body.id}`,
        beneficiaire: '+2250707070707',
      });
      const t = dernierAppel('POST', '/partner_api/transfers')!;
      expect(t.corps).toMatchObject({ amountCents: 3_105_000, reference: `YEGO-RV${res.body.id}` });
      expect(dernierAppel('POST', '/partner_api/contacts')!.corps).toMatchObject({
        name: 'Garantis Transport',
        paymentMethod: 'wave',
      });

      // Plus rien d'éligible : les paiements sont verrouillés sur ce reversement.
      const apercu = await http().get('/api/v1/reversements/apercu').set(auth('gestionnaire')).expect(200);
      expect(apercu.body.nombrePaiements).toBe(0);
      await http()
        .post('/api/v1/reversements')
        .set(auth('admin'))
        .send({ compagnieId: fx.compagnieId })
        .expect(400);

      await webhook(transfert(`YEGO-RV${res.body.id}`, 'success')).expect(200);
      const detail = await http()
        .get(`/api/v1/reversements/${res.body.id}`)
        .set(auth('gestionnaire'))
        .expect(200);
      expect(detail.body.statut).toBe('effectue');
      expect(detail.body.paiements).toHaveLength(5);
    });

    it('transfert échoué → "echoue" et paiements libérés pour un prochain reversement', async () => {
      await paiementPasse(8000);
      const res = await http()
        .post('/api/v1/reversements')
        .set(auth('admin'))
        .send({ compagnieId: fx.compagnieId })
        .expect(201);
      await webhook(transfert(`YEGO-RV${res.body.id}`, 'error')).expect(200);

      const rev = await prisma.reversement.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(rev.statut).toBe('echoue');
      const apercu = await http().get('/api/v1/reversements/apercu').set(auth('gestionnaire')).expect(200);
      expect(apercu.body.nombrePaiements).toBe(1);
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
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { reinitialiser, Fixture } from './fixture';

describe('Yègo API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: () => ReturnType<typeof request>;
  let fx: Fixture;
  const tok: Record<string, string> = {};
  const rtok: Record<string, string> = {};

  beforeAll(async () => {
    // Neutralise le rate limiting global pour la suite e2e.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_GUARD)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
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
    const server = app.getHttpServer();
    http = () => request(server);
    fx = await reinitialiser(prisma);

    // Une seule connexion par rôle (rate limit /auth/login = 5/min) : on garde
    // access + refresh pour toute la suite.
    for (const [role, c] of Object.entries(fx.comptes)) {
      const res = await http().post('/api/v1/auth/login').send(c).expect(201);
      tok[role] = res.body.accessToken;
      rtok[role] = res.body.refreshToken;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (role: string) => ({ Authorization: `Bearer ${tok[role]}` });

  // ---------------------------------------------------------------------------
  describe('Authentification', () => {
    it('login renvoie accessToken + refreshToken', () => {
      expect(tok.admin).toEqual(expect.any(String));
    });

    it('rejette un mauvais mot de passe (401)', () =>
      http()
        .post('/api/v1/auth/login')
        .send({ telephone: fx.comptes.admin.telephone, motDePasse: 'faux' })
        .expect(401));

    it('refresh effectue une rotation + révoque l\'ancien jeton', async () => {
      const rt1 = rtok.voyageur;
      const r = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rt1 })
        .expect(200);
      expect(r.body.refreshToken).toEqual(expect.any(String));
      expect(r.body.refreshToken).not.toBe(rt1);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rt1 })
        .expect(401);
      rtok.voyageur = r.body.refreshToken;
    });
  });

  // ---------------------------------------------------------------------------
  describe('Garde de permissions', () => {
    it('POST /villes — sans token → 401', () =>
      http().post('/api/v1/villes').send({ nom: 'Man' }).expect(401));

    it('POST /villes — voyageur → 403', () =>
      http()
        .post('/api/v1/villes')
        .set(auth('voyageur'))
        .send({ nom: 'Man' })
        .expect(403));

    it('POST /villes — admin → 201', () =>
      http()
        .post('/api/v1/villes')
        .set(auth('admin'))
        .send({ nom: 'Man' })
        .expect(201));

    it('GET /audit-logs — gestionnaire → 403', () =>
      http().get('/api/v1/audit-logs').set(auth('gestionnaire')).expect(403));

    it('GET /audit-logs — admin → 200', () =>
      http().get('/api/v1/audit-logs').set(auth('admin')).expect(200));

    it('POST /agents — agent → 403', () =>
      http()
        .post('/api/v1/agents')
        .set(auth('agent'))
        .send({ nom: 'X', telephone: '+2250700998877', motDePasse: 'MotDePasse1' })
        .expect(403));

    it('POST /agents — gestionnaire → 201, rôle agent, compagnie forcée', async () => {
      const r = await http()
        .post('/api/v1/agents')
        .set(auth('gestionnaire'))
        .send({
          nom: 'Nouvel Agent',
          telephone: '+2250700998877',
          motDePasse: 'MotDePasse1',
        })
        .expect(201);
      expect(r.body.role).toBe('agent');
      expect(r.body.compagnieId).toBe(fx.compagnieId);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Cloisonnement par compagnie', () => {
    it('gestionnaire crée un trajet — compagnie forcée à la sienne', async () => {
      const r = await http()
        .post('/api/v1/trajets')
        .set(auth('gestionnaire'))
        .send({
          compagnieId: fx.compagnieId,
          villeDepartId: fx.villeA,
          villeArriveeId: fx.villeB,
          heureDepart: '09:00',
          prix: 12000,
        })
        .expect(201);
      expect(r.body.compagnieId).toBe(fx.compagnieId);
    });

    it('gestionnaire ne peut pas créer un trajet pour une autre compagnie → 403', () =>
      http()
        .post('/api/v1/trajets')
        .set(auth('gestionnaire'))
        .send({
          compagnieId: fx.autreCompagnieId,
          villeDepartId: fx.villeA,
          villeArriveeId: fx.villeB,
          heureDepart: '09:00',
          prix: 12000,
        })
        .expect(403));
  });

  // ---------------------------------------------------------------------------
  describe('Porte "compagnie opérationnelle"', () => {
    it('compagnie suspendue → gestionnaire ne peut plus créer de trajet (403)', async () => {
      await http()
        .patch(`/api/v1/compagnies/${fx.compagnieId}/statut`)
        .set(auth('admin'))
        .send({ statut: 'suspendu' })
        .expect(200);

      await http()
        .post('/api/v1/trajets')
        .set(auth('gestionnaire'))
        .send({
          compagnieId: fx.compagnieId,
          villeDepartId: fx.villeA,
          villeArriveeId: fx.villeB,
          heureDepart: '10:00',
          prix: 12000,
        })
        .expect(403);

      await http()
        .patch(`/api/v1/compagnies/${fx.compagnieId}/statut`)
        .set(auth('admin'))
        .send({ statut: 'actif' })
        .expect(200);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Pagination bornée', () => {
    it('GET /compagnies?take=99999 renvoie au plus 100 résultats', async () => {
      const r = await http()
        .get('/api/v1/compagnies?take=99999')
        .expect(200);
      expect(Array.isArray(r.body)).toBe(true);
      expect(r.body.length).toBeLessThanOrEqual(100);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Parcours guichet complet', () => {
    let reservationId: number;
    let codeQr: string;

    it('agent vend au guichet (sans compte voyageur) + encaisse', async () => {
      const r = await http()
        .post('/api/v1/reservations/guichet')
        .set(auth('agent'))
        .send({
          departId: fx.departFuturId,
          nombrePlaces: 2,
          passager: { nom: 'Awa Cisse', telephone: '+2250788887777' },
          paiementEspece: true,
        })
        .expect(201);
      expect(r.body.utilisateurId).toBeNull();
      expect(r.body.passagerNom).toBe('Awa Cisse');
      expect(r.body.paiement.statut).toBe('paye');
      reservationId = r.body.id;

      // aucun compte n'a été créé pour ce téléphone
      const compte = await prisma.utilisateur.findUnique({
        where: { telephone: '+2250788887777' },
      });
      expect(compte).toBeNull();
    });

    it('génère le ticket (personnel compagnie)', async () => {
      const r = await http()
        .post(`/api/v1/tickets/reservation/${reservationId}`)
        .set(auth('agent'))
        .send({ siege: 'A1' })
        .expect(201);
      codeQr = r.body.codeQr;
      expect(codeQr).toEqual(expect.any(String));
    });

    it('refuse un 2e ticket sur le même siège → 409', () =>
      http()
        .post(`/api/v1/tickets/reservation/${reservationId}`)
        .set(auth('agent'))
        .send({ siege: 'A1' })
        .expect(409));

    it('valide le ticket à l\'embarquement', () =>
      http()
        .post(`/api/v1/tickets/valider/${codeQr}`)
        .set(auth('agent'))
        .expect(201)
        .then((r) => expect(r.body.valide).toBe(true)));

    it('annulation → remboursement automatique créé', async () => {
      const r = await http()
        .patch(`/api/v1/reservations/${reservationId}/annuler`)
        .set(auth('agent'))
        .expect(200);
      expect(r.body.statut).toBe('annulee');
      expect(r.body.remboursement).toBeTruthy();
      expect(Number(r.body.remboursement.fraisRetenus)).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Encaissement mobile money au guichet', () => {
    it('agent enregistre un paiement Wave sur une réservation guichet', async () => {
      const resa = await http()
        .post('/api/v1/reservations/guichet')
        .set(auth('agent'))
        .send({
          departId: fx.departFuturId,
          nombrePlaces: 1,
          passager: { nom: 'Kone Ali' },
        })
        .expect(201);

      const pay = await http()
        .post('/api/v1/paiements/guichet')
        .set(auth('agent'))
        .send({ reservationId: resa.body.id, moyenPaiement: 'wave' })
        .expect(201);
      expect(pay.body.statut).toBe('paye');
      expect(Number(pay.body.montant)).toBe(15000);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Notifications push', () => {
    it('enregistre un appareil, notifie à la réservation, marque lu', async () => {
      await http()
        .post('/api/v1/notifications/appareils')
        .set(auth('voyageur'))
        .send({ token: 'e2e-fcm-token-registration-0001', plateforme: 'android' })
        .expect(201);

      await http()
        .post('/api/v1/reservations')
        .set(auth('voyageur'))
        .send({ departId: fx.departFuturId, nombrePlaces: 1 })
        .expect(201);

      const liste = await http()
        .get('/api/v1/notifications?nonLu=true')
        .set(auth('voyageur'))
        .expect(200);
      const notif = liste.body.find(
        (n: { type: string }) => n.type === 'reservation.confirmee',
      );
      expect(notif).toBeTruthy();

      const compteur = await http()
        .get('/api/v1/notifications/compteur')
        .set(auth('voyageur'))
        .expect(200);
      expect(compteur.body.nonLues).toBeGreaterThan(0);

      await http()
        .patch(`/api/v1/notifications/${notif.id}/lu`)
        .set(auth('voyageur'))
        .expect(200);

      const apres = await http()
        .get('/api/v1/notifications?nonLu=true')
        .set(auth('voyageur'))
        .expect(200);
      expect(
        apres.body.find((n: { id: number }) => n.id === notif.id),
      ).toBeUndefined();
    });

    it('un autre utilisateur ne voit pas mes notifications', async () => {
      const r = await http()
        .get('/api/v1/notifications')
        .set(auth('gestionnaire'))
        .expect(200);
      expect(Array.isArray(r.body)).toBe(true);
      expect(r.body.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Recherche voyageur', () => {
    it('rejette une date invalide (400)', () =>
      http()
        .get('/api/v1/departs/recherche?depart=Korhogo&arrivee=Abidjan&date=nope')
        .expect(400));

    it('accepte une fourchette de dates', () =>
      http()
        .get(
          '/api/v1/departs/recherche?depart=Korhogo&arrivee=Abidjan&date=2020-01-01&dateFin=2100-01-01',
        )
        .expect(200)
        .then((r) => expect(Array.isArray(r.body)).toBe(true)));
  });
});

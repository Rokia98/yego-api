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

    it('sans date, balaie une fenêtre à partir d’aujourd’hui', () =>
      http()
        .get('/api/v1/departs/recherche?depart=Abidjan&arrivee=Bouaké')
        .expect(200)
        .then((r) => {
          expect(Array.isArray(r.body)).toBe(true);
          // Le départ fixture Abidjan→Bouaké est dans 3 jours.
          expect(r.body.length).toBeGreaterThanOrEqual(1);
        }));

    it('trouve les villes sans tenir compte des accents ni de la casse', () =>
      http()
        .get('/api/v1/departs/recherche?depart=abidjan&arrivee=bouake')
        .expect(200)
        .then((r) => {
          expect(Array.isArray(r.body)).toBe(true);
          expect(r.body.length).toBeGreaterThanOrEqual(1);
        }));

    it('renvoie un tableau vide pour une ville inconnue', () =>
      http()
        .get('/api/v1/departs/recherche?depart=Abidjan&arrivee=Tombouctou')
        .expect(200)
        .then((r) => expect(r.body).toEqual([])));
  });

  // ---------------------------------------------------------------------------
  describe('Choix de place (avant paiement)', () => {
    it('GET /departs/:id/sieges expose le plan', () =>
      http()
        .get(`/api/v1/departs/${fx.departFuturId}/sieges`)
        .expect(200)
        .then((r) => {
          expect(typeof r.body.placesTotales).toBe('number');
          expect(Array.isArray(r.body.occupes)).toBe(true);
        }));

    it('le voyageur réserve des sièges précis', () =>
      http()
        .post('/api/v1/reservations')
        .set(auth('voyageur'))
        .send({ departId: fx.departFuturId, nombrePlaces: 2, sieges: ['C1', 'C2'] })
        .expect(201)
        .then((r) => expect(r.body.sieges).toEqual(['C1', 'C2'])));

    it('les sièges pris apparaissent dans le plan dès la réservation (avant paiement)', () =>
      http()
        .get(`/api/v1/departs/${fx.departFuturId}/sieges`)
        .expect(200)
        .then((r) => {
          expect(r.body.occupes).toEqual(expect.arrayContaining(['C1', 'C2']));
        }));

    it('refuse un siège déjà pris → 409', () =>
      http()
        .post('/api/v1/reservations')
        .set(auth('voyageur'))
        .send({ departId: fx.departFuturId, nombrePlaces: 1, sieges: ['C1'] })
        .expect(409));

    it('refuse un nombre de sièges ≠ nombrePlaces → 400', () =>
      http()
        .post('/api/v1/reservations')
        .set(auth('voyageur'))
        .send({ departId: fx.departFuturId, nombrePlaces: 2, sieges: ['C7'] })
        .expect(400));
  });

  // ---------------------------------------------------------------------------
  describe('Simulation de paiement (PAYMENT_SIMULATION)', () => {
    let reservationId: number;

    it('le voyageur réserve puis initie un paiement (en_attente)', async () => {
      const resa = await http()
        .post('/api/v1/reservations')
        .set(auth('voyageur'))
        .send({ departId: fx.departFuturId, nombrePlaces: 1, sieges: ['E1'] })
        .expect(201);
      reservationId = resa.body.id;

      const pay = await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'orange_money' })
        .expect(201);
      expect(pay.body.statut).toBe('en_attente');
    });

    it('un autre utilisateur ne peut pas simuler ce paiement → 403', () =>
      http()
        .post(`/api/v1/paiements/reservation/${reservationId}/simuler`)
        .set(auth('gestionnaire'))
        .send({ resultat: 'succes' })
        .expect(403));

    it('simuler un échec → paiement "echoue"', () =>
      http()
        .post(`/api/v1/paiements/reservation/${reservationId}/simuler`)
        .set(auth('voyageur'))
        .send({ resultat: 'echec' })
        .expect(201)
        .then((r) => expect(r.body.statut).toBe('echoue')));

    it('simuler un succès → paiement "paye", ticket générable', async () => {
      const r = await http()
        .post(`/api/v1/paiements/reservation/${reservationId}/simuler`)
        .set(auth('voyageur'))
        .send({ resultat: 'succes' })
        .expect(201);
      expect(r.body.statut).toBe('paye');

      const ticket = await http()
        .post(`/api/v1/tickets/reservation/${reservationId}`)
        .set(auth('voyageur'))
        .send({})
        .expect(201);
      expect(ticket.body.siege).toBe('E1');
    });

    it('re-simuler un paiement déjà confirmé → 400', () =>
      http()
        .post(`/api/v1/paiements/reservation/${reservationId}/simuler`)
        .set(auth('voyageur'))
        .send({ resultat: 'succes' })
        .expect(400));
  });

  // ---------------------------------------------------------------------------
  describe('Reprise de paiement en ligne', () => {
    let reservationId: number;
    let paiementId: number;

    it('initie le paiement', async () => {
      const resa = await http()
        .post('/api/v1/reservations')
        .set(auth('voyageur'))
        .send({ departId: fx.departFuturId, nombrePlaces: 1, sieges: ['F1'] })
        .expect(201);
      reservationId = resa.body.id;

      const pay = await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'orange_money' })
        .expect(201);
      paiementId = pay.body.id;
    });

    it('un 2e POST /paiements réutilise le même paiement (pas de 500)', () =>
      http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'wave' })
        .expect(201)
        .then((r) => {
          expect(r.body.id).toBe(paiementId);
          expect(r.body.moyenPaiement).toBe('wave');
          expect(r.body.statut).toBe('en_attente');
        }));

    it('après un échec, on peut relancer le paiement', async () => {
      await http()
        .post(`/api/v1/paiements/reservation/${reservationId}/simuler`)
        .set(auth('voyageur'))
        .send({ resultat: 'echec' })
        .expect(201)
        .then((r) => expect(r.body.statut).toBe('echoue'));

      await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'orange_money' })
        .expect(201)
        .then((r) => expect(r.body.statut).toBe('en_attente'));

      await http()
        .post(`/api/v1/paiements/reservation/${reservationId}/simuler`)
        .set(auth('voyageur'))
        .send({ resultat: 'succes' })
        .expect(201)
        .then((r) => expect(r.body.statut).toBe('paye'));
    });

    it('payer une réservation déjà payée → 400', () =>
      http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId, moyenPaiement: 'wave' })
        .expect(400));

    it('payer une réservation annulée → 400', async () => {
      const resa = await http()
        .post('/api/v1/reservations')
        .set(auth('voyageur'))
        .send({ departId: fx.departFuturId, nombrePlaces: 1 })
        .expect(201);
      await http()
        .patch(`/api/v1/reservations/${resa.body.id}/annuler`)
        .set(auth('voyageur'))
        .expect(200);
      await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId: resa.body.id, moyenPaiement: 'wave' })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Historique des validations (agent)', () => {
    let codeQr: string;

    it('prépare un billet payé et le valide', async () => {
      const resa = await http()
        .post('/api/v1/reservations')
        .set(auth('voyageur'))
        .send({ departId: fx.departFuturId, nombrePlaces: 1, sieges: ['G1'] })
        .expect(201);
      await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId: resa.body.id, moyenPaiement: 'wave' })
        .expect(201);
      await http()
        .post(`/api/v1/paiements/reservation/${resa.body.id}/simuler`)
        .set(auth('voyageur'))
        .send({ resultat: 'succes' })
        .expect(201);
      const ticket = await http()
        .post(`/api/v1/tickets/reservation/${resa.body.id}`)
        .set(auth('voyageur'))
        .send({})
        .expect(201);
      codeQr = ticket.body.codeQr;

      await http()
        .post(`/api/v1/tickets/valider/${codeQr}`)
        .set(auth('agent'))
        .expect(201);
    });

    it("l'agent voit son scan avec le trajet complet", async () => {
      const r = await http()
        .get('/api/v1/tickets/validations')
        .set(auth('agent'))
        .expect(200);
      const entry = r.body.find(
        (v: { codeQr: string }) => v.codeQr === codeQr,
      );
      expect(entry).toBeTruthy();
      expect(entry.resultat).toBe('valide');
      expect(entry.siege).toBe('G1');
      expect(entry.reservation.depart.trajet.villeDepart.nom).toBe('Korhogo');
      expect(entry.reservation.depart.trajet.compagnie.nom).toEqual(
        expect.any(String),
      );
    });

    it('un voyageur n\'a pas accès à l\'historique → 403', () =>
      http()
        .get('/api/v1/tickets/validations')
        .set(auth('voyageur'))
        .expect(403));
  });

  // ---------------------------------------------------------------------------
  describe('Dashboard', () => {
    it('un agent n\'a pas accès (403)', () =>
      http().get('/api/v1/dashboard/resume').set(auth('agent')).expect(403));

    it('un voyageur n\'a pas accès (403)', () =>
      http().get('/api/v1/dashboard/resume').set(auth('voyageur')).expect(403));

    it('le gestionnaire voit le résumé de sa seule compagnie', async () => {
      const r = await http()
        .get('/api/v1/dashboard/resume')
        .set(auth('gestionnaire'))
        .expect(200);
      expect(r.body.reservations.total).toBeGreaterThan(0);
      expect(typeof r.body.occupation.tauxRemplissage).toBe('number');
      expect(r.body.chiffreAffaires.parStatutPaiement).toBeDefined();
    });

    it("l'admin voit le résumé toutes compagnies confondues", () =>
      http()
        .get('/api/v1/dashboard/resume')
        .set(auth('admin'))
        .expect(200)
        .then((r) => expect(r.body.reservations.total).toBeGreaterThan(0)));

    it('classement des trajets les plus vendus (gestionnaire)', () =>
      http()
        .get('/api/v1/dashboard/trajets?limit=5')
        .set(auth('gestionnaire'))
        .expect(200)
        .then((r) => expect(Array.isArray(r.body)).toBe(true)));

    it('classement des compagnies réservé à l\'admin (403 pour gestionnaire)', () =>
      http()
        .get('/api/v1/dashboard/compagnies')
        .set(auth('gestionnaire'))
        .expect(403));

    it("classement des compagnies (admin)", () =>
      http()
        .get('/api/v1/dashboard/compagnies')
        .set(auth('admin'))
        .expect(200)
        .then((r) => expect(Array.isArray(r.body)).toBe(true)));
  });
});

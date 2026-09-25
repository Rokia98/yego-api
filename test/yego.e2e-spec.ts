import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
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
  const uid: Record<string, number> = {};

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
      uid[role] = res.body.utilisateurId;
    }

    // Agent de l'AUTRE compagnie : jeton signé directement (pas de login HTTP,
    // pour ne pas consommer le quota /auth/login déjà utilisé ci-dessus).
    tok.autreAgent = app.get(JwtService).sign({
      sub: fx.autreAgentId,
      telephone: '+2250709998888',
      role: 'agent',
      cid: fx.autreCompagnieId,
      tv: 0,
      pwTmp: false,
    });
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

    it('normalise le téléphone : register saisi en 10 chiffres → stocké en +225…', async () => {
      const reg = await http()
        .post('/api/v1/auth/register')
        .send({
          nom: 'Kone',
          telephone: '07 12 34 56 78',
          motDePasse: 'MotDePasseTest1',
        })
        .expect(201);
      expect(reg.body.telephone).toBe('+2250712345678');
    });

    it('rejette un téléphone non normalisable (400)', () =>
      http()
        .post('/api/v1/auth/register')
        .send({ nom: 'Bad', telephone: 'abc123', motDePasse: 'MotDePasseTest1' })
        .expect(400));
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
  describe('Compagnie : logo + compte gestionnaire', () => {
    const logoData =
      'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'.repeat(4);
    let compagnieId: number;

    it('POST /compagnies accepte un logo data-URI et le conserve en liste', async () => {
      const c = await http()
        .post('/api/v1/compagnies')
        .set(auth('admin'))
        .send({ nom: 'Test Logo SARL', logoUrl: logoData })
        .expect(201);
      compagnieId = c.body.id;
      expect(c.body.logoUrl).toBe(logoData);

      const liste = await http().get('/api/v1/compagnies?take=100').expect(200);
      const trouve = liste.body.find((x: any) => x.id === compagnieId);
      expect(trouve.logoUrl).toBe(logoData);
    });

    it('POST /compagnies refuse un logo data-URI non-image (400)', () =>
      http()
        .post('/api/v1/compagnies')
        .set(auth('admin'))
        .send({ nom: 'Mauvais Logo', logoUrl: 'data:text/html;base64,AAAA' })
        .expect(400));

    it('POST /compagnies/:id/compte-admin crée le gestionnaire + mot de passe temporaire', async () => {
      const r = await http()
        .post(`/api/v1/compagnies/${compagnieId}/compte-admin`)
        .set(auth('admin'))
        .send({ nom: 'Gérant Test', telephone: '07 88 00 11 22' })
        .expect(201);
      expect(r.body).toMatchObject({
        nom: 'Gérant Test',
        telephone: '+2250788001122',
      });
      expect(typeof r.body.motDePasseTemporaire).toBe('string');
      expect(r.body.motDePasseTemporaire.length).toBeGreaterThanOrEqual(12);

      // le compte a bien été créé, rattaché à la compagnie, rôle gestionnaire
      const gestionnaires = await http()
        .get(`/api/v1/compagnies/${compagnieId}`)
        .set(auth('admin'))
        .expect(200);
      expect(gestionnaires.body.utilisateurs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ telephone: '+2250788001122' }),
        ]),
      );

      // en anonyme (route publique) : le gestionnaire est nommé, sans numéro
      const publique = await http()
        .get(`/api/v1/compagnies/${compagnieId}`)
        .expect(200);
      expect(publique.body.utilisateurs).toEqual(
        expect.arrayContaining([expect.objectContaining({ nom: 'Gérant Test' })]),
      );
      for (const g of publique.body.utilisateurs) {
        expect(g.telephone).toBeUndefined();
      }

      // mot de passe généré par un tiers -> flag de changement obligatoire posé
      const u = await prisma.utilisateur.findUnique({
        where: { telephone: '+2250788001122' },
      });
      expect(u?.doitChangerMotDePasse).toBe(true);
    });

    it('compte-admin : 409 si le numéro est déjà rattaché à un autre compte', () =>
      http()
        .post(`/api/v1/compagnies/${compagnieId}/compte-admin`)
        .set(auth('admin'))
        .send({ nom: 'Gérant Bis', telephone: fx.comptes.gestionnaire.telephone })
        .expect(409));

    it('compte-admin : 403 pour un non-admin', () =>
      http()
        .post(`/api/v1/compagnies/${compagnieId}/compte-admin`)
        .set(auth('gestionnaire'))
        .send({ nom: 'Gérant Ter', telephone: '0788445566' })
        .expect(403));
  });

  // ---------------------------------------------------------------------------
  describe('Profil voyageur : photo', () => {
    const photo =
      'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'.repeat(4);

    it('PATCH /utilisateurs/:id accepte une photo data-URI', async () => {
      const r = await http()
        .patch(`/api/v1/utilisateurs/${uid.voyageur}`)
        .set(auth('voyageur'))
        .send({ photoUrl: photo })
        .expect(200);
      expect(r.body.photoUrl).toBe(photo);
    });

    it('refuse une photo trop lourde / mauvais type (400)', () =>
      http()
        .patch(`/api/v1/utilisateurs/${uid.voyageur}`)
        .set(auth('voyageur'))
        .send({ photoUrl: 'data:application/pdf;base64,AAAA' })
        .expect(400));

    it("un voyageur ne peut pas modifier le profil d'un autre (403)", () =>
      http()
        .patch(`/api/v1/utilisateurs/${uid.voyageur}`)
        .set(auth('agent'))
        .send({ photoUrl: photo })
        .expect(403));
  });

  // ---------------------------------------------------------------------------
  describe('Documents de compagnie', () => {
    let docId: number;

    it('le gestionnaire uploade un document (PDF)', async () => {
      const r = await http()
        .post(`/api/v1/compagnies/${fx.compagnieId}/documents`)
        .set(auth('gestionnaire'))
        .field('type', 'registre_commerce')
        .attach('document', Buffer.from('%PDF-1.4 contenu de test'), 'registre.pdf')
        .expect(201);
      expect(r.body).toMatchObject({
        compagnieId: fx.compagnieId,
        type: 'registre_commerce',
        nomFichier: 'registre.pdf',
        mimeType: 'application/pdf',
        statut: 'en_attente',
      });
      expect(r.body.cheminFichier).toBeUndefined();
      docId = r.body.id;
    });

    it('refuse un type de fichier non autorisé (400)', () =>
      http()
        .post(`/api/v1/compagnies/${fx.compagnieId}/documents`)
        .set(auth('gestionnaire'))
        .field('type', 'autre')
        .attach('document', Buffer.from('texte'), 'notes.txt')
        .expect(400));

    it("un agent (pas gestionnaire ni admin) ne peut pas uploader (403)", () =>
      http()
        .post(`/api/v1/compagnies/${fx.compagnieId}/documents`)
        .set(auth('agent'))
        .field('type', 'autre')
        .attach('document', Buffer.from('%PDF-1.4'), 'x.pdf')
        .expect(403));

    it('GET liste les documents (gestionnaire)', () =>
      http()
        .get(`/api/v1/compagnies/${fx.compagnieId}/documents`)
        .set(auth('gestionnaire'))
        .expect(200)
        .then((r) => {
          expect(Array.isArray(r.body)).toBe(true);
          expect(r.body.some((d: any) => d.id === docId)).toBe(true);
        }));

    it('télécharge le fichier (gestionnaire)', () =>
      http()
        .get(`/api/v1/compagnies/${fx.compagnieId}/documents/${docId}/fichier`)
        .set(auth('gestionnaire'))
        .expect(200)
        .expect('Content-Type', 'application/pdf')
        .then((r) => {
          const contenu = Buffer.isBuffer(r.body) ? r.body.toString() : r.text;
          expect(contenu).toContain('PDF');
        }));

    it('un gestionnaire ne peut pas valider/refuser (403), seul un admin peut', async () => {
      await http()
        .patch(`/api/v1/compagnies/${fx.compagnieId}/documents/${docId}`)
        .set(auth('gestionnaire'))
        .send({ statut: 'valide' })
        .expect(403);

      const r = await http()
        .patch(`/api/v1/compagnies/${fx.compagnieId}/documents/${docId}`)
        .set(auth('admin'))
        .send({ statut: 'valide', commentaireAdmin: 'RC conforme' })
        .expect(200);
      expect(r.body).toMatchObject({ statut: 'valide', commentaireAdmin: 'RC conforme' });
    });

    it('supprime le document', () =>
      http()
        .delete(`/api/v1/compagnies/${fx.compagnieId}/documents/${docId}`)
        .set(auth('gestionnaire'))
        .expect(200)
        .then(() =>
          http()
            .get(`/api/v1/compagnies/${fx.compagnieId}/documents/${docId}/fichier`)
            .set(auth('gestionnaire'))
            .expect(404),
        ));
  });

  // ---------------------------------------------------------------------------
  // Compte de test dédié (pas un compte du pool fx.comptes) : cette suite
  // révoque les autres sessions et bump tokenVersion à chaque changement de
  // mot de passe réussi, ce qui casserait les tokens partagés du reste du fichier.
  describe('Changement de mot de passe', () => {
    let token: string;

    it('crée un compte de test', async () => {
      const r = await http()
        .post('/api/v1/auth/register')
        .send({ nom: 'PwTest', telephone: '0788990011', motDePasse: 'MotDePasseTest1' })
        .expect(201);
      token = r.body.accessToken;
    });

    it("refuse un ancien mot de passe incorrect (401)", () =>
      http()
        .patch('/api/v1/auth/mot-de-passe')
        .set('Authorization', `Bearer ${token}`)
        .send({ ancienMotDePasse: 'faux', nouveauMotDePasse: 'NouveauPass1' })
        .expect(401));

    it('change le mot de passe, lève le flag, réémet des jetons', async () => {
      const r = await http()
        .patch('/api/v1/auth/mot-de-passe')
        .set('Authorization', `Bearer ${token}`)
        .send({ ancienMotDePasse: 'MotDePasseTest1', nouveauMotDePasse: 'NouveauPass1' })
        .expect(200);
      expect(r.body.accessToken).toEqual(expect.any(String));
      expect(r.body.refreshToken).toEqual(expect.any(String));

      const payload = JSON.parse(
        Buffer.from(r.body.accessToken.split('.')[1], 'base64url').toString(),
      );
      expect(payload.pwTmp).toBe(false);

      token = r.body.accessToken; // jeton frais (tokenVersion bumpé)
    });

    it("l'ancien mot de passe n'est plus valide (401)", () =>
      http()
        .patch('/api/v1/auth/mot-de-passe')
        .set('Authorization', `Bearer ${token}`)
        .send({ ancienMotDePasse: 'MotDePasseTest1', nouveauMotDePasse: 'Autre123456' })
        .expect(401));
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

    it('passager déjà embarqué : annulation refusée (pas de voyage + remboursement) → 400', async () => {
      await http()
        .patch(`/api/v1/reservations/${reservationId}/annuler`)
        .set(auth('agent'))
        .expect(400);
      const resa = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: { remboursement: true },
      });
      expect(resa?.statut).toBe('confirmee');
      expect(resa?.remboursement).toBeNull();
    });

    it('annulation avant embarquement → remboursement créé ET ticket révoqué', async () => {
      const vente = await http()
        .post('/api/v1/reservations/guichet')
        .set(auth('agent'))
        .send({
          departId: fx.departFuturId,
          nombrePlaces: 1,
          passager: { nom: 'Kone Ibrahim' },
          paiementEspece: true,
        })
        .expect(201);
      reservationId = vente.body.id;
      const ticket = await http()
        .post(`/api/v1/tickets/reservation/${reservationId}`)
        .set(auth('agent'))
        .send({})
        .expect(201);

      const r = await http()
        .patch(`/api/v1/reservations/${reservationId}/annuler`)
        .set(auth('agent'))
        .expect(200);
      expect(r.body.statut).toBe('annulee');
      expect(r.body.remboursement).toBeTruthy();
      expect(Number(r.body.remboursement.fraisRetenus)).toBeGreaterThan(0);

      // le QR de la réservation annulée ne fait plus embarquer
      const scan = await http()
        .post(`/api/v1/tickets/valider/${ticket.body.codeQr}`)
        .set(auth('agent'))
        .expect(201);
      expect(scan.body.valide).toBe(false);
    });

    it('GET /remboursements/statut/en_attente : réservation enrichie (voyageur + trajet)', () =>
      http()
        .get('/api/v1/remboursements/statut/en_attente')
        .set(auth('gestionnaire'))
        .expect(200)
        .then((r) => {
          expect(Array.isArray(r.body)).toBe(true);
          const remb = r.body.find(
            (x: any) => x.reservation?.id === reservationId,
          );
          expect(remb).toBeTruthy();
          expect(remb.reservation.depart.trajet.villeArrivee.nom).toEqual(
            expect.any(String),
          );
          // résa au guichet (passagerNom) ou en ligne (utilisateur) — au moins l'un
          expect(
            remb.reservation.utilisateur ?? remb.reservation.passagerNom,
          ).toBeTruthy();
        }));
  });

  // ---------------------------------------------------------------------------
  describe('Failles critiques (non-régression)', () => {
    const webhook = () => ({
      'x-webhook-secret': process.env.PAYMENT_WEBHOOK_SECRET as string,
    });

    // Réservation en ligne du voyageur, paiement initié (en_attente).
    const reserverEtInitierPaiement = async () => {
      const resa = await http()
        .post('/api/v1/reservations')
        .set(auth('voyageur'))
        .send({ departId: fx.departFuturId, nombrePlaces: 1 })
        .expect(201);
      await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId: resa.body.id, moyenPaiement: 'wave' })
        .expect(201);
      return resa.body.id as number;
    };

    it('POST /remboursements : interdit au voyageur (403)', async () => {
      const id = await reserverEtInitierPaiement();
      await http()
        .post(`/api/v1/paiements/reservation/${id}/simuler`)
        .set(auth('voyageur'))
        .send({ resultat: 'succes' })
        .expect(201);
      await http()
        .post('/api/v1/remboursements')
        .set(auth('voyageur'))
        .send({ reservationId: id, fraisRetenus: 0 })
        .expect(403);
    });

    it('POST /remboursements : refusé sur une réservation non annulée, même par le gestionnaire (400)', async () => {
      const id = await reserverEtInitierPaiement();
      await http()
        .post(`/api/v1/paiements/reservation/${id}/simuler`)
        .set(auth('voyageur'))
        .send({ resultat: 'succes' })
        .expect(201);
      await http()
        .post('/api/v1/remboursements')
        .set(auth('gestionnaire'))
        .send({ reservationId: id, fraisRetenus: 0 })
        .expect(400);
    });

    it('webhook confirmer : réservation annulée entre-temps → 409, paiement inchangé', async () => {
      const id = await reserverEtInitierPaiement();
      await http()
        .patch(`/api/v1/reservations/${id}/annuler`)
        .set(auth('voyageur'))
        .expect(200);
      await http()
        .patch(`/api/v1/paiements/reservation/${id}/confirmer`)
        .set(webhook())
        .expect(409);
      const p = await prisma.paiement.findUnique({ where: { reservationId: id } });
      expect(p?.statut).toBe('en_attente');
    });

    it('webhook confirmer rejoué sur un paiement payé : idempotent (200)', async () => {
      const id = await reserverEtInitierPaiement();
      await http()
        .patch(`/api/v1/paiements/reservation/${id}/confirmer`)
        .set(webhook())
        .expect(200);
      const r = await http()
        .patch(`/api/v1/paiements/reservation/${id}/confirmer`)
        .set(webhook())
        .expect(200);
      expect(r.body.statut).toBe('paye');
    });

    it('simuler sur une réservation annulée → 400', async () => {
      const id = await reserverEtInitierPaiement();
      await http()
        .patch(`/api/v1/reservations/${id}/annuler`)
        .set(auth('voyageur'))
        .expect(200);
      await http()
        .post(`/api/v1/paiements/reservation/${id}/simuler`)
        .set(auth('voyageur'))
        .send({ resultat: 'succes' })
        .expect(400);
    });

    it('routes publiques : ni passagers ni données personnelles du chauffeur', async () => {
      const chauffeur = await prisma.chauffeur.create({
        data: {
          compagnieId: fx.compagnieId,
          nom: 'Chauffeur Test',
          telephone: '+2250701010101',
          numeroPermis: 'CI-PERMIS-123',
        },
      });
      await prisma.depart.update({
        where: { id: fx.departFuturId },
        data: { chauffeurId: chauffeur.id },
      });

      const d = await http().get(`/api/v1/departs/${fx.departFuturId}`).expect(200);
      expect(d.body.reservations).toBeUndefined();
      expect(d.body.chauffeur).toEqual({ id: chauffeur.id, nom: 'Chauffeur Test' });

      const liste = await http().get('/api/v1/departs?take=100').expect(200);
      for (const dep of liste.body) {
        if (dep.chauffeur) expect(dep.chauffeur.telephone).toBeUndefined();
      }

      const c = await http().get(`/api/v1/compagnies/${fx.compagnieId}`).expect(200);
      expect(c.body.chauffeurs).toEqual(
        expect.arrayContaining([{ id: chauffeur.id, nom: 'Chauffeur Test' }]),
      );
      const toutes = await http().get('/api/v1/compagnies?take=100').expect(200);
      for (const comp of toutes.body) {
        for (const ch of comp.chauffeurs) {
          expect(ch.telephone).toBeUndefined();
          expect(ch.numeroPermis).toBeUndefined();
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('Vente sur un départ fermé', () => {
    it('guichet : départ déjà parti (hier) → 400', () =>
      http()
        .post('/api/v1/reservations/guichet')
        .set(auth('agent'))
        .send({ departId: fx.departId, nombrePlaces: 1, passager: { nom: 'Tard Venu' } })
        .expect(400));

    it('en ligne : départ déjà parti (hier) → 400', () =>
      http()
        .post('/api/v1/reservations')
        .set(auth('voyageur'))
        .send({ departId: fx.departId, nombrePlaces: 1 })
        .expect(400));

    it('guichet : départ annulé → 400', async () => {
      const dans2Mois = new Date();
      dans2Mois.setMonth(dans2Mois.getMonth() + 2);
      const annule = await prisma.depart.create({
        data: {
          trajetId: fx.trajetId,
          dateDepart: dans2Mois,
          placesTotales: 50,
          placesDisponibles: 50,
          statut: 'annule',
        },
      });
      await http()
        .post('/api/v1/reservations/guichet')
        .set(auth('agent'))
        .send({ departId: annule.id, nombrePlaces: 1, passager: { nom: 'Kouame' } })
        .expect(400);
    });

    it('nombrePlaces > 10 → 400 (aligné sur la limite de sièges)', () =>
      http()
        .post('/api/v1/reservations/guichet')
        .set(auth('agent'))
        .send({ departId: fx.departFuturId, nombrePlaces: 11, passager: { nom: 'Groupe' } })
        .expect(400));
  });

  // ---------------------------------------------------------------------------
  describe('Filtres serveur des listes', () => {
    it('GET /reservations?canal=guichet&statut=annulee', async () => {
      const r = await http()
        .get('/api/v1/reservations?canal=guichet&statut=annulee&take=100')
        .set(auth('gestionnaire'))
        .expect(200);
      expect(r.body.length).toBeGreaterThan(0);
      for (const x of r.body) {
        expect(x.canal).toBe('guichet');
        expect(x.statut).toBe('annulee');
      }
    });

    it('GET /reservations?paiement=non_paye : aucune réservation payée', async () => {
      const r = await http()
        .get('/api/v1/reservations?paiement=non_paye&take=100')
        .set(auth('gestionnaire'))
        .expect(200);
      expect(r.body.length).toBeGreaterThan(0);
      for (const x of r.body) expect(x.paiement?.statut).not.toBe('paye');
    });

    it('GET /reservations?q= : par nom de passager, puis par #id', async () => {
      const parNom = await http()
        .get('/api/v1/reservations?q=awa%20cis&take=100')
        .set(auth('gestionnaire'))
        .expect(200);
      expect(parNom.body.length).toBeGreaterThan(0);
      for (const x of parNom.body) expect(x.passagerNom).toBe('Awa Cisse');

      const id = parNom.body[0].id;
      const parId = await http()
        .get(`/api/v1/reservations?q=%23${id}`)
        .set(auth('gestionnaire'))
        .expect(200);
      expect(parId.body.map((x: any) => x.id)).toEqual([id]);
    });

    it('GET /reservations?du&au : bornes sur la date du départ', async () => {
      const d = await prisma.depart.findUniqueOrThrow({ where: { id: fx.departFuturId } });
      const jour = d.dateDepart.toISOString().slice(0, 10);
      const r = await http()
        .get(`/api/v1/reservations?du=${jour}&au=${jour}&take=100`)
        .set(auth('gestionnaire'))
        .expect(200);
      expect(r.body.length).toBeGreaterThan(0);
      for (const x of r.body) expect(x.departId).toBe(fx.departFuturId);
    });

    it('GET /reservations?reserveDu&reserveAu : date de réservation (aujourd’hui / demain)', async () => {
      const auj = new Date().toISOString().slice(0, 10);
      const demain = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const r = await http()
        .get(`/api/v1/reservations?reserveDu=${auj}&reserveAu=${auj}&take=100`)
        .set(auth('gestionnaire'))
        .expect(200);
      expect(r.body.length).toBeGreaterThan(0);
      for (const x of r.body) expect(x.dateReservation.slice(0, 10)).toBe(auj);
      // tri inchangé : dateReservation desc
      const dates = r.body.map((x: any) => x.dateReservation);
      expect(dates).toEqual([...dates].sort().reverse());

      const vide = await http()
        .get(`/api/v1/reservations?reserveDu=${demain}`)
        .set(auth('gestionnaire'))
        .expect(200);
      expect(vide.body).toEqual([]);
    });

    it("GET /reservations?compagnieId= n'élargit pas le cloisonnement du voyageur", async () => {
      const r = await http()
        .get(`/api/v1/reservations?compagnieId=${fx.autreCompagnieId}&take=100`)
        .set(auth('voyageur'))
        .expect(200);
      for (const x of r.body) expect(x.utilisateurId).toBe(uid.voyageur);
    });

    it('GET /reservations : filtre invalide → 400', () =>
      http()
        .get('/api/v1/reservations?du=24-09-2026')
        .set(auth('gestionnaire'))
        .expect(400));

    it('GET /departs?ordre=desc : les plus récents en premier', async () => {
      const r = await http().get('/api/v1/departs?ordre=desc&take=100').expect(200);
      const dates = r.body.map((d: any) => d.dateDepart);
      expect(dates).toEqual([...dates].sort().reverse());
    });

    it('GET /departs?statut=annule&trajetId=', async () => {
      const r = await http()
        .get(`/api/v1/departs?statut=annule&trajetId=${fx.trajetId}`)
        .expect(200);
      expect(r.body.length).toBeGreaterThan(0);
      for (const d of r.body) {
        expect(d.statut).toBe('annule');
        expect(d.trajetId).toBe(fx.trajetId);
      }
    });

    it('GET /tickets/validations?resultat=valide|refuse', async () => {
      const ok = await http()
        .get('/api/v1/tickets/validations?resultat=valide&take=100')
        .set(auth('admin'))
        .expect(200);
      expect(ok.body.length).toBeGreaterThan(0);
      for (const v of ok.body) expect(v.resultat).toBe('valide');

      const ko = await http()
        .get('/api/v1/tickets/validations?resultat=refuse&take=100')
        .set(auth('admin'))
        .expect(200);
      expect(ko.body.length).toBeGreaterThan(0);
      for (const v of ko.body) expect(v.resultat).not.toBe('valide');
    });

    it("GET /tickets/validations?du=demain : rien (bornes sur la date du scan)", async () => {
      const demain = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const r = await http()
        .get(`/api/v1/tickets/validations?du=${demain}`)
        .set(auth('admin'))
        .expect(200);
      expect(r.body).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Support (demandes)', () => {
    let demandeVoyageur: number;
    let demandeAgent: number;

    it('voyageur : demande rattachée à la compagnie via SA réservation', async () => {
      const resa = await http()
        .post('/api/v1/reservations')
        .set(auth('voyageur'))
        .send({ departId: fx.departFuturId, nombrePlaces: 1 })
        .expect(201);
      const r = await http()
        .post('/api/v1/support/demandes')
        .set(auth('voyageur'))
        .send({
          categorie: 'paiement',
          sujet: 'Paiement débité deux fois',
          message: 'Bonjour, mon compte Wave a été débité deux fois.',
          reservationId: resa.body.id,
        })
        .expect(201);
      demandeVoyageur = r.body.id;
      expect(r.body).toMatchObject({
        compagnieId: fx.compagnieId,
        auteurRole: 'user',
        statut: 'ouverte',
        priorite: 'normale',
        nbMessages: 1,
        compagnie: { id: fx.compagnieId },
      });
      expect(r.body.messages).toHaveLength(1);
    });

    it("voyageur : réservation d'un autre → 403", async () => {
      const guichet = await prisma.reservation.findFirstOrThrow({
        where: { canal: 'guichet' },
      });
      await http()
        .post('/api/v1/support/demandes')
        .set(auth('voyageur'))
        .send({
          categorie: 'reservation',
          sujet: 'Pas ma réservation',
          message: 'test',
          reservationId: guichet.id,
        })
        .expect(403);
    });

    it("admin : n'ouvre pas de demande (403) ; validation stricte (400)", async () => {
      await http()
        .post('/api/v1/support/demandes')
        .set(auth('admin'))
        .send({ categorie: 'autre', sujet: 'Sujet admin', message: 'x' })
        .expect(403);
      await http()
        .post('/api/v1/support/demandes')
        .set(auth('voyageur'))
        .send({ categorie: 'inconnue', sujet: 'abc', message: '' })
        .expect(400);
    });

    it('agent : demande rattachée à sa compagnie (cid)', async () => {
      const r = await http()
        .post('/api/v1/support/demandes')
        .set(auth('agent'))
        .send({
          categorie: 'technique',
          sujet: 'Scanner QR en panne',
          message: "L'application ne lit plus les QR.",
        })
        .expect(201);
      demandeAgent = r.body.id;
      expect(r.body.compagnieId).toBe(fx.compagnieId);
      expect(r.body.auteurRole).toBe('agent');
    });

    it('portée des listes : voyageur / gestionnaire / autre compagnie / admin', async () => {
      const ids = async (role: string, qs = '') =>
        (
          await http()
            .get(`/api/v1/support/demandes${qs}`)
            .set(auth(role))
            .expect(200)
        ).body.map((d: any) => d.id);

      expect(await ids('voyageur')).toEqual([demandeVoyageur]);
      expect(await ids('agent')).toEqual([demandeAgent]);
      expect(await ids('gestionnaire')).toEqual(
        expect.arrayContaining([demandeVoyageur, demandeAgent]),
      );
      expect(await ids('gestionnaire', '?origine=voyageur')).toEqual([demandeVoyageur]);
      expect(await ids('autreAgent')).toEqual([]);
      expect(await ids('admin', `?q=%23${demandeAgent}`)).toEqual([demandeAgent]);
      await http()
        .get('/api/v1/support/demandes?statut=nimporte')
        .set(auth('admin'))
        .expect(400);
      await http()
        .get(`/api/v1/support/demandes/${demandeVoyageur}`)
        .set(auth('autreAgent'))
        .expect(404);
    });

    it('gestionnaire répond à la demande voyageur → en_cours + notification', async () => {
      await http()
        .post(`/api/v1/support/demandes/${demandeVoyageur}/messages`)
        .set(auth('gestionnaire'))
        .send({ contenu: 'Nous vérifions avec Wave.' })
        .expect(201);
      const d = await prisma.demandeSupport.findUniqueOrThrow({
        where: { id: demandeVoyageur },
      });
      expect(d.statut).toBe('en_cours');
      expect(d.nbMessages).toBe(2);
      const notif = await prisma.notification.findFirst({
        where: { utilisateurId: uid.voyageur, type: 'support.reponse' },
      });
      expect(notif).toBeTruthy();
    });

    it("gestionnaire ne traite pas la demande de son agent (équipe Yègo) → 403", () =>
      http()
        .post(`/api/v1/support/demandes/${demandeAgent}/messages`)
        .set(auth('gestionnaire'))
        .send({ contenu: 'Je réponds ?' })
        .expect(403));

    it("notes internes : admin seulement, invisibles pour l'auteur", async () => {
      await http()
        .post(`/api/v1/support/demandes/${demandeVoyageur}/messages`)
        .set(auth('voyageur'))
        .send({ contenu: 'note', interne: true })
        .expect(403);
      await http()
        .post(`/api/v1/support/demandes/${demandeVoyageur}/messages`)
        .set(auth('admin'))
        .send({ contenu: 'Client déjà remboursé une fois en août.', interne: true })
        .expect(201);

      const vu = async (role: string) =>
        (
          await http()
            .get(`/api/v1/support/demandes/${demandeVoyageur}`)
            .set(auth(role))
            .expect(200)
        ).body;
      const pourAuteur = await vu('voyageur');
      expect(pourAuteur.messages.some((m: any) => m.interne)).toBe(false);
      expect(pourAuteur.nbMessages).toBe(2); // la note ne compte pas
      const pourAdmin = await vu('admin');
      expect(pourAdmin.messages.some((m: any) => m.interne)).toBe(true);
    });

    it('résolue par le traitant (audit + notif) puis réouverte par la relance de l’auteur', async () => {
      await http()
        .patch(`/api/v1/support/demandes/${demandeVoyageur}`)
        .set(auth('gestionnaire'))
        .send({ statut: 'resolue', priorite: 'haute' })
        .expect(200);
      expect(
        await prisma.auditLog.findFirst({
          where: { action: 'support.statut', entiteId: demandeVoyageur },
        }),
      ).toBeTruthy();
      expect(
        await prisma.notification.findFirst({
          where: { utilisateurId: uid.voyageur, type: 'support.statut' },
        }),
      ).toBeTruthy();

      await http()
        .post(`/api/v1/support/demandes/${demandeVoyageur}/messages`)
        .set(auth('voyageur'))
        .send({ contenu: 'Toujours pas remboursé.' })
        .expect(201);
      const d = await prisma.demandeSupport.findUniqueOrThrow({
        where: { id: demandeVoyageur },
      });
      expect(d.statut).toBe('ouverte');
    });

    it("compteurs : dans la portée de l'appelant", async () => {
      const r = await http()
        .get('/api/v1/support/compteurs')
        .set(auth('gestionnaire'))
        .expect(200);
      // demande voyageur ré-ouverte + demande de l'agent (ouverte)
      expect(r.body).toEqual({ ouverte: 2, en_cours: 0 });
    });

    it("auteur : peut seulement fermer ; plus de message sur une demande fermée", async () => {
      await http()
        .patch(`/api/v1/support/demandes/${demandeVoyageur}`)
        .set(auth('voyageur'))
        .send({ priorite: 'haute' })
        .expect(403);
      await http()
        .patch(`/api/v1/support/demandes/${demandeVoyageur}`)
        .set(auth('voyageur'))
        .send({ statut: 'resolue' })
        .expect(403);
      await http()
        .patch(`/api/v1/support/demandes/${demandeVoyageur}`)
        .set(auth('voyageur'))
        .send({ statut: 'fermee' })
        .expect(200);
      await http()
        .post(`/api/v1/support/demandes/${demandeVoyageur}/messages`)
        .set(auth('voyageur'))
        .send({ contenu: 'encore moi' })
        .expect(400);
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
          expect(typeof r.body.placesVendues).toBe('number');
          expect(typeof r.body.placesSansSiege).toBe('number');
          expect(r.body.placesSansSiege).toBe(
            Math.max(0, r.body.placesVendues - r.body.occupes.length),
          );
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

    it('série journalière : un point par jour, jours vides à zéro (gestionnaire)', () =>
      http()
        .get('/api/v1/dashboard/series?from=2026-09-01&to=2026-09-05')
        .set(auth('gestionnaire'))
        .expect(200)
        .then((r) => {
          expect(r.body).toHaveLength(5);
          expect(r.body[0]).toMatchObject({
            date: '2026-09-01',
            reservations: expect.any(Number),
            revenu: expect.any(String),
            parCanal: { en_ligne: expect.any(Number), guichet: expect.any(Number) },
          });
        }));

    it('série : un agent (403)', () =>
      http()
        .get('/api/v1/dashboard/series')
        .set(auth('agent'))
        .expect(403));
  });

  // ---------------------------------------------------------------------------
  describe('Validation hors-ligne (QR signés)', () => {
    let codeQr: string;

    it('GET /tickets/cle-publique expose la clé publique Ed25519', () =>
      http()
        .get('/api/v1/tickets/cle-publique')
        .expect(200)
        .then((r) => {
          expect(r.body.algo).toBe('ed25519');
          expect(r.body.clePublique).toContain('BEGIN PUBLIC KEY');
        }));

    it('un ticket généré porte un codeQr signé (YEGO1.…)', async () => {
      const resa = await http()
        .post('/api/v1/reservations')
        .set(auth('voyageur'))
        .send({ departId: fx.departFuturId, nombrePlaces: 1 })
        .expect(201);
      await http()
        .post('/api/v1/paiements')
        .set(auth('voyageur'))
        .send({ reservationId: resa.body.id, moyenPaiement: 'orange_money' })
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
      expect(ticket.body.codeQr).toMatch(/^YEGO1\./);
      codeQr = ticket.body.codeQr;
    });

    it('le manifeste du départ liste les tickets (agent)', () =>
      http()
        .get(`/api/v1/tickets/depart/${fx.departFuturId}/manifeste`)
        .set(auth('agent'))
        .expect(200)
        .then((r) => {
          expect(r.body.clePublique).toContain('BEGIN PUBLIC KEY');
          expect(r.body.tickets.some((t: any) => t.codeQr === codeQr)).toBe(true);
        }));

    // Sécurité inter-compagnies : un agent d'une compagnie ne doit jamais
    // pouvoir scanner (ou même consulter le manifeste) des tickets d'une
    // AUTRE compagnie — cf. valider() dans tickets.service.ts.
    it("un agent d'une autre compagnie ne peut ni lire le manifeste...", () =>
      http()
        .get(`/api/v1/tickets/depart/${fx.departFuturId}/manifeste`)
        .set(auth('autreAgent'))
        .expect(403));

    it('...ni valider un ticket de cette compagnie (403, tracé en audit)', () =>
      http()
        .post(`/api/v1/tickets/valider/${codeQr}`)
        .set(auth('autreAgent'))
        .expect(403)
        .then((r) =>
          expect(r.body.message).toMatch(/n'appartient pas à un départ de votre compagnie/),
        ));

    it('...ni via la synchronisation hors-ligne (même garde)', () =>
      http()
        .post('/api/v1/tickets/validations/sync')
        .set(auth('autreAgent'))
        .send({ scans: [{ codeQr }] })
        .expect(201)
        .then((r) => {
          // La sync avale les erreurs par ticket (best-effort) : le refus se
          // lit dans le résultat individuel, pas dans le code HTTP global.
          expect(r.body.resultats[0].valide).toBe(false);
          expect(r.body.resultats[0].message).toMatch(/hors de votre compagnie/);
        }));

    it('sync : 1er scan valide, 2e scan « déjà utilisé »', async () => {
      const r1 = await http()
        .post('/api/v1/tickets/validations/sync')
        .set(auth('agent'))
        .send({ scans: [{ codeQr, scanneA: new Date().toISOString() }] })
        .expect(201);
      expect(r1.body.resultats[0].valide).toBe(true);

      const r2 = await http()
        .post('/api/v1/tickets/validations/sync')
        .set(auth('agent'))
        .send({ scans: [{ codeQr }] })
        .expect(201);
      expect(r2.body.resultats[0].valide).toBe(false);
    });

    it('rejette une signature falsifiée', () =>
      http()
        .post('/api/v1/tickets/valider/YEGO1.eyJ0IjoxfQ.zzzz')
        .set(auth('agent'))
        .expect(201)
        .then((r) => expect(r.body.valide).toBe(false)));
  });

  // ---------------------------------------------------------------------------
  describe('Suivi GPS temps réel', () => {
    let suiviToken: string;

    it('le gestionnaire démarre un départ planifié', async () => {
      const r = await http()
        .post(`/api/v1/departs/${fx.departFuturId}/demarrer`)
        .set(auth('gestionnaire'))
        .expect(201);
      expect(r.body.depart.statut).toBe('en_route');
      expect(r.body.suiviToken).toEqual(expect.any(String));
      suiviToken = r.body.suiviToken;
    });

    it('refuse un second démarrage (409)', () =>
      http()
        .post(`/api/v1/departs/${fx.departFuturId}/demarrer`)
        .set(auth('gestionnaire'))
        .expect(409));

    it('position refusée sans jeton de suivi (401)', () =>
      http()
        .post(`/api/v1/departs/${fx.departFuturId}/position`)
        .send({ latitude: 6.5, longitude: -4.5 })
        .expect(401));

    it('le chauffeur poste une position avec le jeton', () =>
      http()
        .post(`/api/v1/departs/${fx.departFuturId}/position`)
        .set('Authorization', `Bearer ${suiviToken}`)
        .send({ latitude: 6.8, longitude: -5.0, vitesse: 72 })
        .expect(201)
        .then((r) => expect(r.body.ok).toBe(true)));

    it('le voyageur ayant réservé suit le départ (position + ETA)', () =>
      http()
        .get(`/api/v1/departs/${fx.departFuturId}/suivi`)
        .set(auth('voyageur'))
        .expect(200)
        .then((r) => {
          expect(r.body.statut).toBe('en_route');
          expect(r.body.derniere).not.toBeNull();
          expect(r.body.eta.minutesRestantes).toBeGreaterThan(0);
        }));

    it('un voyageur sans réservation est refusé (403)', async () => {
      const autre = await http()
        .post('/api/v1/auth/register')
        .send({
          nom: 'Sans Résa',
          telephone: '+2250709999999',
          motDePasse: 'MotDePasseTest1',
        })
        .expect(201);
      await http()
        .get(`/api/v1/departs/${fx.departFuturId}/suivi`)
        .set('Authorization', `Bearer ${autre.body.accessToken}`)
        .expect(403);
    });

    it("l'historique renvoie la trace", () =>
      http()
        .get(`/api/v1/departs/${fx.departFuturId}/suivi/historique`)
        .set(auth('voyageur'))
        .expect(200)
        .then((r) => expect(r.body.points.length).toBeGreaterThan(0)));

    it('le chauffeur clôt le trajet', () =>
      http()
        .post(`/api/v1/departs/${fx.departFuturId}/arriver`)
        .set('Authorization', `Bearer ${suiviToken}`)
        .expect(201)
        .then((r) => expect(r.body.statut).toBe('arrive')));
  });

  // ---------------------------------------------------------------------------
  describe('Notifications horaire / retard', () => {
    it('POST /departs/:id/retard : gestionnaire, cloisonné', async () => {
      await http()
        .post(`/api/v1/departs/${fx.departBouakeId}/retard`)
        .set(auth('gestionnaire'))
        .send({ minutesRetard: 40, motif: 'route coupée' })
        .expect(201)
        .then((r) => expect(r.body.retardMinutes).toBe(40));

      await http()
        .post(`/api/v1/departs/${fx.departBouakeId}/retard`)
        .set(auth('voyageur'))
        .send({ minutesRetard: 5 })
        .expect(403);
    });

    it('PATCH /trajets/:id (heure de départ) est accepté par le gestionnaire', () =>
      http()
        .patch(`/api/v1/trajets/${fx.trajetId}`)
        .set(auth('gestionnaire'))
        .send({ heureDepart: '08:30' })
        .expect(200)
        .then((r) => expect(r.body.heureDepart).toContain('08:30')));
  });
});

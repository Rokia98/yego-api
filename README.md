# Yègo API 🚌

API back-end de la plateforme de réservation de tickets de transport interurbain **Yègo**
(ligne pilote Korhogo — Abidjan, Côte d'Ivoire).

## 📋 Stack Technique

- **Framework**: NestJS 10 + TypeScript
- **Base de données**: PostgreSQL 16 + Prisma ORM (migrations versionnées)
- **Authentification**: JWT + RBAC (`@Roles()` / `RolesGuard`)
- **Validation**: class-validator, class-transformer, schéma d'environnement validé au boot
- **Sécurité**: bcrypt (cost 12), helmet, rate limiting, CORS liste blanche
- **Docs**: OpenAPI/Swagger sur `/api/v1/docs` (dev, ou `SWAGGER_ENABLED=true`)
- **Conteneurisation**: Dockerfile multi-stage + docker-compose

## 🚀 Démarrage Rapide

### Prérequis
- Node.js 18+
- PostgreSQL 12+
- npm ou yarn

### Installation

```bash
# Cloner le repository
git clone <repo-url>
cd yego-api

# Installer les dépendances
npm install

# Configurer les variables d'environnement
cp .env.example .env
# Éditer .env et remplir DATABASE_URL et JWT_SECRET

# Générer le client Prisma
npm run prisma:generate

# Créer les tables en base
npm run prisma:migrate

# Démarrer en développement
npm run start:dev
```

L'API démarre sur `http://localhost:3000/api/v1`.

### Données de démonstration

`npm run prisma:seed` (ou `SEED_ON_START=true` avec Docker) crée un jeu de
données inspiré des compagnies interurbaines ivoiriennes :

| Compagnie | Exemple de lignes |
|---|---|
| **Garantis Transport** | Korhogo ↔ Abidjan |
| **UTB** — Union des Transports de Bouaké | Abidjan → Bouaké → Korhogo, Abidjan → Korhogo |
| **CHONCO Transport** | Abidjan ↔ Korhogo, Korhogo → Ferkessédougou |
| **GTI** — Générale de Transport Interurbain | Abidjan → Man / Daloa / Yamoussoukro |
| **AVS** — Africa Voyages Services | Abidjan ↔ San-Pédro |

Chaque compagnie a un abonnement plateforme actif, un `company_admin`, un agent,
un véhicule, un chauffeur, et des départs les 10 / 12 / 15 septembre 2026.

**Comptes de test** (téléphone / mot de passe) :

| Rôle | Téléphone | Mot de passe |
|---|---|---|
| admin plateforme | `+2250700000001` | `ChangeMoi!Admin2026` |
| voyageur | `+225701234567` | `password123` |
| voyageur | `+225707654321` | `password456` |
| company_admin · Garantis | `+2250700000002` | `ChangeMoi!Compagnie` |
| agent · Garantis | `+2250700000003` | `ChangeMoi!Agent` |
| company_admin · UTB | `+2250705000002` | `Gestion!UTB` |
| agent · UTB | `+2250705000003` | `Agent!UTB` |
| company_admin · CHONCO | `+2250706000002` | `Gestion!CHONCO` |
| company_admin · GTI | `+2250707000002` | `Gestion!GTI` |
| company_admin · AVS | `+2250708000002` | `Gestion!AVS` |

*(agents des autres compagnies : `…000003` avec `Agent!<CODE>`)*

## 📚 Documentation des Endpoints

### 🔐 Authentification

#### Register (Inscription)
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "nom": "Jean Dupont",
  "telephone": "+225701234567",
  "email": "jean@example.com",
  "motDePasse": "SecurePass123"
}
```

**Réponse (201)**:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "b3JhbmdlLW1vbmV5LXNlY3JldC10b2tlbg...",
  "utilisateurId": 1,
  "telephone": "+225701234567",
  "role": "user"
}
```

L'`accessToken` expire vite (15 min). Quand il est refusé (401), rejouer :

```http
POST /api/v1/auth/refresh
{ "refreshToken": "..." }        → nouveau couple accessToken + refreshToken

POST /api/v1/auth/logout
{ "refreshToken": "..." }        → révoque la session courante

POST /api/v1/auth/logout-all     → (Bearer) révoque toutes les sessions
```

#### Login (Connexion)
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "telephone": "+225701234567",
  "motDePasse": "SecurePass123"
}
```

---

### 👥 Utilisateurs

#### Lister tous les utilisateurs
```http
GET /api/v1/utilisateurs?skip=0&take=10
```

#### Récupérer un utilisateur
```http
GET /api/v1/utilisateurs/:id
```

#### Créer un utilisateur
```http
POST /api/v1/utilisateurs
Authorization: Bearer <token>
Content-Type: application/json

{
  "nom": "Marie Durand",
  "telephone": "+225707654321",
  "email": "marie@example.com"
}
```

#### Modifier un utilisateur
```http
PATCH /api/v1/utilisateurs/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "nom": "Marie Durand",
  "email": "marie.new@example.com"
}
```

#### Supprimer un utilisateur
```http
DELETE /api/v1/utilisateurs/:id
Authorization: Bearer <token>
```

---

### 💼 Abonnement plateforme

Une compagnie ne peut **opérer** (créer/modifier trajets & départs, vendre) et
n'apparaît dans la recherche voyageur que si elle est `actif` **et** a un
abonnement `actif` non expiré.

```http
POST  /api/v1/abonnements                      # (admin) { compagnieId, plan, montant, dateDebut, dateFin }
GET   /api/v1/abonnements?compagnieId=1&statut=actif   # (admin)
PATCH /api/v1/abonnements/:id                   # (admin) renouveler : { dateFin, statut, montant }
GET   /api/v1/abonnements/compagnie/:id         # (company_admin) l'abonnement de sa compagnie
```

---

### 🧑‍💼 Agents guichet

Gérés par le `company_admin` de la compagnie (ou l'admin plateforme).
Un agent = `Utilisateur { role: 'agent' }` rattaché à la compagnie.

```http
POST   /api/v1/agents        # créer un agent (compagnieId forcé pour un company_admin)
GET    /api/v1/agents        # lister les agents de sa compagnie
GET    /api/v1/agents/:id
PATCH  /api/v1/agents/:id    # nom / téléphone / email / motDePasse / actif
DELETE /api/v1/agents/:id    # désactive le compte (soft delete, historique préservé)
```

```json
// POST /api/v1/agents
{
  "nom": "Awa Kone",
  "telephone": "+2250700998877",
  "motDePasse": "MotDePasseAgent1",
  "email": "awa.kone@garantis.ci"
}
```

L'agent se connecte ensuite normalement via `POST /auth/login` (téléphone +
mot de passe) et peut vendre au guichet, valider des tickets, etc.

---

### 🏢 Compagnies

#### Lister les compagnies
```http
GET /api/v1/compagnies?skip=0&take=10
```

#### Filtrer par statut
```http
GET /api/v1/compagnies/statut/actif?skip=0&take=10
```

#### Récupérer une compagnie
```http
GET /api/v1/compagnies/:id
```

#### Créer une compagnie
```http
POST /api/v1/compagnies
Authorization: Bearer <token>
Content-Type: application/json

{
  "nom": "Garantis Transport",
  "telephone": "+2250700000000",
  "email": "contact@garantis.ci",
  "logoUrl": "https://...",
  "statut": "en_attente"
}
```

#### Mettre à jour une compagnie
```http
PATCH /api/v1/compagnies/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "statut": "actif",
  "logoUrl": "https://..."
}
```

#### Supprimer une compagnie
```http
DELETE /api/v1/compagnies/:id
Authorization: Bearer <token>
```

---

### 🏙️ Villes

#### Lister les villes
```http
GET /api/v1/villes
```

#### Créer une ville
```http
POST /api/v1/villes
Authorization: Bearer <token>
Content-Type: application/json

{
  "nom": "Yamoussoukro"
}
```

---

### 🛣️ Trajets

#### Lister les trajets
```http
GET /api/v1/trajets?skip=0&take=10
```

#### Trajets d'une compagnie
```http
GET /api/v1/trajets/compagnie/:compagnieId?skip=0&take=10
```

#### Récupérer un trajet
```http
GET /api/v1/trajets/:id
```

#### Créer un trajet
```http
POST /api/v1/trajets
Authorization: Bearer <token>
Content-Type: application/json

{
  "compagnieId": 1,
  "villeDepartId": 1,
  "villeArriveeId": 2,
  "heureDepart": "08:00",
  "heureArriveeEstimee": "16:30",
  "prix": 15000,
  "joursRecurrence": "lun,mar,mer,jeu,ven"
}
```

---

### 🚐 Véhicules & 🧑‍✈️ Chauffeurs (flotte)

Données internes — **aucune route publique**. Lecture : `agent` / `company_admin`
(leur compagnie) + `admin`. Écriture : `company_admin` (sa compagnie) + `admin`.

```http
GET    /api/v1/vehicules            # Bearer — liste filtrée à sa compagnie
GET    /api/v1/vehicules/:id        # Bearer
POST   /api/v1/vehicules            # Bearer (vehicule:manage)
PATCH  /api/v1/vehicules/:id        # Bearer (vehicule:manage)
DELETE /api/v1/vehicules/:id        # Bearer (vehicule:manage)

# Idem pour /api/v1/chauffeurs (chauffeur:manage)
```

```json
// POST /api/v1/vehicules — compagnieId ignoré pour un company_admin (forcé à
// sa compagnie), requis pour l'admin plateforme.
{
  "immatriculation": "CI-1234-AB",
  "typeVehicule": "Autocar 50 places",
  "capacite": 50,
  "statut": "actif"          // actif | maintenance | hors_service
}
```

```json
// POST /api/v1/chauffeurs
{ "nom": "Koffi Yao", "telephone": "+2250700111222", "numeroPermis": "PC-CI-004521" }
```

À l'affectation d'un véhicule / chauffeur à un départ, l'API vérifie qu'il
appartient à la **même compagnie** que le trajet (sinon `400`).

---

### 📅 Départs

#### Lister les départs
```http
GET /api/v1/departs?skip=0&take=10
```

#### Rechercher des départs (voyageur)
```http
GET /api/v1/departs/recherche?depart=Korhogo&arrivee=Abidjan&date=2026-09-10
GET /api/v1/departs/recherche?depart=Korhogo&arrivee=Abidjan&date=2026-09-10&dateFin=2026-09-17
```
Avec `dateFin`, `date` devient le début d'une fourchette. Ne renvoie que les
départs vendables (compagnie opérationnelle, trajet actif, places disponibles).

**Réponse (200)**:
```json
[
  {
    "id": 1,
    "trajet": {
      "id": 1,
      "prix": 15000,
      "heureDepart": "08:00:00",
      "villeDepart": { "nom": "Korhogo" },
      "villeArrivee": { "nom": "Abidjan" },
      "compagnie": { "nom": "Garantis Transport" }
    },
    "dateDepart": "2026-09-10",
    "placesTotales": 50,
    "placesDisponibles": 23,
    "statut": "planifie"
  }
]
```

#### Créer un départ
```http
POST /api/v1/departs
Authorization: Bearer <token>
Content-Type: application/json

{
  "trajetId": 1,
  "dateDepart": "2026-09-10",
  "placesTotales": 50,
  "vehiculeId": 1,
  "chauffeurId": 1
}
```

---

### 🎫 Réservations

#### Créer une réservation (voyageur, en ligne)
```http
POST /api/v1/reservations
Authorization: Bearer <token voyageur>
Content-Type: application/json

{ "departId": 1, "nombrePlaces": 2 }
```
Le voyageur (`utilisateurId`) et le `canal` (`en_ligne`) sont déduits du token.
Transaction atomique — empêche le sur-booking.

#### Créer une réservation au guichet (agent)
```http
POST /api/v1/reservations/guichet
Authorization: Bearer <token agent | company_admin>
Content-Type: application/json

{
  "departId": 1,
  "nombrePlaces": 2,
  "passager": { "nom": "Kone Ali", "telephone": "+2250700112233" },
  "paiementEspece": true
}
```
Le voyageur **n'a pas de compte** : son nom et son téléphone sont notés sur la
réservation (`passagerNom` / `passagerTelephone`, `utilisateurId` = `null`).
`paiementEspece: true` enregistre un paiement `espece` payé dans la même
transaction. L'agent ne peut vendre que pour les départs de sa compagnie.

#### Lister les réservations
```http
GET /api/v1/reservations?skip=0&take=10
```
Voyageur → ses réservations · agent / company_admin → celles de leur compagnie ·
admin → toutes.

#### Récupérer une réservation
```http
GET /api/v1/reservations/:id
```

#### Annuler une réservation
```http
PATCH /api/v1/reservations/:id/annuler
Authorization: Bearer <token>
```
Accessible au voyageur, au personnel de la compagnie du départ, ou à l'admin.
Les places sont libérées. Si la réservation était **payée**, une demande de
remboursement est créée automatiquement, avec des **frais retenus selon le délai
avant le départ** (≥ 3 j : 10 % · 1–2 j : 25 % · jour J : 50 % · départ passé :
aucun remboursement). La compagnie confirme ensuite le décaissement via
`PATCH /api/v1/remboursements/:id/confirmer`.

> Une réservation en ligne non payée sous `RESERVATION_PAIEMENT_TTL_MINUTES`
> (défaut 30 min) passe automatiquement `expiree` et ses places sont libérées.

---

### 💳 Paiements

#### Créer un paiement (voyageur, mobile money)
```http
POST /api/v1/paiements
Authorization: Bearer <token voyageur>
Content-Type: application/json

{ "reservationId": 1, "moyenPaiement": "orange_money", "referenceTransaction": "OM123456" }
```
Le `montant` n'est jamais fourni : recalculé serveur (prix trajet × places).
Le paiement naît `en_attente` ; l'opérateur le confirme par le webhook.

#### Encaisser au guichet (agent)
```http
POST /api/v1/paiements/guichet
Authorization: Bearer <token agent | company_admin>
Content-Type: application/json

{ "reservationId": 1, "moyenPaiement": "wave" }
```
L'agent enregistre un paiement reçu au comptoir (espèces ou transfert confirmé
sur place) → statut `paye` immédiat. Réservé à la compagnie du départ.

#### Confirmer un paiement (webhook opérateur)
```http
PATCH /api/v1/paiements/reservation/:reservationId/confirmer
x-webhook-secret: <PAYMENT_WEBHOOK_SECRET>
```

#### Récupérer un paiement
```http
GET /api/v1/paiements/:id
```

#### Paiement d'une réservation
```http
GET /api/v1/paiements/reservation/:reservationId
```

---

### 🎟️ Tickets

#### Générer un ticket
```http
POST /api/v1/tickets/reservation/:reservationId
Authorization: Bearer <token>
Content-Type: application/json

{
  "siege": "A1"
}
```

**Réponse**: 
```json
{
  "id": 1,
  "codeQr": "550e8400-e29b-41d4-a716-446655440000",
  "statut": "valide"
}
```

#### Valider un ticket (embarquement)
```http
POST /api/v1/tickets/valider/:codeQr
```

#### Lister les tickets
```http
GET /api/v1/tickets?skip=0&take=10
```

#### Tickets d'une réservation
```http
GET /api/v1/tickets/reservation/:reservationId
```

---

### 🛟 Support (demandes d'assistance)

Ouvertes par les voyageurs (app) et le personnel des compagnies (dashboard),
traitées par l'équipe Yègo (admin) ; le company_admin traite aussi les
demandes voyageurs de sa compagnie. Détail des règles : CHANGELOG 0.27.0.

```http
POST  /api/v1/support/demandes            { categorie, sujet, message, reservationId? }
GET   /api/v1/support/demandes            ?statut&categorie&origine&compagnieId&q&skip&take
GET   /api/v1/support/demandes/:id        → demande + messages[]
POST  /api/v1/support/demandes/:id/messages  { contenu, interne? }
PATCH /api/v1/support/demandes/:id        { statut?, priorite? }
GET   /api/v1/support/compteurs           → { ouverte, en_cours }
```

---

### 💰 Remboursements

#### Obtenir un remboursement (voyageur)
Le voyageur annule sa réservation : `PATCH /api/v1/reservations/:id/annuler`
crée la demande de remboursement avec les frais du barème. Impossible une fois
le départ parti ou un ticket utilisé à l'embarquement.

#### Remboursement manuel (gestionnaire / admin)
```http
POST /api/v1/remboursements
Authorization: Bearer <token>
Content-Type: application/json

{
  "reservationId": 1,
  "fraisRetenus": 1500
}
```
Perm `remboursement:confirm` (company_admin de la compagnie ou admin), sur une
réservation **déjà annulée** et payée, sans remboursement existant (ex. geste
commercial quand le barème ne remboursait rien). `montantRembourse` est
toujours calculé par le serveur (montant payé − frais).

#### Lister les remboursements
```http
GET /api/v1/remboursements?skip=0&take=10
```

#### Filtrer par statut
```http
GET /api/v1/remboursements/statut/en_attente?skip=0&take=10
```

#### Confirmer un remboursement
```http
PATCH /api/v1/remboursements/:id/confirmer
Authorization: Bearer <token>
```

---

### 🔔 Notifications push

L'app mobile enregistre son jeton FCM ; le backend notifie le voyageur aux
moments clés (réservation, paiement, annulation, remboursement, rappel de départ
la veille). Le passager d'un guichet sans compte n'est pas notifié.

```http
POST   /api/v1/notifications/appareils      # { "token": "...", "plateforme": "android|ios|web" }
DELETE /api/v1/notifications/appareils      # { "token": "..." }
GET    /api/v1/notifications?nonLu=true     # fil in-app du voyageur
GET    /api/v1/notifications/compteur       # { "nonLues": 3 }
PATCH  /api/v1/notifications/:id/lu
PATCH  /api/v1/notifications/lu             # tout marquer lu
```

Le push part par **Firebase Cloud Messaging** si `FCM_PROJECT_ID` /
`FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY` sont configurés. Sinon, les notifications
restent consultables dans le fil in-app mais ne sont pas poussées. Types :
`reservation.confirmee`, `paiement.confirme`, `reservation.annulee`,
`remboursement.effectue`, `depart.rappel`.

---

## 🔒 Authentification

Tous les endpoints protégés nécessitent un token JWT dans le header:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Créer un token

1. **Register** ou **Login** pour obtenir un token d'accès
2. Ajouter `Authorization: Bearer <token>` à chaque requête

Le token expire après 7 jours (configurable via `JWT_EXPIRES_IN`).

---

## 📊 Schéma de la Base de Données

### Relations principales

```
Utilisateur
├─ Réservations (1:N)
│  ├─ Paiements (1:1)
│  ├─ Tickets (1:N)
│  ├─ Remboursements (1:1)
│  └─ Départs (via departId)

Départs
├─ Trajet (N:1)
│  ├─ Compagnie (N:1)
│  ├─ Ville (Départ)
│  └─ Ville (Arrivée)
├─ Véhicule (N:1)
├─ Chauffeur (N:1)
└─ Réservations (1:N)

Compagnie
├─ Trajectes (1:N)
├─ Abonnements (1:N)
├─ Véhicules (1:N)
├─ Chauffeurs (1:N)
└─ Agents Guichet (1:N)
```

---

## 🛠️ Commandes Utiles

```bash
# Démarrage en développement (watch mode)
npm run start:dev

# Build production
npm run build

# Lancer en production
npm run start:prod

# Linter
npm run lint

# Tests
npm run test

# Prisma Studio (GUI pour la base)
npm run prisma:studio

# Créer une nouvelle migration
npm run prisma:migrate -- --name add_new_field
```

---

## 📝 Variables d'Environnement

Voir `.env.example` pour la liste complète.

```env
DATABASE_URL           # Connexion PostgreSQL
JWT_SECRET             # Clé secrète JWT
JWT_EXPIRES_IN         # Durée du token (ex: "7d")
PORT                   # Port du serveur (défaut: 3000)
NODE_ENV               # "development" ou "production"
CORS_ORIGIN            # URLs autorisées pour CORS
```

---

## 🧪 Tests

```bash
npm test               # tests unitaires (services, guards, helpers)
npm run test:e2e       # tests HTTP de bout en bout (Supertest)
npm run test:cov       # couverture
```

Les tests e2e traversent l'application réelle (guard + pipe + contrôleur +
service). Ils ont besoin d'une base PostgreSQL :

```bash
# base de test dédiée (une fois)
docker compose exec db createdb -U yego yego_test
DATABASE_URL="postgresql://yego:<mdp>@localhost:5434/yego_test" npx prisma migrate deploy

# puis
DATABASE_URL_TEST="postgresql://yego:<mdp>@localhost:5434/yego_test" npm run test:e2e
```

`docker compose down -v` détruit aussi `yego_test` : relancer les deux commandes
ci-dessus après un reset du volume. En CI, le service `postgres` (`yego_test`) et
`DATABASE_URL` sont déjà fournis.

---

## 🐛 Gestion des Erreurs

La réponse d'erreur suit ce format:

```json
{
  "statusCode": 400,
  "message": "Validation échouée: nombrePlaces: must be a positive number",
  "timestamp": "2026-09-01T12:30:45.123Z",
  "path": "/api/v1/reservations",
  "method": "POST"
}
```

### Codes HTTP courants

| Code | Sens |
|------|------|
| 200 | ✅ Succès |
| 201 | ✅ Ressource créée |
| 400 | ❌ Requête invalide |
| 401 | 🔒 Non authentifié |
| 403 | 🚫 Non autorisé |
| 404 | ❌ Ressource non trouvée |
| 409 | ⚠️ Conflit (ex: téléphone existe) |
| 500 | 💥 Erreur serveur |

---

## 📱 Flux de Réservation Complet

```
1. Utilisateur recherche les départs
   GET /api/v1/departs/recherche?...

2. Utilisateur se connecte
   POST /api/v1/auth/login → reçoit token

3. Utilisateur crée une réservation
   POST /api/v1/reservations
   (transaction atomique, places décrémentées)

4. Système crée un paiement
   POST /api/v1/paiements

5. Utilisateur effectue le paiement mobile money
   (webhook de l'opérateur)

6. Système confirme le paiement
   PATCH /api/v1/paiements/reservation/:id/confirmer

7. Système génère le ticket
   POST /api/v1/tickets/reservation/:id

8. À l'embarquement, contrôleur valide le ticket
   POST /api/v1/tickets/valider/:codeQr
```

---

## 🐳 Docker

Le projet fournit un `Dockerfile` multi-stage (build → image runtime `node:20-alpine`
non-root, `tini` comme PID 1) et un `docker-compose.yml` (API + PostgreSQL 16).

### Démarrage complet (API + base)

```bash
cp .env.example .env
# Renseigner au minimum : JWT_SECRET, PAYMENT_WEBHOOK_SECRET, POSTGRES_PASSWORD
#   openssl rand -base64 48   # pour JWT_SECRET

npm run docker:up        # docker compose up -d --build
npm run docker:logs      # suivre les logs de l'API
npm run docker:down      # arrêter
```

- L'API applique automatiquement les migrations Prisma au démarrage
  (`prisma migrate deploy` dans `docker-entrypoint.sh`).
- `SEED_ON_START=true` dans `.env` insère les données de démonstration au premier boot.
- Healthchecks : `GET /api/v1/health` (liveness) et `/api/v1/health/ready` (DB).
- La base n'est **pas** exposée sur l'hôte par défaut (voir `docker-compose.yml`).

### Image seule (Railway / Render / Fly.io)

```bash
docker build -t yego-api .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e JWT_SECRET=... -e PAYMENT_WEBHOOK_SECRET=... \
  -e CORS_ORIGIN=https://app.yego.ci \
  yego-api
```

## 🔒 Sécurité

| Mécanisme | Détail |
|-----------|--------|
| Validation d'environnement | `src/config/env.validation.ts` — l'API refuse de démarrer si `JWT_SECRET` (< 32 car.) ou `PAYMENT_WEBHOOK_SECRET` sont absents/faibles, ou si `CORS_ORIGIN="*"` en production |
| JWT | Access token court (`15m`) ; la stratégie revérifie le compte + `tokenVersion` et relit le rôle à chaque requête |
| Sessions | Refresh tokens hachés (SHA-256) avec rotation et détection de réutilisation ; `logout` / `logout-all` |
| Audit | `audit_logs` : remboursements et validations de tickets tracés (acteur, rôle, IP) ; `GET /api/v1/audit-logs` (admin) |
| RBAC + permissions | 4 rôles + matrice de permissions (`PermissionsGuard` / `@RequirePermissions`) ; agents et gestionnaires **cloisonnés à leur compagnie** (`assertCompagnieScope`) — voir plus bas |
| Mots de passe | `bcrypt`, cost factor 12 |
| Rate limiting | 60 req/min global, 5 req/min sur `/auth/login` et `/auth/register` |
| En-têtes HTTP | `helmet()` |
| Charge utile | Corps de requête limité à 100 kB |
| CORS | Liste blanche explicite ; `credentials` activé uniquement avec une liste d'origines |
| Webhooks paiement | Secret partagé `x-webhook-secret` (`WebhookSecretGuard`), jamais de JWT |
| Arrêt propre | `enableShutdownHooks()` ferme les connexions Prisma sur SIGTERM |

### Rôles & permissions

Quatre rôles (`Utilisateur.role`), portés par le JWT :

| Rôle | Qui | Rattaché à une compagnie |
|------|-----|--------------------------|
| `user` | voyageur | non |
| `agent` | agent de guichet | **oui** (`compagnieId`) |
| `company_admin` | gestionnaire d'une compagnie | **oui** |
| `admin` | administrateur plateforme | non (accès total) |

Le contrôle d'accès se fait par **permissions** (`src/config/permissions.ts`,
`PermissionsGuard` + `@RequirePermissions()`), pas par test de rôle en dur.

| Permission | user | agent | company_admin | admin |
|---|:--:|:--:|:--:|:--:|
| `ville:manage` | | | | ✅ |
| `compagnie:create` / `:delete` / `:moderate` (statut) | | | | ✅ |
| `compagnie:update` (infos) | | | ✅ *(sa compagnie)* | ✅ |
| `trajet:manage` | | | ✅ *(sa compagnie)* | ✅ |
| `depart:manage` | | ✅ *(sa compagnie)* | ✅ *(sa compagnie)* | ✅ |
| `flotte:read` (véhicules / chauffeurs) | | ✅ *(sa compagnie)* | ✅ *(sa compagnie)* | ✅ |
| `vehicule:manage` / `chauffeur:manage` | | | ✅ *(sa compagnie)* | ✅ |
| `reservation:guichet` (vente au comptoir) | | ✅ *(sa compagnie)* | ✅ *(sa compagnie)* | ✅ |
| `agent:manage` (gérer les agents guichet) | | | ✅ *(sa compagnie)* | ✅ |
| `abonnement:read` | | | ✅ *(sa compagnie)* | ✅ |
| `abonnement:manage` (créer / renouveler) | | | | ✅ |
| `ticket:validate` | | ✅ *(sa compagnie)* | ✅ *(sa compagnie)* | ✅ |
| `remboursement:confirm` | | | ✅ *(sa compagnie)* | ✅ |
| `utilisateur:create` (guichet) | | ✅ | ✅ | ✅ |
| `utilisateur:list` / `:set_role` / `audit:read` | | | | ✅ |

*« sa compagnie »* = un contrôle de périmètre (`assertCompagnieScope`) rejette
toute action sur une ressource d'une autre compagnie.

L'inscription publique (`/auth/register`) crée toujours un `user`.

- L'**admin plateforme** attribue les rôles `company_admin` / `admin` :
  ```http
  PATCH /api/v1/utilisateurs/:id/role     (Bearer admin)
  { "role": "company_admin", "compagnieId": 1 }
  ```
- Le **company_admin** gère les **agents guichet** de sa compagnie via `/agents`
  (voir plus bas). Un compte désactivé (`actif: false`) ne peut plus se connecter.

---

## 📞 Support

Pour les questions ou bugs, ouvrir une issue sur GitHub.

---

## 📄 Licence

UNLICENSED - Propriétaire

    departs/        -> occurrences datées d'un trajet + recherche voyageur
    reservations/    -> réservation avec décrément atomique des places
                        (empêche le sur-booking guichet/en ligne)
    tickets/        -> génération et validation des tickets QR
    paiements/      -> paiement mobile money (Orange/MTN/Moov/Wave)
prisma/
  schema.prisma      -> modèle de données complet (13 tables)
```

## Points d'API principaux

| Méthode | Route                                   | Description                              |
|---------|------------------------------------------|-------------------------------------------|
| POST    | `/api/v1/auth/register`                 | Inscription voyageur                       |
| POST    | `/api/v1/auth/login`                    | Connexion, retourne un JWT                 |
| GET     | `/api/v1/departs/recherche`             | Recherche trajet (depart, arrivee, date)   |
| POST    | `/api/v1/reservations`                  | Créer une réservation (en_ligne/guichet)   |
| POST    | `/api/v1/tickets/reservation/:id`       | Générer le ticket QR après paiement        |
| POST    | `/api/v1/tickets/valider/:codeQr`       | Valider un ticket à l'embarquement         |
| POST    | `/api/v1/paiements`                     | Initier un paiement mobile money           |

## À compléter avant la production

- Intégration réelle des API Orange Money / MTN Money / Moov Money / Wave
- Rôles et permissions par type d'utilisateur (voyageur, agent, compagnie, admin)
- Génération de l'image QR code (actuellement seul le code texte est stocké)
- Notifications SMS (rappel de départ, confirmation)
- Tests unitaires et end-to-end

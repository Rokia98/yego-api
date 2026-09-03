# 🏗️ Architecture Yègo API

## Vue d'Ensemble

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT (Web/Mobile)                      │
│                                                              │
│  • Voyageur cherche trajets                                │
│  • Réserve places                                           │
│  • Paie via mobile money                                    │
│  • Récupère ticket QR                                       │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP REST
                       │ JWT Bearer Token
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   NestJS API Gateway                         │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Validation Pipe (class-validator)                    │ │
│  │ JWT Guard (authentication)                           │ │
│  │ Exception Filter (error handling)                    │ │
│  └───────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────────────────┐
        │              │                          │
        ▼              ▼                          ▼
┌─────────────┐ ┌──────────────┐ ┌──────────────────┐
│   Services  │ │  Controllers │ │   Prisma ORM     │
│             │ │              │ │                  │
│ • DTO Mapping│ • Route Handler│ • Query Builder  │
│ • Business  │ • HTTP Response │ • Transactions   │
│   Logic     │                  │                  │
│ • Validations│ (39 Endpoints) │ • Relations      │
└──────┬──────┘ └────────────────┘ └────────┬──────┘
       │                                     │
       └─────────────────┬───────────────────┘
                         │ SQL Queries
                         ▼
                 ┌────────────────────┐
                 │  PostgreSQL DB     │
                 │                    │
                 │  10 Tables:        │
                 │  • Utilisateurs    │
                 │  • Villes          │
                 │  • Compagnies      │
                 │  • Trajets         │
                 │  • Départs         │
                 │  • Réservations    │
                 │  • Paiements       │
                 │  • Tickets         │
                 │  • Remboursements  │
                 │  • Relations       │
                 └────────────────────┘
```

---

## Flux de Requête

### 1️⃣ Requête Entrante
```
Request: POST /api/v1/reservations
Header: Authorization: Bearer eyJhbGc...
Body: {
  "departId": 1,
  "nombrePlaces": 2,
  "utilisateurId": 1,
  "canal": "app"
}
```

### 2️⃣ Middleware NestJS

#### a) ValidationPipe Global
```typescript
// Valide le Body contre CreateReservationDto
// Vérifie les @IsNumber, @IsPositive, etc.
// Jette BadRequestException si invalide
```

#### b) JwtAuthGuard
```typescript
// Extrait le token du header Authorization
// Vérifie la signature JWT
// Decode le payload et ajoute request.user
// Jette UnauthorizedException si invalide
```

### 3️⃣ Controller
```typescript
// reservations.controller.ts
@UseGuards(JwtAuthGuard)
@Post()
create(@Body() dto: CreateReservationDto) {
  return this.reservationsService.create(dto);
  // → Appelle le service
}
```

### 4️⃣ Service (Logique Métier)
```typescript
// reservations.service.ts
create(dto: CreateReservationDto) {
  // 1. Valider que le départ existe
  const depart = await prisma.depart.findUnique({...});
  
  // 2. Vérifier places disponibles
  if (depart.placesDisponibles < dto.nombrePlaces) {
    throw new BadRequestException('Pas assez de places');
  }
  
  // 3. TRANSACTION ATOMIQUE
  await prisma.$transaction(async (tx) => {
    // 3a. Créer réservation
    const reservation = await tx.reservation.create({...});
    
    // 3b. Décrémenter places (anti-sur-booking)
    await tx.depart.update({
      where: { id: dto.departId },
      data: {
        placesDisponibles: {
          decrement: dto.nombrePlaces
        }
      }
    });
    
    return reservation;
  });
  
  // 4. Retourner réservation créée
  return reservation;
}
```

### 5️⃣ Prisma ORM
```typescript
// Génère une requête SQL
SELECT d.* FROM departs d WHERE d.id = $1;

BEGIN TRANSACTION;
  INSERT INTO reservations (...) VALUES (...) RETURNING *;
  UPDATE departs SET places_disponibles = places_disponibles - $1 WHERE id = $2;
COMMIT;
```

### 6️⃣ PostgreSQL
```sql
-- Exécute les requêtes
-- Retourne les résultats
-- Enregistre dans la DB
```

### 7️⃣ Réponse
```json
HTTP 201 Created
{
  "id": 5,
  "departId": 1,
  "utilisateurId": 1,
  "nombrePlaces": 2,
  "canal": "app",
  "statut": "confirmee",
  "createdAt": "2026-09-01T12:30:00Z"
}
```

---

## Schéma des Relations

### Modèle Entité-Relation (Simplifié)

```
┌──────────────────┐        ┌──────────────────┐
│   Utilisateur    │        │      Villes      │
├──────────────────┤        ├──────────────────┤
│ id (PK)          │        │ id (PK)          │
│ nom              │        │ nom (UNIQUE)     │
│ telephone        │        │ latitude         │
│ email            │        │ longitude        │
│ motDePasse       │        └──────────────────┘
└────────┬─────────┘               ▲ ▲
         │                         │ │
         │ 1:N (Réservations)      │ │ (villeDepart, villeArrivee)
         │                         │ │
         ▼                         │ │
┌──────────────────────────┐      │ │
│    Réservation           │      │ │
├──────────────────────────┤      │ │
│ id (PK)                  │      │ │
│ departId (FK) ──┬────────┼──────┘ │
│ utilisateurId   │        │        │
│ nombrePlaces    │        │        │
│ statut          │        │        │
└────────┬────────┘        │        │
         │                 │        │
         │ 1:1             │        │
         ▼                 │        │
    ┌─────────────┐        │        │
    │  Paiement   │        │        │
    ├─────────────┤        │        │
    │ id (PK)     │        │        │
    │ montant     │        │        │
    │ statut      │        │        │
    └─────────────┘        │        │
                           │        │
                           ▼        │
                    ┌──────────────┐│
                    │   Départ     ││
                    ├──────────────┤│
                    │ id (PK)      ││
                    │ trajetId (FK)┼┤
                    │ dateDepart   ││
                    │ placesTotales││
                    │ places...    ││
                    └──────┬───────┘│
                           │        │
                           │ N:1    │
                           │        │
                           ▼        │
                    ┌──────────────┐│
                    │   Trajet     ││
                    ├──────────────┤│
                    │ id (PK)      ││
                    │ compagnieId  ││
                    │ villeDepart  ├┴─────────┘
                    │   (FK) ──────┤
                    │ villeArrivee │
                    │   (FK) ──────┘
                    │ prix         │
                    └──────┬───────┘
                           │
                           │ N:1
                           │
                           ▼
                    ┌──────────────┐
                    │  Compagnie   │
                    ├──────────────┤
                    │ id (PK)      │
                    │ nom          │
                    │ email        │
                    │ statut       │
                    └──────────────┘
```

---

## Flux Métier Complet

### 📍 Étape 1: Recherche de Trajets

```
Client: GET /api/v1/departs/recherche?depart=Korhogo&arrivee=Abidjan&date=2026-09-10

Service Flow:
  1. Chercher les villes par nom (case-insensitive)
  2. Trouver tous les trajets entre ces villes
  3. Lister les départs pour cette date
  4. Retourner ceux avec places disponibles > 0
  
Response:
  [
    {
      "id": 1,
      "trajet": {
        "prix": 15000,
        "compagnie": { "nom": "Garantis" }
      },
      "placesDisponibles": 23
    }
  ]
```

### 💳 Étape 2: Réservation

```
Client: POST /api/v1/reservations
  Body: { departId: 1, nombrePlaces: 2, utilisateurId: 1 }

Service Flow:
  1. Vérifier que le départ existe et a assez de places
  2. Créer la réservation (statut: confirmee)
  3. TRANSACTIONNELLEMENT:
     a. INSERT INTO reservations
     b. UPDATE departs SET places_disponibles = places_disponibles - 2
  4. Retourner réservation créée

Database State Change:
  departs.places_disponibles: 25 → 23 ✅ (Atomique = sans sur-booking)
```

### 💰 Étape 3: Paiement

```
Client: POST /api/v1/paiements
  Body: { reservationId: 1, montant: 30000, ... }

Service Flow:
  1. Vérifier que la réservation existe
  2. Créer le paiement (statut: en_attente)
  3. Envoyer requête à l'opérateur mobile money (async)
  
Client (externe): 
  Opérateur mobile money détecte paiement →
  Envoie webhook: PATCH /api/v1/paiements/reservation/1/confirmer
  
Service Flow (webhook):
  1. Trouver le paiement
  2. Mettre à jour statut: en_attente → paye
  3. Enregistrer datePaiement: now()
```

### 🎟️ Étape 4: Génération Ticket

```
Client: POST /api/v1/tickets/reservation/1
  Body: { "siege": "A1" }

Service Flow:
  1. Trouver la réservation
  2. Générer UUID unique (codeQr)
  3. Créer le ticket (statut: valide)
  4. Retourner codeQr (à imprimer ou afficher)

Response:
  {
    "id": 1,
    "codeQr": "550e8400-e29b-41d4-a716-446655440000",
    "siege": "A1"
  }
```

### ✅ Étape 5: Validation à l'Embarquement

```
Agent gare: POST /api/v1/tickets/valider/550e8400-e29b-41d4-a716-446655440000

Service Flow:
  1. Chercher le ticket par codeQr
  2. Vérifier statut = valide (pas déjà utilisé/annulé)
  3. Mettre à jour statut: valide → utilise
  4. Retourner succès

Response: { "success": true, "passager": "Jean Dupont", "siege": "A1" }
```

### 🔄 Étape 6: Annulation & Remboursement

```
Client: PATCH /api/v1/reservations/1/annuler

Service Flow:
  1. Vérifier que la réservation existe et est confirmee
  2. TRANSACTIONNELLEMENT:
     a. UPDATE reservations SET statut = annulee
     b. UPDATE departs SET places_disponibles = places_disponibles + 2
  3. Optionnellement:
     a. Créer un remboursement
     b. Confirmer le remboursement
     c. Transférer montant via mobile money

Database Result:
  reservations.statut: confirmee → annulee ✅
  departs.places_disponibles: 23 → 25 ✅ (Places libérées)
```

---

## Sécurité: Couches de Protection

### Layer 1: Transport
```
✅ HTTPS en production
✅ CORS configuré
```

### Layer 2: Authentification
```
POST /api/v1/auth/login
  → Vérifie email + motDePasse
  → Génère JWT (valide 7 jours)
  → Retourne token

Chaque requête protégée:
  Authorization: Bearer <token>
  → JwtAuthGuard extrait & vérifie
  → Ajoute request.user avec payload
  → Ou jette UnauthorizedException
```

### Layer 3: Autorisation
```
GET /api/v1/reservations (public)
POST /api/v1/reservations (JWT requis)
DELETE /api/v1/reservations/:id (JWT + AdminGuard optionnel)
```

### Layer 4: Validation Input
```
POST /api/v1/paiements
Body: {
  montant: "pas un nombre" ← Rejected
  reservationId: -5 ← Rejected (must be positive)
  moyenPaiement: "unknown_provider" ← Rejected
}

ValidationPipe → BadRequestException 400
```

### Layer 5: Contraintes Base de Données
```
-- Unique constraints
ALTER TABLE villes ADD UNIQUE(nom);
ALTER TABLE utilisateurs ADD UNIQUE(telephone);
ALTER TABLE utilisateurs ADD UNIQUE(email);

-- Foreign keys
ALTER TABLE reservations ADD FOREIGN KEY (departId) REFERENCES departs(id);
ALTER TABLE reservations ADD FOREIGN KEY (utilisateurId) REFERENCES utilisateurs(id);

-- Check constraints
ALTER TABLE paiements ADD CHECK(montant > 0);
ALTER TABLE departs ADD CHECK(places_disponibles >= 0);
```

---

## Patterns Utilisés

### 1. Singleton Pattern
```typescript
// PrismaService = instance unique pour toute l'app
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService]
})
```

### 2. Dependency Injection
```typescript
constructor(private prisma: PrismaService) {}
// NestJS instancie et injecte automatiquement
```

### 3. Guard Pattern
```typescript
@UseGuards(JwtAuthGuard)
@Post()
create(@Body() dto: CreateDto) { ... }
// Valide avant d'exécuter
```

### 4. Pipe Pattern
```typescript
new ValidationPipe({ whitelist: true })
// Transforme et valide les données
```

### 5. Filter Pattern
```typescript
app.useGlobalFilters(new AllExceptionsFilter())
// Capture toutes les exceptions
```

### 6. DTO Pattern
```typescript
class CreateReservationDto {
  @IsNumber() departId: number;
  @IsPositive() nombrePlaces: number;
}
// Type-safe + validation
```

### 7. Service Pattern
```typescript
// Controllers → Services → Repository (Prisma)
// Séparation des responsabilités
```

### 8. Transaction Pattern
```typescript
await prisma.$transaction(async (tx) => {
  // Atomique: tout réussit ou tout échoue
});
```

---

## Performance Considerations

### Pagination
```typescript
// Tous les list endpoints supportent skip/take
GET /api/v1/utilisateurs?skip=0&take=10
→ SELECT * FROM utilisateurs LIMIT 10 OFFSET 0;

// Optimise pour grandes tables
```

### Relations Eager Loading
```typescript
// Services incluent les relations nécessaires
await this.prisma.depart.findOne({
  include: {
    trajet: { include: { villeDepart, villeArrivee } },
    reservations: true
  }
});
```

### Indexes (À Ajouter en Production)
```sql
CREATE INDEX idx_departs_date ON departs(date_depart);
CREATE INDEX idx_reservations_utilisateur ON reservations(utilisateur_id);
CREATE INDEX idx_tickets_codeqr ON tickets(code_qr);
CREATE INDEX idx_paiements_reservation ON paiements(reservation_id);
```

---

## Erreurs Gérées

### BadRequestException (400)
```json
{
  "statusCode": 400,
  "message": "nombrePlaces must be a positive number"
}
```

### UnauthorizedException (401)
```json
{
  "statusCode": 401,
  "message": "Token invalide ou expiré"
}
```

### ForbiddenException (403)
```json
{
  "statusCode": 403,
  "message": "Seuls les administrateurs..."
}
```

### NotFoundException (404)
```json
{
  "statusCode": 404,
  "message": "Réservation #123 non trouvée"
}
```

### ConflictException (409)
```json
{
  "statusCode": 409,
  "message": "Email déjà utilisé"
}
```

---

**Version**: 1.0  
**Updated**: 2026-09-01

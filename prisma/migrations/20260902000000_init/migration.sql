-- CreateTable
CREATE TABLE "villes" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,

    CONSTRAINT "villes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compagnies" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "email" TEXT,
    "logo_url" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'en_attente',
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compagnies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abonnements" (
    "id" SERIAL NOT NULL,
    "compagnie_id" INTEGER NOT NULL,
    "plan" TEXT NOT NULL,
    "montant" DECIMAL(10,2) NOT NULL,
    "date_debut" TIMESTAMP(3) NOT NULL,
    "date_fin" TIMESTAMP(3) NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'actif',

    CONSTRAINT "abonnements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicules" (
    "id" SERIAL NOT NULL,
    "compagnie_id" INTEGER NOT NULL,
    "immatriculation" TEXT NOT NULL,
    "type_vehicule" TEXT,
    "capacite" INTEGER NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'actif',

    CONSTRAINT "vehicules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chauffeurs" (
    "id" SERIAL NOT NULL,
    "compagnie_id" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "numero_permis" TEXT,

    CONSTRAINT "chauffeurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents_guichet" (
    "id" SERIAL NOT NULL,
    "compagnie_id" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "identifiant" TEXT NOT NULL,
    "mot_de_passe_hash" TEXT NOT NULL,

    CONSTRAINT "agents_guichet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trajets" (
    "id" SERIAL NOT NULL,
    "compagnie_id" INTEGER NOT NULL,
    "ville_depart_id" INTEGER NOT NULL,
    "ville_arrivee_id" INTEGER NOT NULL,
    "heure_depart" TIME NOT NULL,
    "heure_arrivee_estimee" TIME,
    "prix" DECIMAL(10,2) NOT NULL,
    "jours_recurrence" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'actif',

    CONSTRAINT "trajets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departs" (
    "id" SERIAL NOT NULL,
    "trajet_id" INTEGER NOT NULL,
    "vehicule_id" INTEGER,
    "chauffeur_id" INTEGER,
    "date_depart" DATE NOT NULL,
    "places_totales" INTEGER NOT NULL,
    "places_disponibles" INTEGER NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'planifie',

    CONSTRAINT "departs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utilisateurs" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "email" TEXT,
    "mot_de_passe_hash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "utilisateurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" SERIAL NOT NULL,
    "utilisateur_id" INTEGER,
    "agent_guichet_id" INTEGER,
    "depart_id" INTEGER NOT NULL,
    "nombre_places" INTEGER NOT NULL,
    "canal" TEXT NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'confirmee',
    "date_reservation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" SERIAL NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "code_qr" TEXT NOT NULL,
    "siege" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'valide',
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paiements" (
    "id" SERIAL NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "montant" DECIMAL(10,2) NOT NULL,
    "moyen_paiement" TEXT NOT NULL,
    "reference_transaction" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'en_attente',
    "date_paiement" TIMESTAMP(3),

    CONSTRAINT "paiements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remboursements" (
    "id" SERIAL NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "montant_rembourse" DECIMAL(10,2) NOT NULL,
    "frais_retenus" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "statut" TEXT NOT NULL DEFAULT 'en_attente',
    "date_demande" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_remboursement" TIMESTAMP(3),

    CONSTRAINT "remboursements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "villes_nom_key" ON "villes"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "vehicules_immatriculation_key" ON "vehicules"("immatriculation");

-- CreateIndex
CREATE UNIQUE INDEX "agents_guichet_identifiant_key" ON "agents_guichet"("identifiant");

-- CreateIndex
CREATE INDEX "departs_date_depart_idx" ON "departs"("date_depart");

-- CreateIndex
CREATE UNIQUE INDEX "departs_trajet_id_date_depart_key" ON "departs"("trajet_id", "date_depart");

-- CreateIndex
CREATE UNIQUE INDEX "utilisateurs_telephone_key" ON "utilisateurs"("telephone");

-- CreateIndex
CREATE INDEX "utilisateurs_email_idx" ON "utilisateurs"("email");

-- CreateIndex
CREATE INDEX "reservations_utilisateur_id_idx" ON "reservations"("utilisateur_id");

-- CreateIndex
CREATE INDEX "reservations_depart_id_idx" ON "reservations"("depart_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_code_qr_key" ON "tickets"("code_qr");

-- CreateIndex
CREATE UNIQUE INDEX "paiements_reservation_id_key" ON "paiements"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "remboursements_reservation_id_key" ON "remboursements"("reservation_id");

-- AddForeignKey
ALTER TABLE "abonnements" ADD CONSTRAINT "abonnements_compagnie_id_fkey" FOREIGN KEY ("compagnie_id") REFERENCES "compagnies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicules" ADD CONSTRAINT "vehicules_compagnie_id_fkey" FOREIGN KEY ("compagnie_id") REFERENCES "compagnies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chauffeurs" ADD CONSTRAINT "chauffeurs_compagnie_id_fkey" FOREIGN KEY ("compagnie_id") REFERENCES "compagnies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_guichet" ADD CONSTRAINT "agents_guichet_compagnie_id_fkey" FOREIGN KEY ("compagnie_id") REFERENCES "compagnies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trajets" ADD CONSTRAINT "trajets_compagnie_id_fkey" FOREIGN KEY ("compagnie_id") REFERENCES "compagnies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trajets" ADD CONSTRAINT "trajets_ville_depart_id_fkey" FOREIGN KEY ("ville_depart_id") REFERENCES "villes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trajets" ADD CONSTRAINT "trajets_ville_arrivee_id_fkey" FOREIGN KEY ("ville_arrivee_id") REFERENCES "villes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departs" ADD CONSTRAINT "departs_trajet_id_fkey" FOREIGN KEY ("trajet_id") REFERENCES "trajets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departs" ADD CONSTRAINT "departs_vehicule_id_fkey" FOREIGN KEY ("vehicule_id") REFERENCES "vehicules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departs" ADD CONSTRAINT "departs_chauffeur_id_fkey" FOREIGN KEY ("chauffeur_id") REFERENCES "chauffeurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_agent_guichet_id_fkey" FOREIGN KEY ("agent_guichet_id") REFERENCES "agents_guichet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_depart_id_fkey" FOREIGN KEY ("depart_id") REFERENCES "departs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remboursements" ADD CONSTRAINT "remboursements_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


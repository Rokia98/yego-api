-- CreateTable
CREATE TABLE "demandes_reversement" (
    "id" SERIAL NOT NULL,
    "compagnie_id" INTEGER NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'en_attente',
    "montant_net_estime" DECIMAL(12,2) NOT NULL,
    "commentaire" TEXT,
    "motif_rejet" TEXT,
    "demande_par_id" INTEGER,
    "traite_par_id" INTEGER,
    "reversement_id" INTEGER,
    "date_demande" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_traitement" TIMESTAMP(3),

    CONSTRAINT "demandes_reversement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retraits_plateforme" (
    "id" SERIAL NOT NULL,
    "montant" DECIMAL(12,2) NOT NULL,
    "moyen" TEXT NOT NULL,
    "beneficiaire" TEXT NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'en_cours',
    "jeko_transfer_id" TEXT,
    "jeko_reference" TEXT,
    "frais_jeko" DECIMAL(12,2),
    "motif_echec" TEXT,
    "cree_par_id" INTEGER,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_effectue" TIMESTAMP(3),

    CONSTRAINT "retraits_plateforme_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "demandes_reversement_reversement_id_key" ON "demandes_reversement"("reversement_id");

-- CreateIndex
CREATE INDEX "demandes_reversement_compagnie_id_statut_idx" ON "demandes_reversement"("compagnie_id", "statut");

-- CreateIndex
CREATE UNIQUE INDEX "retraits_plateforme_jeko_transfer_id_key" ON "retraits_plateforme"("jeko_transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "retraits_plateforme_jeko_reference_key" ON "retraits_plateforme"("jeko_reference");

-- AddForeignKey
ALTER TABLE "demandes_reversement" ADD CONSTRAINT "demandes_reversement_compagnie_id_fkey" FOREIGN KEY ("compagnie_id") REFERENCES "compagnies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demandes_reversement" ADD CONSTRAINT "demandes_reversement_reversement_id_fkey" FOREIGN KEY ("reversement_id") REFERENCES "reversements"("id") ON DELETE SET NULL ON UPDATE CASCADE;


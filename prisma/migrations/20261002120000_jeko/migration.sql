-- Intégration Jèko : paiement en ligne, remboursement et reversement par transfert.

-- AlterTable
ALTER TABLE "compagnies" ADD COLUMN "reversement_moyen" TEXT,
ADD COLUMN "reversement_telephone" TEXT,
ADD COLUMN "jeko_contact_id" TEXT;

-- AlterTable
ALTER TABLE "paiements" ADD COLUMN "jeko_payment_request_id" TEXT,
ADD COLUMN "jeko_reference" TEXT,
ADD COLUMN "jeko_tentatives" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "jeko_demande_le" TIMESTAMP(3),
ADD COLUMN "url_paiement" TEXT,
ADD COLUMN "telephone_payeur" TEXT,
ADD COLUMN "reversement_id" INTEGER;

-- AlterTable
ALTER TABLE "remboursements" ADD COLUMN "jeko_transfer_id" TEXT,
ADD COLUMN "jeko_reference" TEXT,
ADD COLUMN "jeko_tentatives" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "motif_echec" TEXT;

-- CreateTable
CREATE TABLE "reversements" (
    "id" SERIAL NOT NULL,
    "compagnie_id" INTEGER NOT NULL,
    "montant_brut" DECIMAL(12,2) NOT NULL,
    "commission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "montant_net" DECIMAL(12,2) NOT NULL,
    "nombre_paiements" INTEGER NOT NULL,
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

    CONSTRAINT "reversements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "paiements_jeko_payment_request_id_key" ON "paiements"("jeko_payment_request_id");

-- CreateIndex
CREATE INDEX "paiements_reversement_id_idx" ON "paiements"("reversement_id");

-- CreateIndex
CREATE UNIQUE INDEX "remboursements_jeko_transfer_id_key" ON "remboursements"("jeko_transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "reversements_jeko_transfer_id_key" ON "reversements"("jeko_transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "reversements_jeko_reference_key" ON "reversements"("jeko_reference");

-- CreateIndex
CREATE INDEX "reversements_compagnie_id_idx" ON "reversements"("compagnie_id");

-- AddForeignKey
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_reversement_id_fkey" FOREIGN KEY ("reversement_id") REFERENCES "reversements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reversements" ADD CONSTRAINT "reversements_compagnie_id_fkey" FOREIGN KEY ("compagnie_id") REFERENCES "compagnies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

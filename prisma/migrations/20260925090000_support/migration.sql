-- CreateTable
CREATE TABLE "demandes_support" (
    "id" SERIAL NOT NULL,
    "auteur_id" INTEGER NOT NULL,
    "auteur_role" TEXT NOT NULL,
    "compagnie_id" INTEGER,
    "reservation_id" INTEGER,
    "categorie" TEXT NOT NULL,
    "sujet" TEXT NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'ouverte',
    "priorite" TEXT NOT NULL DEFAULT 'normale',
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_maj" TIMESTAMP(3) NOT NULL,
    "dernier_message_a" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nb_messages" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "demandes_support_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages_support" (
    "id" SERIAL NOT NULL,
    "demande_id" INTEGER NOT NULL,
    "auteur_id" INTEGER,
    "auteur_role" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "interne" BOOLEAN NOT NULL DEFAULT false,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_support_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "demandes_support_auteur_id_idx" ON "demandes_support"("auteur_id");

-- CreateIndex
CREATE INDEX "demandes_support_compagnie_id_idx" ON "demandes_support"("compagnie_id");

-- CreateIndex
CREATE INDEX "demandes_support_statut_idx" ON "demandes_support"("statut");

-- CreateIndex
CREATE INDEX "demandes_support_dernier_message_a_idx" ON "demandes_support"("dernier_message_a");

-- CreateIndex
CREATE INDEX "messages_support_demande_id_date_creation_idx" ON "messages_support"("demande_id", "date_creation");

-- AddForeignKey
ALTER TABLE "demandes_support" ADD CONSTRAINT "demandes_support_auteur_id_fkey" FOREIGN KEY ("auteur_id") REFERENCES "utilisateurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demandes_support" ADD CONSTRAINT "demandes_support_compagnie_id_fkey" FOREIGN KEY ("compagnie_id") REFERENCES "compagnies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demandes_support" ADD CONSTRAINT "demandes_support_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages_support" ADD CONSTRAINT "messages_support_demande_id_fkey" FOREIGN KEY ("demande_id") REFERENCES "demandes_support"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages_support" ADD CONSTRAINT "messages_support_auteur_id_fkey" FOREIGN KEY ("auteur_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;


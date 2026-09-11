-- Documents d'inscription d'une compagnie (registre de commerce, autorisation
-- de transport, pièce d'identité du gérant…), à valider par l'admin.

CREATE TABLE "compagnie_documents" (
    "id" SERIAL NOT NULL,
    "compagnie_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "nom_fichier" TEXT NOT NULL,
    "chemin_fichier" TEXT NOT NULL,
    "taille_octets" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'en_attente',
    "commentaire_admin" TEXT,
    "date_upload" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_revue" TIMESTAMP(3),

    CONSTRAINT "compagnie_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "compagnie_documents_compagnie_id_idx" ON "compagnie_documents"("compagnie_id");

ALTER TABLE "compagnie_documents" ADD CONSTRAINT "compagnie_documents_compagnie_id_fkey" FOREIGN KEY ("compagnie_id") REFERENCES "compagnies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

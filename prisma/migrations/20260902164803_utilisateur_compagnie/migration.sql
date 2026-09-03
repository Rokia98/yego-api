-- AlterTable
ALTER TABLE "utilisateurs" ADD COLUMN     "compagnie_id" INTEGER;

-- CreateIndex
CREATE INDEX "utilisateurs_compagnie_id_idx" ON "utilisateurs"("compagnie_id");

-- AddForeignKey
ALTER TABLE "utilisateurs" ADD CONSTRAINT "utilisateurs_compagnie_id_fkey" FOREIGN KEY ("compagnie_id") REFERENCES "compagnies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Suivi GPS temps réel des départs.

-- AlterTable : coordonnées des villes (ETA).
ALTER TABLE "villes"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION;

-- AlterTable : cycle de vie et retard d'un départ.
ALTER TABLE "departs"
  ADD COLUMN "demarre_a" TIMESTAMP(3),
  ADD COLUMN "termine_a" TIMESTAMP(3),
  ADD COLUMN "retard_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retard_notifie_minutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "positions_depart" (
    "id" SERIAL NOT NULL,
    "depart_id" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "vitesse" DOUBLE PRECISION,
    "cap" DOUBLE PRECISION,
    "precision" DOUBLE PRECISION,
    "mesure_a" TIMESTAMP(3) NOT NULL,
    "enregistre_a" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "positions_depart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "positions_depart_depart_id_mesure_a_idx" ON "positions_depart"("depart_id", "mesure_a");

-- AddForeignKey
ALTER TABLE "positions_depart" ADD CONSTRAINT "positions_depart_depart_id_fkey" FOREIGN KEY ("depart_id") REFERENCES "departs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sièges choisis par le voyageur avant paiement (un par place).
ALTER TABLE "reservations"
  ADD COLUMN "sieges" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

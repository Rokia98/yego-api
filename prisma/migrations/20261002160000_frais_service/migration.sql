-- Frais de service Yègo sur les achats en ligne (payés en plus du prix du billet).
ALTER TABLE "paiements" ADD COLUMN "frais_service" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Délai de sécurité après un changement de compte de reversement par la compagnie.
ALTER TABLE "compagnies" ADD COLUMN "reversement_coordonnees_modifiees_le" TIMESTAMP(3);

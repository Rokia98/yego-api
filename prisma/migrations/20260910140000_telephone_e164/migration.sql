-- Normalisation des numéros de compte au format E.164 (`+225XXXXXXXXXX`).
-- Les DTO normalisent désormais toute saisie ; on aligne les comptes existants
-- stockés au format local nu (10 chiffres commençant par 0), comme le fait
-- `normaliserTelephone()`. Les numéros déjà en `+…` ou d'une autre forme sont
-- laissés tels quels.
UPDATE "utilisateurs"
SET "telephone" = '+225' || "telephone"
WHERE "telephone" NOT LIKE '+%'
  AND "telephone" ~ '^0[0-9]{9}$';

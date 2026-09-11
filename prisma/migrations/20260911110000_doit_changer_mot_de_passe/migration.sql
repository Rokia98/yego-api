-- Flag "doit changer son mot de passe" : posé par POST /compagnies/:id/
-- compte-admin (mot de passe généré par un tiers), levé par PATCH /auth/
-- mot-de-passe. Sans rapport avec le champ de réponse `motDePasseTemporaire`
-- (le mot de passe en clair renvoyé une seule fois par cette même route).
ALTER TABLE "utilisateurs" ADD COLUMN "doit_changer_mot_de_passe" BOOLEAN NOT NULL DEFAULT false;

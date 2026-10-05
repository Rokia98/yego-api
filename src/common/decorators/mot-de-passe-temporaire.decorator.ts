import { SetMetadata } from '@nestjs/common';

export const AUTORISE_MDP_TEMPORAIRE = 'autoriseMotDePasseTemporaire';

// Route accessible à un compte dont le mot de passe est encore temporaire
// (changement de mot de passe, déconnexion, lecture du profil). Toutes les
// autres routes protégées par JwtAuthGuard renvoient alors 403.
export const AutoriseMotDePasseTemporaire = () =>
  SetMetadata(AUTORISE_MDP_TEMPORAIRE, true);

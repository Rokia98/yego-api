import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Stockage disque des fichiers uploadés (documents de compagnie…).
 *
 * En conteneur : `UPLOADS_DIR` pointe vers un volume Docker dédié (voir
 * docker-compose.yml), pour survivre aux redéploiements. En dev local, un
 * dossier `./uploads` à la racine du projet (ignoré par git).
 *
 * Le chemin absolu retourné par `dossierCompagnie` n'est JAMAIS renvoyé tel
 * quel au client — seules les métadonnées (id, nom, type…) le sont ; le
 * fichier se télécharge via une route API qui vérifie l'accès puis diffuse
 * le contenu (voir modules/documents).
 */

export function racineUploads(): string {
  return resolve(process.env.UPLOADS_DIR || './uploads');
}

export function dossierCompagnie(compagnieId: number): string {
  const dir = join(racineUploads(), 'compagnies', String(compagnieId));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Best-effort : une suppression de fichier ratée ne doit pas faire échouer l'action. */
export function supprimerFichier(cheminAbsolu: string): void {
  try {
    if (existsSync(cheminAbsolu)) unlinkSync(cheminAbsolu);
  } catch {
    // ignoré volontairement
  }
}

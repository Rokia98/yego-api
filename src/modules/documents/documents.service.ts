import { randomUUID } from 'crypto';
import { createReadStream, existsSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { assertCompagnieScope } from '../../common/scope';
import { dossierCompagnie, supprimerFichier } from '../../common/stockage-fichiers';
import { DOCUMENTS } from '../../config/constants';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { RevueDocumentDto } from './dto/revue-document.dto';

// Métadonnées exposées au client : jamais `cheminFichier` (chemin serveur).
const DOCUMENT_SELECT = {
  id: true,
  compagnieId: true,
  type: true,
  nomFichier: true,
  tailleOctets: true,
  mimeType: true,
  statut: true,
  commentaireAdmin: true,
  dateUpload: true,
  dateRevue: true,
};

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  // Upload : company_admin de la compagnie, ou admin (perm compagnie:update,
  // portée vérifiée ici avant tout accès disque — pas de fichier orphelin sur
  // un 403). Le fichier est buffé en mémoire par multer (memoryStorage), écrit
  // sur disque seulement une fois l'accès confirmé.
  async upload(
    compagnieId: number,
    user: AuthenticatedUser,
    type: string,
    file: Express.Multer.File | undefined,
  ) {
    await this.assertCompagnieExiste(compagnieId);
    assertCompagnieScope(user, compagnieId);

    if (!file) {
      throw new BadRequestException('Aucun fichier reçu (champ "document")');
    }
    if (!(DOCUMENTS.MIME_AUTORISES as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestException(
        `Type de fichier non autorisé (${file.mimetype}) — PDF, PNG ou JPEG uniquement`,
      );
    }
    if (file.size > DOCUMENTS.TAILLE_MAX_OCTETS) {
      throw new BadRequestException(
        `Fichier trop volumineux (max ${DOCUMENTS.TAILLE_MAX_OCTETS / (1024 * 1024)} Mo)`,
      );
    }

    const dossier = dossierCompagnie(compagnieId);
    const nomStockage = `${randomUUID()}${extname(file.originalname).toLowerCase()}`;
    const cheminFichier = join(dossier, nomStockage);
    writeFileSync(cheminFichier, file.buffer);

    return this.prisma.compagnieDocument.create({
      data: {
        compagnieId,
        type,
        nomFichier: file.originalname.slice(0, 200) || nomStockage,
        cheminFichier,
        tailleOctets: file.size,
        mimeType: file.mimetype,
      },
      select: DOCUMENT_SELECT,
    });
  }

  async findAllPourCompagnie(compagnieId: number, user: AuthenticatedUser) {
    await this.assertCompagnieExiste(compagnieId);
    assertCompagnieScope(user, compagnieId);
    return this.prisma.compagnieDocument.findMany({
      where: { compagnieId },
      select: DOCUMENT_SELECT,
      orderBy: { dateUpload: 'desc' },
    });
  }

  // Décision admin (validé / refusé) : perm compagnie:moderate côté contrôleur
  // (admin uniquement, cf. matrice des permissions).
  async revoir(compagnieId: number, docId: number, dto: RevueDocumentDto) {
    const doc = await this.trouverPourCompagnie(compagnieId, docId);
    return this.prisma.compagnieDocument.update({
      where: { id: doc.id },
      data: {
        statut: dto.statut,
        commentaireAdmin: dto.commentaireAdmin ?? null,
        dateRevue: new Date(),
      },
      select: DOCUMENT_SELECT,
    });
  }

  async supprimer(compagnieId: number, docId: number, user: AuthenticatedUser) {
    await this.assertCompagnieExiste(compagnieId);
    assertCompagnieScope(user, compagnieId);
    const doc = await this.trouverPourCompagnie(compagnieId, docId);
    await this.prisma.compagnieDocument.delete({ where: { id: doc.id } });
    supprimerFichier(doc.cheminFichier);
    return { message: 'Document supprimé' };
  }

  // Flux du fichier pour téléchargement/aperçu — le contrôleur pipe le stream
  // dans la réponse. N'expose jamais le chemin disque, seulement le contenu.
  async flux(compagnieId: number, docId: number, user: AuthenticatedUser) {
    await this.assertCompagnieExiste(compagnieId);
    assertCompagnieScope(user, compagnieId);
    const doc = await this.trouverPourCompagnie(compagnieId, docId);
    if (!existsSync(doc.cheminFichier)) {
      throw new NotFoundException('Fichier introuvable sur le serveur');
    }
    return {
      stream: createReadStream(doc.cheminFichier),
      mimeType: doc.mimeType,
      nomFichier: doc.nomFichier,
    };
  }

  private async assertCompagnieExiste(compagnieId: number) {
    const c = await this.prisma.compagnie.findUnique({
      where: { id: compagnieId },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Compagnie introuvable');
  }

  // Ligne complète (avec cheminFichier) réservée à l'usage interne du service ;
  // 404 si le document n'existe pas OU n'appartient pas à cette compagnie
  // (évite de laisser deviner l'existence d'un document d'une autre compagnie).
  private async trouverPourCompagnie(compagnieId: number, docId: number) {
    const doc = await this.prisma.compagnieDocument.findUnique({
      where: { id: docId },
    });
    if (!doc || doc.compagnieId !== compagnieId) {
      throw new NotFoundException('Document introuvable');
    }
    return doc;
  }
}

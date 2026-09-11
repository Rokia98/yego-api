import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../config/permissions';
import { DOCUMENTS } from '../../config/constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { RevueDocumentDto } from './dto/revue-document.dto';

// Monté sous /compagnies/:compagnieId/documents — pièces d'inscription
// (registre de commerce, autorisation de transport, pièce d'identité…).
@Controller('compagnies/:compagnieId/documents')
export class DocumentsController {
  constructor(private documents: DocumentsService) {}

  // company_admin de la compagnie, ou admin. Le fichier est buffé en mémoire
  // (pas écrit sur disque) tant que la portée n'est pas vérifiée côté service.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.COMPAGNIE_UPDATE)
  @UseInterceptors(
    FileInterceptor('document', {
      storage: memoryStorage(),
      limits: { fileSize: DOCUMENTS.TAILLE_MAX_OCTETS },
    }),
  )
  @Post()
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('compagnieId', ParseIntPipe) compagnieId: number,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documents.upload(compagnieId, user, dto.type, file);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.COMPAGNIE_UPDATE)
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('compagnieId', ParseIntPipe) compagnieId: number,
  ) {
    return this.documents.findAllPourCompagnie(compagnieId, user);
  }

  // Aperçu / téléchargement : mêmes règles d'accès que la liste.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.COMPAGNIE_UPDATE)
  @Get(':docId/fichier')
  async telecharger(
    @CurrentUser() user: AuthenticatedUser,
    @Param('compagnieId', ParseIntPipe) compagnieId: number,
    @Param('docId', ParseIntPipe) docId: number,
    @Res() res: Response,
  ) {
    const { stream, mimeType, nomFichier } = await this.documents.flux(
      compagnieId,
      docId,
      user,
    );
    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(nomFichier)}"`,
    );
    stream.pipe(res);
  }

  // Décision (valider / refuser) : admin plateforme uniquement.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.COMPAGNIE_MODERATE)
  @Patch(':docId')
  revoir(
    @Param('compagnieId', ParseIntPipe) compagnieId: number,
    @Param('docId', ParseIntPipe) docId: number,
    @Body() dto: RevueDocumentDto,
  ) {
    return this.documents.revoir(compagnieId, docId, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.COMPAGNIE_UPDATE)
  @Delete(':docId')
  supprimer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('compagnieId', ParseIntPipe) compagnieId: number,
    @Param('docId', ParseIntPipe) docId: number,
  ) {
    return this.documents.supprimer(compagnieId, docId, user);
  }
}

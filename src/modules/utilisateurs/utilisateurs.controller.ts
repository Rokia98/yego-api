import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ListeUtilisateursDto } from './dto/liste-utilisateurs.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AutoriseMotDePasseTemporaire } from '../../common/decorators/mot-de-passe-temporaire.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../config/permissions';
import { UserRole } from '../../config/constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { UtilisateursService } from './utilisateurs.service';
import { CreateUtilisateurDto } from './dto/create-utilisateur.dto';
import { UpdateUtilisateurDto } from './dto/update-utilisateur.dto';
import { SetRoleDto } from './dto/set-role.dto';

@Controller('utilisateurs')
export class UtilisateursController {
  constructor(private utilisateursService: UtilisateursService) {}

  // Création d'un compte par un agent (voyageur au guichet). L'inscription
  // grand public passe par POST /auth/register (avec rate limiting).
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.UTILISATEUR_CREATE)
  @Post()
  create(@Body() dto: CreateUtilisateurDto) {
    return this.utilisateursService.create(dto);
  }

  // Liste de tous les utilisateurs (PII) : administrateurs plateforme uniquement.
  // Filtres role / compagnieId / actif / q ; le total hors pagination est
  // renvoyé dans l'en-tête X-Total-Count (le corps reste un tableau).
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.UTILISATEUR_LIST)
  @Get()
  async findAll(
    @Query() filtres: ListeUtilisateursDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { total, utilisateurs } = await this.utilisateursService.findAll(filtres);
    res.setHeader('X-Total-Count', total);
    return utilisateurs;
  }

  // Attribution du rôle et de la compagnie de rattachement : admin plateforme.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.UTILISATEUR_SET_ROLE)
  @Patch(':id/role')
  setRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRoleDto,
  ) {
    return this.utilisateursService.setRole(id, dto);
  }

  // Un utilisateur ne peut consulter que son propre profil ; un admin, tous.
  @UseGuards(JwtAuthGuard)
  @AutoriseMotDePasseTemporaire()
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.assurerAccesAuProfil(user, id);
    return this.utilisateursService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUtilisateurDto,
  ) {
    this.assurerAccesAuProfil(user, id);
    return this.utilisateursService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.assurerAccesAuProfil(user, id);
    return this.utilisateursService.delete(id);
  }

  private assurerAccesAuProfil(user: AuthenticatedUser, cibleId: number) {
    if (user.role !== UserRole.ADMIN && user.userId !== cibleId) {
      throw new ForbiddenException(
        'Vous ne pouvez agir que sur votre propre compte',
      );
    }
  }
}

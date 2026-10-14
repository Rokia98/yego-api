import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resoudreCompagnieCible } from '../../common/scope';
import { PERMISSIONS } from '../../config/permissions';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ReversementsService } from './reversements.service';
import {
  ApercuReversementQuery,
  ApprouverDemandeReversementDto,
  CoordonneesReversementDto,
  RemiseReversementDto,
  CreerReversementDto,
  DemanderReversementDto,
  ListeDemandesReversementQuery,
  ListeReversementsQuery,
  RejeterDemandeReversementDto,
} from './dto/reversement.dto';

@Controller('reversements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReversementsController {
  constructor(private reversements: ReversementsService) {}

  // Ce qui serait reversé maintenant (admin : ?compagnieId requis ;
  // company_admin : sa compagnie).
  @RequirePermissions(PERMISSIONS.REVERSEMENT_READ)
  @Get('apercu')
  apercu(@CurrentUser() user: AuthenticatedUser, @Query() q: ApercuReversementQuery) {
    return this.reversements.apercu(resoudreCompagnieCible(user, q.compagnieId), user);
  }

  // Solde disponible du magasin Jèko de Yègo.
  @RequirePermissions(PERMISSIONS.REVERSEMENT_MANAGE)
  @Get('solde')
  solde() {
    return this.reversements.solde();
  }

  @RequirePermissions(PERMISSIONS.REVERSEMENT_READ)
  @Get('coordonnees/:compagnieId')
  lireCoordonnees(
    @CurrentUser() user: AuthenticatedUser,
    @Param('compagnieId', ParseIntPipe) compagnieId: number,
  ) {
    return this.reversements.lireCoordonnees(compagnieId, user);
  }

  @RequirePermissions(PERMISSIONS.COMPAGNIE_UPDATE)
  @Put('coordonnees/:compagnieId')
  definirCoordonnees(
    @CurrentUser() user: AuthenticatedUser,
    @Param('compagnieId', ParseIntPipe) compagnieId: number,
    @Body() dto: CoordonneesReversementDto,
    @Ip() ip: string,
  ) {
    return this.reversements.definirCoordonnees(compagnieId, dto, user, ip);
  }

  // Déclenche le transfert Jèko du lot éligible (équipe Yègo uniquement).
  @RequirePermissions(PERMISSIONS.REVERSEMENT_MANAGE)
  @Post()
  creer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreerReversementDto,
    @Ip() ip: string,
  ) {
    return this.reversements.creer(dto.compagnieId, dto.moyen, {
      userId: user.userId,
      role: user.role,
      ip,
    });
  }

  // --- Demandes de reversement (compagnie → admin) -------------------------

  @RequirePermissions(PERMISSIONS.REVERSEMENT_DEMANDER)
  @Post('demandes')
  demander(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DemanderReversementDto,
    @Ip() ip: string,
  ) {
    return this.reversements.demander(user, dto, ip);
  }

  // Admin : toutes (filtre ?compagnieId) ; gestionnaire : celles de sa compagnie.
  @RequirePermissions(PERMISSIONS.REVERSEMENT_READ)
  @Get('demandes')
  listerDemandes(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: ListeDemandesReversementQuery,
  ) {
    return this.reversements.listerDemandes(user, q);
  }

  // Lance le transfert Jèko vers le numéro Wave / Orange Money de Yègo.
  @RequirePermissions(PERMISSIONS.REVERSEMENT_MANAGE)
  @Post('demandes/:id/approuver')
  approuverDemande(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApprouverDemandeReversementDto,
    @Ip() ip: string,
  ) {
    return this.reversements.approuverDemande(id, dto.moyen, {
      userId: user.userId,
      role: user.role,
      ip,
    });
  }

  @RequirePermissions(PERMISSIONS.REVERSEMENT_MANAGE)
  @Post('demandes/:id/rejeter')
  rejeterDemande(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejeterDemandeReversementDto,
    @Ip() ip: string,
  ) {
    return this.reversements.rejeterDemande(id, dto.motif, {
      userId: user.userId,
      role: user.role,
      ip,
    });
  }

  @RequirePermissions(PERMISSIONS.REVERSEMENT_DEMANDER)
  @Post('demandes/:id/annuler')
  annulerDemande(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.reversements.annulerDemande(id, user);
  }

  // -------------------------------------------------------------------------

  @RequirePermissions(PERMISSIONS.REVERSEMENT_READ)
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() q: ListeReversementsQuery) {
    return this.reversements.findAll(user, q);
  }

  // L'admin déclare avoir remis l'argent à la compagnie (hors système).
  @RequirePermissions(PERMISSIONS.REVERSEMENT_MANAGE)
  @Post(':id/remise')
  marquerRemis(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RemiseReversementDto,
    @Ip() ip: string,
  ) {
    return this.reversements.marquerRemis(id, dto.note, {
      userId: user.userId,
      role: user.role,
      ip,
    });
  }

  @RequirePermissions(PERMISSIONS.REVERSEMENT_READ)
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.reversements.findOne(id, user);
  }
}

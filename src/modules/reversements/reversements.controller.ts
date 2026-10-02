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
  CoordonneesReversementDto,
  CreerReversementDto,
  ListeReversementsQuery,
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
    return this.reversements.creer(dto.compagnieId, {
      userId: user.userId,
      role: user.role,
      ip,
    });
  }

  @RequirePermissions(PERMISSIONS.REVERSEMENT_READ)
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() q: ListeReversementsQuery) {
    return this.reversements.findAll(user, q);
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

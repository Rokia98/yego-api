import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../config/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { verifierSuiviToken } from '../../common/suivi-token';
import { SuiviService } from './suivi.service';
import { PositionDto } from './dto/position.dto';
import { DeclarerRetardDto } from './dto/declarer-retard.dto';

@Controller('departs')
export class SuiviController {
  constructor(private suivi: SuiviService) {}

  // Back-office : démarre le départ, renvoie le jeton de suivi du chauffeur.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.DEPART_MANAGE)
  @Post(':id/demarrer')
  demarrer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.suivi.demarrer(id, user);
  }

  // App chauffeur : envoi périodique de la position. Auth = jeton de suivi.
  @Post(':id/position')
  position(
    @Param('id', ParseIntPipe) id: number,
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: PositionDto,
  ) {
    return this.suivi.enregistrerPosition(id, this.departIdDuToken(authorization), dto);
  }

  // Back-office : déclare un retard (sans GPS). Notifie les voyageurs.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.DEPART_MANAGE)
  @Post(':id/retard')
  declarerRetard(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeclarerRetardDto,
  ) {
    return this.suivi.declarerRetard(id, user, dto.minutesRetard, dto.motif);
  }

  // App chauffeur : fin du trajet. Auth = jeton de suivi.
  @Post(':id/arriver')
  arriver(
    @Param('id', ParseIntPipe) id: number,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.suivi.arriver(id, this.departIdDuToken(authorization));
  }

  // Suivi live : voyageur avec réservation, personnel de la compagnie, admin.
  @UseGuards(JwtAuthGuard)
  @Get(':id/suivi')
  suiviLive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.suivi.suivi(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/suivi/historique')
  historique(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('depuis') depuis?: string,
    @Query('limite') limite?: string,
  ) {
    return this.suivi.historique(
      id,
      user,
      depuis,
      limite != null ? Number(limite) : undefined,
    );
  }

  private departIdDuToken(authorization: string | undefined): number {
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    const departId = token ? verifierSuiviToken(token) : null;
    if (departId == null) {
      throw new UnauthorizedException('Jeton de suivi absent, invalide ou expiré');
    }
    return departId;
  }
}

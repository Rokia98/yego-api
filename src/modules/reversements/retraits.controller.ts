import { Body, Controller, Get, Ip, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../../config/permissions';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { RetraitsService } from './retraits.service';
// Mêmes statuts qu'un reversement (en_cours | effectue | echoue).
import { CreerRetraitDto, ListeReversementsQuery as ListeRetraitsQuery } from './dto/reversement.dto';

// Retraits de la part Yègo vers le numéro Mobile Money de Yègo : admin
// plateforme uniquement.
@Controller('retraits')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.RETRAIT_MANAGE)
export class RetraitsController {
  constructor(private retraits: RetraitsService) {}

  // Solde Jèko, part des compagnies/voyageurs, part Yègo retirable.
  @Get('apercu')
  apercu() {
    return this.retraits.apercu();
  }

  // Mot de passe redemandé ; tentatives limitées.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post()
  creer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreerRetraitDto,
    @Ip() ip: string,
  ) {
    return this.retraits.creer(dto, { userId: user.userId, role: user.role, ip });
  }

  @Get()
  findAll(@Query() q: ListeRetraitsQuery) {
    return this.retraits.findAll(q);
  }
}

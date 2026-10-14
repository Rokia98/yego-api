import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../config/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { DashboardService } from './dashboard.service';
import { DashboardPeriodeDto } from './dto/dashboard-periode.dto';
import { DashboardClassementDto } from './dto/dashboard-classement.dto';
import { DashboardSerieDto } from './dto/dashboard-serie.dto';
import { resoudreCompagnieCible } from '../../common/scope';
import { ReversementsService } from '../reversements/reversements.service';
import { ApercuReversementQuery } from '../reversements/dto/reversement.dto';

// Admin plateforme (toutes compagnies, filtrables) ou company_admin (la sienne).
@Controller('dashboard')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.DASHBOARD_READ)
export class DashboardController {
  constructor(
    private dashboardService: DashboardService,
    private reversements: ReversementsService,
  ) {}

  // Vue d'ensemble : réservations, canal, chiffre d'affaires, remplissage.
  @Get('resume')
  resume(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: DashboardPeriodeDto,
  ) {
    return this.dashboardService.resume(user, dto);
  }

  // Série journalière (courbes de tendance) : un point par jour de la période.
  @Get('series')
  series(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: DashboardSerieDto,
  ) {
    return this.dashboardService.serie(user, dto);
  }

  // Solde de la compagnie : ventes en ligne à lui reverser (disponible, en
  // attente, en cours) et cumul déjà reversé. company_admin : la sienne ;
  // admin : ?compagnieId requis.
  @Get('solde')
  solde(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: ApercuReversementQuery,
  ) {
    return this.reversements.soldeCompagnie(
      resoudreCompagnieCible(user, q.compagnieId),
      user,
    );
  }

  // Trajets les plus vendus (revenu encaissé).
  @Get('trajets')
  trajets(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: DashboardClassementDto,
  ) {
    return this.dashboardService.trajetsPlusActifs(user, dto);
  }

  // Compagnies les plus actives (revenu encaissé). Admin uniquement.
  @Get('compagnies')
  compagnies(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: DashboardClassementDto,
  ) {
    return this.dashboardService.compagniesPlusActives(user, dto);
  }
}

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

// Admin plateforme (toutes compagnies, filtrables) ou company_admin (la sienne).
@Controller('dashboard')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.DASHBOARD_READ)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  // Vue d'ensemble : réservations, canal, chiffre d'affaires, remplissage.
  @Get('resume')
  resume(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: DashboardPeriodeDto,
  ) {
    return this.dashboardService.resume(user, dto);
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

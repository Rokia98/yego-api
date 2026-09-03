import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../config/permissions';
import { AuditService } from './audit.service';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.AUDIT_READ)
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get()
  list(
    @Query('skip') skip = 0,
    @Query('take') take = 20,
    @Query('entite') entite?: string,
    @Query('action') action?: string,
  ) {
    return this.auditService.list({
      skip: Number(skip),
      take: Number(take),
      entite,
      action,
    });
  }
}

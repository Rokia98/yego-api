import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../config/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { AbonnementsService } from './abonnements.service';
import { CreateAbonnementDto } from './dto/create-abonnement.dto';
import { UpdateAbonnementDto } from './dto/update-abonnement.dto';

@Controller('abonnements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AbonnementsController {
  constructor(private abonnementsService: AbonnementsService) {}

  @RequirePermissions(PERMISSIONS.ABONNEMENT_MANAGE)
  @Post()
  create(@Body() dto: CreateAbonnementDto) {
    return this.abonnementsService.create(dto);
  }

  @RequirePermissions(PERMISSIONS.ABONNEMENT_MANAGE)
  @Get()
  findAll(
    @Query('compagnieId') compagnieId?: string,
    @Query('statut') statut?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.abonnementsService.findAll({
      compagnieId: compagnieId ? Number(compagnieId) : undefined,
      statut,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  // Un company_admin consulte l'abonnement de SA compagnie.
  @RequirePermissions(PERMISSIONS.ABONNEMENT_READ)
  @Get('compagnie/:compagnieId')
  findByCompagnie(
    @CurrentUser() user: AuthenticatedUser,
    @Param('compagnieId', ParseIntPipe) compagnieId: number,
  ) {
    return this.abonnementsService.findByCompagnie(compagnieId, user);
  }

  @RequirePermissions(PERMISSIONS.ABONNEMENT_MANAGE)
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAbonnementDto,
  ) {
    return this.abonnementsService.update(id, dto);
  }
}

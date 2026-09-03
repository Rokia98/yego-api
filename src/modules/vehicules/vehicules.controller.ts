import {
  Body,
  Controller,
  Delete,
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
import { VehiculesService } from './vehicules.service';
import { CreateVehiculeDto } from './dto/create-vehicule.dto';
import { UpdateVehiculeDto } from './dto/update-vehicule.dto';

// Données d'exploitation internes : aucune route publique. Lecture réservée
// au personnel de la compagnie (agent, company_admin) et à l'admin plateforme ;
// écriture au company_admin (sa flotte) et à l'admin.
@Controller('vehicules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VehiculesController {
  constructor(private vehiculesService: VehiculesService) {}

  @RequirePermissions(PERMISSIONS.FLOTTE_READ)
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('skip') skip = 0,
    @Query('take') take = 10,
  ) {
    return this.vehiculesService.findAll(user, Number(skip), Number(take));
  }

  @RequirePermissions(PERMISSIONS.FLOTTE_READ)
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.vehiculesService.findOne(id, user);
  }

  @RequirePermissions(PERMISSIONS.VEHICULE_MANAGE)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateVehiculeDto,
  ) {
    return this.vehiculesService.create(dto, user);
  }

  @RequirePermissions(PERMISSIONS.VEHICULE_MANAGE)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVehiculeDto,
  ) {
    return this.vehiculesService.update(id, dto, user);
  }

  @RequirePermissions(PERMISSIONS.VEHICULE_MANAGE)
  @Delete(':id')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.vehiculesService.delete(id, user);
  }
}

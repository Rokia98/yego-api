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
import { DepartsService } from './departs.service';
import { CreateDepartDto } from './dto/create-depart.dto';
import { UpdateDepartDto } from './dto/update-depart.dto';
import { RechercheDepartDto } from './dto/recherche-depart.dto';

@Controller('departs')
export class DepartsController {
  constructor(private departsService: DepartsService) {}

  @Get()
  findAll(
    @Query('skip') skip = 0,
    @Query('take') take = 10,
    @Query('compagnieId') compagnieId?: string,
  ) {
    return this.departsService.findAll(
      Number(skip),
      Number(take),
      compagnieId != null ? Number(compagnieId) : undefined,
    );
  }

  // Route spécifique déclarée AVANT ':id' pour ne pas être interceptée par elle.
  @Get('recherche')
  rechercher(@Query() query: RechercheDepartDto) {
    return this.departsService.rechercher(
      query.depart,
      query.arrivee,
      query.date,
      query.dateFin,
    );
  }

  // Plan de salle : sièges déjà attribués sur ce départ (route publique, utile
  // au voyageur avant réservation). Déclarée avant ':id' pour la lisibilité.
  @Get(':id/sieges')
  sieges(@Param('id', ParseIntPipe) id: number) {
    return this.departsService.sieges(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.departsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.DEPART_MANAGE)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDepartDto,
  ) {
    return this.departsService.create(dto, user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.DEPART_MANAGE)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDepartDto,
  ) {
    return this.departsService.update(id, dto, user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.DEPART_MANAGE)
  @Delete(':id')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.departsService.delete(id, user);
  }
}

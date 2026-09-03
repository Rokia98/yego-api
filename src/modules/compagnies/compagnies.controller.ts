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
import { CompagniesService } from './compagnies.service';
import { CreateCompagnieDto } from './dto/create-compagnie.dto';
import { UpdateCompagnieDto } from './dto/update-compagnie.dto';
import { ModererCompagnieDto } from './dto/moderer-compagnie.dto';

@Controller('compagnies')
export class CompagniesController {
  constructor(private compagniesService: CompagniesService) {}

  @Get()
  findAll(@Query('skip') skip = 0, @Query('take') take = 10) {
    return this.compagniesService.findAll(skip, take);
  }

  // Route spécifique déclarée AVANT ':id' pour ne pas être interceptée par elle.
  @Get('statut/:statut')
  findByStatut(
    @Param('statut') statut: string,
    @Query('skip') skip = 0,
    @Query('take') take = 10,
  ) {
    return this.compagniesService.findByStatut(statut, skip, take);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.compagniesService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.COMPAGNIE_CREATE)
  @Post()
  create(@Body() dto: CreateCompagnieDto) {
    return this.compagniesService.create(dto);
  }

  // Infos de la compagnie : admin plateforme, ou company_admin de CETTE compagnie.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.COMPAGNIE_UPDATE)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCompagnieDto,
  ) {
    return this.compagniesService.update(id, dto, user);
  }

  // Activation / suspension d'une compagnie : admin plateforme uniquement.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.COMPAGNIE_MODERATE)
  @Patch(':id/statut')
  moderer(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ModererCompagnieDto,
  ) {
    return this.compagniesService.moderer(id, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.COMPAGNIE_DELETE)
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.compagniesService.delete(id);
  }
}

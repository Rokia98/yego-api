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
import { ChauffeursService } from './chauffeurs.service';
import { CreateChauffeurDto } from './dto/create-chauffeur.dto';
import { UpdateChauffeurDto } from './dto/update-chauffeur.dto';

@Controller('chauffeurs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChauffeursController {
  constructor(private chauffeursService: ChauffeursService) {}

  @RequirePermissions(PERMISSIONS.FLOTTE_READ)
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('skip') skip = 0,
    @Query('take') take = 10,
  ) {
    return this.chauffeursService.findAll(user, Number(skip), Number(take));
  }

  @RequirePermissions(PERMISSIONS.FLOTTE_READ)
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.chauffeursService.findOne(id, user);
  }

  @RequirePermissions(PERMISSIONS.CHAUFFEUR_MANAGE)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateChauffeurDto,
  ) {
    return this.chauffeursService.create(dto, user);
  }

  @RequirePermissions(PERMISSIONS.CHAUFFEUR_MANAGE)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateChauffeurDto,
  ) {
    return this.chauffeursService.update(id, dto, user);
  }

  @RequirePermissions(PERMISSIONS.CHAUFFEUR_MANAGE)
  @Delete(':id')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.chauffeursService.delete(id, user);
  }
}

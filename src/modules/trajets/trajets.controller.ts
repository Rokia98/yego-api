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
import { TrajetsService } from './trajets.service';
import { CreateTrajetDto } from './dto/create-trajet.dto';
import { UpdateTrajetDto } from './dto/update-trajet.dto';

@Controller('trajets')
export class TrajetsController {
  constructor(private trajetsService: TrajetsService) {}

  @Get()
  findAll(@Query('skip') skip = 0, @Query('take') take = 10) {
    return this.trajetsService.findAll(skip, take);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.trajetsService.findOne(id);
  }

  @Get('compagnie/:compagnieId')
  findByCompagnie(
    @Param('compagnieId', ParseIntPipe) compagnieId: number,
    @Query('skip') skip = 0,
    @Query('take') take = 10,
  ) {
    return this.trajetsService.findByCompagnie(compagnieId, skip, take);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TRAJET_MANAGE)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTrajetDto,
  ) {
    return this.trajetsService.create(dto, user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TRAJET_MANAGE)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTrajetDto,
  ) {
    return this.trajetsService.update(id, dto, user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TRAJET_MANAGE)
  @Delete(':id')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.trajetsService.delete(id, user);
  }
}

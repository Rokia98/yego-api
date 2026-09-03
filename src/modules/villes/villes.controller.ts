import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../config/permissions';
import { VillesService } from './villes.service';
import { CreateVilleDto } from './dto/create-ville.dto';

@Controller('villes')
export class VillesController {
  constructor(private villesService: VillesService) {}

  @Get()
  findAll() {
    return this.villesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.villesService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.VILLE_MANAGE)
  @Post()
  create(@Body() dto: CreateVilleDto) {
    return this.villesService.create(dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.VILLE_MANAGE)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateVilleDto) {
    return this.villesService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.VILLE_MANAGE)
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.villesService.delete(id);
  }
}

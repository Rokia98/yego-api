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
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { CreateReservationGuichetDto } from './dto/create-reservation-guichet.dto';

@Controller('reservations')
@UseGuards(JwtAuthGuard)
export class ReservationsController {
  constructor(private reservationsService: ReservationsService) {}

  // Réservation en ligne par le voyageur pour lui-même.
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReservationDto,
  ) {
    return this.reservationsService.create(dto, user.userId);
  }

  // Vente au guichet : un agent réserve pour un voyageur qui se présente.
  // Route spécifique déclarée AVANT ':id'.
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.RESERVATION_GUICHET)
  @Post('guichet')
  creerAuGuichet(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReservationGuichetDto,
  ) {
    return this.reservationsService.creerAuGuichet(dto, user);
  }

  // Voyageur : ses réservations. Agent / company_admin : celles de leur
  // compagnie. Admin : toutes.
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('skip') skip = 0,
    @Query('take') take = 10,
  ) {
    return this.reservationsService.findAllScoped(user, Number(skip), Number(take));
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.reservationsService.findOne(id, user);
  }

  @Patch(':id/annuler')
  annuler(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.reservationsService.annuler(id, user);
  }
}

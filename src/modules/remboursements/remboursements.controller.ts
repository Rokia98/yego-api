import {
  Body,
  Controller,
  Get,
  Ip,
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
import { RemboursementsService } from './remboursements.service';
import { CreateRemboursementDto } from './dto/create-remboursement.dto';

@Controller('remboursements')
@UseGuards(JwtAuthGuard)
export class RemboursementsController {
  constructor(private remboursementsService: RemboursementsService) {}

  // Remboursement manuel (geste commercial, frais fixés par la compagnie) :
  // gestionnaire de la compagnie ou admin, sur une réservation déjà annulée.
  // Le voyageur, lui, passe par PATCH /reservations/:id/annuler (barème).
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.REMBOURSEMENT_CONFIRM)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRemboursementDto,
    @Ip() ip: string,
  ) {
    return this.remboursementsService.create(dto, user, {
      userId: user.userId,
      role: user.role,
      ip,
    });
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('skip') skip = 0,
    @Query('take') take = 10,
  ) {
    return this.remboursementsService.findAllScoped(user, Number(skip), Number(take));
  }

  // Routes spécifiques déclarées AVANT ':id' pour ne pas être interceptées par elle.
  @Get('statut/:statut')
  findByStatut(
    @CurrentUser() user: AuthenticatedUser,
    @Param('statut') statut: string,
    @Query('skip') skip = 0,
    @Query('take') take = 10,
  ) {
    return this.remboursementsService.findByStatutScoped(
      statut,
      user,
      Number(skip),
      Number(take),
    );
  }

  @Get('reservation/:reservationId')
  findByReservation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservationId', ParseIntPipe) reservationId: number,
  ) {
    return this.remboursementsService.findByReservation(reservationId, user);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.remboursementsService.findOne(id, user);
  }

  // Décaissement effectif : gestionnaire de la compagnie concernée ou admin.
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.REMBOURSEMENT_CONFIRM)
  @Patch(':id/confirmer')
  confirmer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Ip() ip: string,
  ) {
    return this.remboursementsService.confirmer(id, user, {
      userId: user.userId,
      role: user.role,
      ip,
    });
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseIntPipe,
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
import { TicketsService } from './tickets.service';
import { GenererTicketDto } from './dto/generer-ticket.dto';
import { SyncValidationsDto } from './dto/sync-validations.dto';
import { ListeValidationsDto } from './dto/liste-validations.dto';

@Controller('tickets')
export class TicketsController {
  constructor(private ticketsService: TicketsService) {}

  // Clé publique de vérification des QR (validation hors-ligne). Publique.
  // Déclarée AVANT ':id'.
  @Get('cle-publique')
  clePublique() {
    return this.ticketsService.clePublique();
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('skip') skip = 0,
    @Query('take') take = 10,
  ) {
    return this.ticketsService.findAllScoped(user, Number(skip), Number(take));
  }

  // Route spécifique déclarée AVANT ':id' pour ne pas être interceptée par elle.
  @UseGuards(JwtAuthGuard)
  @Get('reservation/:reservationId')
  findByReservation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservationId', ParseIntPipe) reservationId: number,
  ) {
    return this.ticketsService.findByReservation(reservationId, user);
  }

  // Historique des validations à l'embarquement. Agent → ses propres scans ;
  // company_admin → ceux de sa compagnie ; admin → tous. Déclarée AVANT ':id'.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TICKET_VALIDATE)
  @Get('validations')
  historiqueValidations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filtres: ListeValidationsDto,
  ) {
    return this.ticketsService.historiqueValidations(
      user,
      filtres.skip,
      filtres.take,
      filtres,
    );
  }

  // Manifeste d'un départ pour le contrôle hors-ligne. Déclaré AVANT ':id'.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TICKET_VALIDATE)
  @Get('depart/:departId/manifeste')
  manifesteDepart(
    @CurrentUser() user: AuthenticatedUser,
    @Param('departId', ParseIntPipe) departId: number,
  ) {
    return this.ticketsService.manifesteDepart(departId, user);
  }

  // Rejoue un lot de scans faits hors-ligne. Déclaré AVANT ':id'.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TICKET_VALIDATE)
  @Post('validations/sync')
  synchroniserValidations(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SyncValidationsDto,
    @Ip() ip: string,
  ) {
    return this.ticketsService.synchroniserValidations(dto.scans, {
      userId: user.userId,
      role: user.role,
      compagnieId: user.compagnieId,
      ip,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.ticketsService.findOne(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('reservation/:reservationId')
  genererPourReservation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @Body() dto: GenererTicketDto,
  ) {
    return this.ticketsService.genererPourReservation(
      reservationId,
      dto.siege,
      user,
    );
  }

  // Scanné à l'embarquement : agents, gestionnaires de compagnie, admins.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TICKET_VALIDATE)
  @Post('valider/:codeQr')
  valider(
    @CurrentUser() user: AuthenticatedUser,
    @Param('codeQr') codeQr: string,
    @Ip() ip: string,
  ) {
    return this.ticketsService.valider(codeQr, {
      userId: user.userId,
      role: user.role,
      compagnieId: user.compagnieId,
      ip,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.ticketsService.annuler(id, user);
  }
}

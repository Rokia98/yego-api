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
import { WebhookSecretGuard } from '../../common/guards/webhook-secret.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../config/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PaiementsService } from './paiements.service';
import { CreatePaiementDto } from './dto/create-paiement.dto';
import { CreatePaiementGuichetDto } from './dto/create-paiement-guichet.dto';
import { UpdatePaiementDto } from './dto/update-paiement.dto';

// Pas de guard au niveau du contrôleur : le webhook 'confirmer' ci-dessous
// est appelé par un serveur tiers (pas de JWT) et utilise son propre guard.
@Controller('paiements')
export class PaiementsController {
  constructor(private paiementsService: PaiementsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('skip') skip = 0,
    @Query('take') take = 10,
  ) {
    return this.paiementsService.findAllScoped(user, Number(skip), Number(take));
  }

  // Route spécifique déclarée AVANT ':id' pour ne pas être interceptée par elle.
  @UseGuards(JwtAuthGuard)
  @Get('reservation/:reservationId')
  findByReservation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservationId', ParseIntPipe) reservationId: number,
  ) {
    return this.paiementsService.findByReservation(reservationId, user);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.paiementsService.findOne(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaiementDto,
  ) {
    return this.paiementsService.create(dto, user.userId);
  }

  // Encaissement au comptoir par un agent (espèces ou mobile money reçu sur place).
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.RESERVATION_GUICHET)
  @Post('guichet')
  encaisserAuGuichet(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaiementGuichetDto,
  ) {
    return this.paiementsService.encaisserAuGuichet(dto, user);
  }

  // Appelé par le webhook de l'opérateur mobile money une fois le paiement
  // confirmé : authentifié par secret partagé (PAYMENT_WEBHOOK_SECRET).
  @UseGuards(WebhookSecretGuard)
  @Patch('reservation/:reservationId/confirmer')
  confirmer(@Param('reservationId', ParseIntPipe) reservationId: number) {
    return this.paiementsService.confirmer(reservationId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePaiementDto,
  ) {
    return this.paiementsService.update(id, dto, user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.paiementsService.delete(id, user.userId);
  }
}

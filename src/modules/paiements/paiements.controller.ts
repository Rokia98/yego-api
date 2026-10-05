import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WebhookSecretGuard } from '../../common/guards/webhook-secret.guard';
import { PaymentSimulationGuard } from '../../common/guards/payment-simulation.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../config/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PaiementsService } from './paiements.service';
import { JekoService } from '../jeko/jeko.service';
import { CreatePaiementDto } from './dto/create-paiement.dto';
import { CreatePaiementGuichetDto } from './dto/create-paiement-guichet.dto';
import { SimulerPaiementDto } from './dto/simuler-paiement.dto';
import { UpdatePaiementDto } from './dto/update-paiement.dto';

// Pas de guard au niveau du contrôleur : le webhook 'confirmer' ci-dessous
// est appelé par un serveur tiers (pas de JWT) et utilise son propre guard.
@Controller('paiements')
export class PaiementsController {
  constructor(
    private paiementsService: PaiementsService,
    private jeko: JekoService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('skip') skip = 0,
    @Query('take') take = 10,
  ) {
    return this.paiementsService.findAllScoped(user, Number(skip), Number(take));
  }

  // Taux des frais de service ajoutés aux achats en ligne, pour afficher le
  // total (billets + frais) avant le paiement.
  @UseGuards(JwtAuthGuard)
  @Get('frais-service')
  fraisService() {
    return { pourcent: this.paiementsService.fraisServicePourcent() };
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

  // Ancien webhook générique (secret partagé PAYMENT_WEBHOOK_SECRET). Il
  // confirme un paiement sans aucune preuve d'encaissement : dès que Jèko est
  // branché (webhook signé + réconciliation), il est coupé (404).
  @UseGuards(WebhookSecretGuard)
  @Patch('reservation/:reservationId/confirmer')
  confirmer(@Param('reservationId', ParseIntPipe) reservationId: number) {
    if (this.jeko.estConfigure()) {
      throw new NotFoundException();
    }
    return this.paiementsService.confirmer(reservationId);
  }

  // Interroge Jèko sur le paiement en attente et applique son issue (payé /
  // échoué). À appeler au retour de la page opérateur ou depuis l'écran
  // d'attente USSD : le webhook reste la source principale.
  // 12/min : l'app interroge toutes les 5 s ; au-delà, on protège le quota
  // Jèko (500 req/min pour toute l'entreprise).
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  @Post('reservation/:reservationId/verifier')
  verifier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservationId', ParseIntPipe) reservationId: number,
  ) {
    return this.paiementsService.verifierAupresDeJeko(reservationId, user);
  }

  // Simulation opérateur (mode PAYMENT_SIMULATION uniquement) : le voyageur
  // force le résultat de SON paiement sans transaction réelle. 404 si le flag
  // n'est pas actif.
  @UseGuards(JwtAuthGuard, PaymentSimulationGuard)
  @Post('reservation/:reservationId/simuler')
  simuler(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @Body() dto: SimulerPaiementDto,
  ) {
    return this.paiementsService.simuler(reservationId, dto.resultat, user);
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

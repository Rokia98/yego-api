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
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../config/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SupportService } from './support.service';
import {
  AjouterMessageDto,
  CreerDemandeDto,
  ListeDemandesDto,
  ModifierDemandeDto,
} from './dto/support.dto';

// Portée et droits de traitement vérifiés dans le service (voir SupportService).
@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private support: SupportService) {}

  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.SUPPORT_CREATE)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('demandes')
  creer(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreerDemandeDto) {
    return this.support.creer(dto, user);
  }

  @Get('demandes')
  lister(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filtres: ListeDemandesDto,
  ) {
    return this.support.lister(user, filtres);
  }

  // Déclarée avant 'demandes/:id' par lisibilité (chemins distincts).
  @Get('compteurs')
  compteurs(@CurrentUser() user: AuthenticatedUser) {
    return this.support.compteurs(user);
  }

  @Get('demandes/:id')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.support.detail(id, user);
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('demandes/:id/messages')
  ajouterMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AjouterMessageDto,
  ) {
    return this.support.ajouterMessage(id, dto, user);
  }

  @Patch('demandes/:id')
  modifier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ModifierDemandeDto,
  ) {
    return this.support.modifier(id, dto, user);
  }
}

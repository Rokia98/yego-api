import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { NotificationsService } from './notifications.service';
import { EnregistrerAppareilDto } from './dto/enregistrer-appareil.dto';
import { RetirerAppareilDto } from './dto/retirer-appareil.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  // L'app mobile enregistre son jeton FCM à la connexion / au refresh du jeton.
  @Post('appareils')
  enregistrerAppareil(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EnregistrerAppareilDto,
  ) {
    return this.notifications.enregistrerAppareil(user.userId, dto);
  }

  // À la déconnexion de l'appareil.
  @HttpCode(200)
  @Delete('appareils')
  retirerAppareil(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RetirerAppareilDto,
  ) {
    return this.notifications.retirerAppareil(user.userId, dto.token);
  }

  // Fil de notifications du voyageur connecté.
  @Get()
  lister(
    @CurrentUser() user: AuthenticatedUser,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('nonLu') nonLu?: string,
  ) {
    return this.notifications.listerPour(user.userId, {
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
      nonLu: nonLu === 'true',
    });
  }

  @Get('compteur')
  compteur(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.compterNonLues(user.userId);
  }

  @HttpCode(200)
  @Patch('lu')
  toutLu(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.marquerToutLu(user.userId);
  }

  @HttpCode(200)
  @Patch(':id/lu')
  lu(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.notifications.marquerLu(user.userId, id);
  }
}

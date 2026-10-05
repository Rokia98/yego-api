import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Ip,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AutoriseMotDePasseTemporaire } from '../../common/decorators/mot-de-passe-temporaire.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from './strategies/jwt.strategy';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangerMotDePasseDto } from './dto/changer-mot-de-passe.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Limite stricte : freine les attaques par force brute / bourrage d'identifiants.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register')
  register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.register(dto, { ip, userAgent });
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.login(dto, { ip, userAgent });
  }

  // Échange un refresh token valide contre un nouveau couple access/refresh.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(200)
  @Post('refresh')
  refresh(
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.refresh(dto.refreshToken, { ip, userAgent });
  }

  // Changement de mot de passe par le titulaire (vérifie l'ancien). Lève le
  // flag "mot de passe temporaire" et réémet un couple access/refresh —
  // pas besoin de se reconnecter après. Révoque les AUTRES sessions.
  @UseGuards(JwtAuthGuard)
  @AutoriseMotDePasseTemporaire()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @Patch('mot-de-passe')
  changerMotDePasse(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangerMotDePasseDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.changerMotDePasse(user.userId, dto, { ip, userAgent });
  }

  // Révoque le refresh token présenté (déconnexion de l'appareil courant).
  @HttpCode(200)
  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  // Révoque toutes les sessions et invalide les access tokens en cours.
  @UseGuards(JwtAuthGuard)
  @AutoriseMotDePasseTemporaire()
  @HttpCode(200)
  @Post('logout-all')
  logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logoutAll(user.userId);
  }
}

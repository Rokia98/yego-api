import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '../../config/constants';
import { JwtPayload } from './strategies/jwt.strategy';

const BCRYPT_ROUNDS = 12;

export interface ContexteRequete {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly refreshTtlMs: number;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    config: ConfigService,
  ) {
    const jours = config.get<number>('REFRESH_TOKEN_EXPIRES_DAYS', 30);
    this.refreshTtlMs = jours * 24 * 60 * 60 * 1000;
  }

  async register(dto: RegisterDto, ctx: ContexteRequete = {}) {
    const existant = await this.prisma.utilisateur.findUnique({
      where: { telephone: dto.telephone },
    });
    if (existant) {
      throw new ConflictException(
        'Un compte existe déjà avec ce numéro de téléphone',
      );
    }

    const motDePasseHash = await bcrypt.hash(dto.motDePasse, BCRYPT_ROUNDS);
    // Le rôle n'est jamais accepté depuis le body : tout compte créé via
    // l'inscription publique est un simple utilisateur.
    const utilisateur = await this.prisma.utilisateur.create({
      data: {
        nom: dto.nom,
        telephone: dto.telephone,
        email: dto.email,
        motDePasseHash,
        role: UserRole.USER,
      },
    });

    return this.emettreJetons(utilisateur, ctx);
  }

  async login(dto: LoginDto, ctx: ContexteRequete = {}) {
    const utilisateur = await this.prisma.utilisateur.findUnique({
      where: { telephone: dto.telephone },
    });
    if (!utilisateur || !utilisateur.motDePasseHash) {
      throw new UnauthorizedException('Identifiants invalides');
    }
    if (!utilisateur.actif) {
      throw new UnauthorizedException('Ce compte a été désactivé');
    }

    const motDePasseValide = await bcrypt.compare(
      dto.motDePasse,
      utilisateur.motDePasseHash,
    );
    if (!motDePasseValide) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    return this.emettreJetons(utilisateur, ctx);
  }

  // Rotation : le refresh token présenté est révoqué et remplacé par un neuf.
  // Un token déjà révoqué qui est réutilisé => on révoque toute la lignée
  // (détection de vol de jeton).
  async refresh(refreshToken: string, ctx: ContexteRequete = {}) {
    const tokenHash = this.hacher(refreshToken);
    const enregistrement = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!enregistrement) {
      throw new UnauthorizedException('Refresh token invalide');
    }

    if (enregistrement.revokedAt || enregistrement.expiresAt < new Date()) {
      // Réutilisation d'un jeton révoqué/expiré : on coupe tout par sécurité.
      await this.prisma.refreshToken.updateMany({
        where: { utilisateurId: enregistrement.utilisateurId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session compromise, reconnectez-vous');
    }

    const utilisateur = await this.prisma.utilisateur.findUnique({
      where: { id: enregistrement.utilisateurId },
    });
    if (!utilisateur) {
      throw new UnauthorizedException('Compte introuvable');
    }

    const nouveau = await this.creerRefreshToken(utilisateur.id, ctx);
    await this.prisma.refreshToken.update({
      where: { id: enregistrement.id },
      data: { revokedAt: new Date(), remplacePar: nouveau.id },
    });

    return {
      accessToken: this.signerAccessToken(utilisateur),
      refreshToken: nouveau.token,
      utilisateurId: utilisateur.id,
      role: utilisateur.role,
    };
  }

  async logout(refreshToken: string) {
    const tokenHash = this.hacher(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Déconnecté' };
  }

  // Déconnexion de tous les appareils : révoque les refresh tokens ET
  // invalide les access tokens en cours via tokenVersion.
  async logoutAll(utilisateurId: number) {
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { utilisateurId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.utilisateur.update({
        where: { id: utilisateurId },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);
    return { message: 'Déconnecté de tous les appareils' };
  }

  private async emettreJetons(
    utilisateur: {
      id: number;
      telephone: string;
      role: string;
      compagnieId: number | null;
      tokenVersion: number;
    },
    ctx: ContexteRequete,
  ) {
    const refresh = await this.creerRefreshToken(utilisateur.id, ctx);
    return {
      accessToken: this.signerAccessToken(utilisateur),
      refreshToken: refresh.token,
      utilisateurId: utilisateur.id,
      telephone: utilisateur.telephone,
      role: utilisateur.role,
    };
  }

  private signerAccessToken(utilisateur: {
    id: number;
    telephone: string;
    role: string;
    compagnieId: number | null;
    tokenVersion: number;
  }) {
    const payload: JwtPayload = {
      sub: utilisateur.id,
      telephone: utilisateur.telephone,
      role: utilisateur.role as UserRole,
      cid: utilisateur.compagnieId ?? null,
      tv: utilisateur.tokenVersion,
    };
    return this.jwtService.sign(payload);
  }

  private async creerRefreshToken(utilisateurId: number, ctx: ContexteRequete) {
    const token = randomBytes(48).toString('base64url');
    const enregistrement = await this.prisma.refreshToken.create({
      data: {
        utilisateurId,
        tokenHash: this.hacher(token),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
        creeParIp: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, 255),
      },
    });
    return { id: enregistrement.id, token };
  }

  private hacher(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}

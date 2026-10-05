import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma.service';
import { UserRole } from '../../../config/constants';

export interface JwtPayload {
  sub: number;
  telephone: string;
  role: UserRole;
  // compagnie de rattachement (agent / company_admin), sinon null
  cid: number | null;
  // tokenVersion au moment de l'émission : permet une révocation globale.
  tv: number;
  // Mot de passe temporaire (généré par un tiers) à changer. Snapshot pris à
  // l'émission du token ; se met à jour à la prochaine connexion ou après
  // PATCH /auth/mot-de-passe (qui réémet un token).
  pwTmp: boolean;
}

export interface AuthenticatedUser {
  userId: number;
  telephone: string;
  role: UserRole;
  compagnieId: number | null;
  // Mot de passe temporaire non encore changé (relu en base à chaque requête).
  doitChangerMotDePasse?: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Revérifie à chaque requête que le compte existe encore et que le token
  // n'a pas été révoqué globalement (tokenVersion). Rôle et compagnie sont
  // relus en base (source de vérité).
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const utilisateur = await this.prisma.utilisateur.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        telephone: true,
        role: true,
        actif: true,
        compagnieId: true,
        tokenVersion: true,
        doitChangerMotDePasse: true,
      },
    });

    if (!utilisateur || !utilisateur.actif) {
      throw new UnauthorizedException('Compte introuvable ou désactivé');
    }
    if ((payload.tv ?? 0) !== utilisateur.tokenVersion) {
      throw new UnauthorizedException('Session expirée, reconnectez-vous');
    }

    return {
      userId: utilisateur.id,
      telephone: utilisateur.telephone,
      role: utilisateur.role as UserRole,
      compagnieId: utilisateur.compagnieId,
      doitChangerMotDePasse: utilisateur.doitChangerMotDePasse,
    };
  }
}

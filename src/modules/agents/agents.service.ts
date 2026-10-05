import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma.service';
import { UserRole } from '../../config/constants';
import { assertCompagnieScope, resoudreCompagnieCible } from '../../common/scope';
import { paginer } from '../../common/pagination';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

const BCRYPT_ROUNDS = 12;

// Agent guichet = Utilisateur { role: 'agent' } rattaché à une compagnie.
const AGENT_SELECT = {
  id: true,
  nom: true,
  telephone: true,
  email: true,
  role: true,
  actif: true,
  compagnieId: true,
  dateCreation: true,
};

@Injectable()
export class AgentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateAgentDto, user: AuthenticatedUser) {
    const compagnieId = resoudreCompagnieCible(user, dto.compagnieId);

    const existant = await this.prisma.utilisateur.findUnique({
      where: { telephone: dto.telephone },
      select: { id: true },
    });
    if (existant) {
      throw new ConflictException(
        'Un compte existe déjà avec ce numéro de téléphone',
      );
    }

    return this.prisma.utilisateur.create({
      data: {
        nom: dto.nom,
        telephone: dto.telephone,
        email: dto.email,
        motDePasseHash: await bcrypt.hash(dto.motDePasse, BCRYPT_ROUNDS),
        // Choisi par le gestionnaire : l'agent doit le changer à sa première
        // connexion (imposé par JwtAuthGuard).
        doitChangerMotDePasse: true,
        role: UserRole.AGENT,
        compagnieId,
      },
      select: AGENT_SELECT,
    });
  }

  // company_admin -> les agents de sa compagnie ; admin -> tous.
  findAll(user: AuthenticatedUser, skip = 0, take = 20) {
    return this.prisma.utilisateur.findMany({
      where: { role: UserRole.AGENT, ...this.filtrePortee(user) },
      ...paginer(skip, take),
      select: AGENT_SELECT,
      orderBy: { nom: 'asc' },
    });
  }

  async findOne(id: number, user: AuthenticatedUser) {
    const agent = await this.chargerAvecPortee(id, user);
    return this.prisma.utilisateur.findUnique({
      where: { id: agent.id },
      select: AGENT_SELECT,
    });
  }

  async update(id: number, dto: UpdateAgentDto, user: AuthenticatedUser) {
    await this.chargerAvecPortee(id, user);

    const data: Prisma.UtilisateurUpdateInput = {
      nom: dto.nom,
      telephone: dto.telephone,
      email: dto.email,
    };
    // Réinitialisation par le gestionnaire : mot de passe de nouveau
    // temporaire, et les sessions en cours de l'agent sont coupées.
    const reinitialisation = !!dto.motDePasse;
    if (dto.motDePasse) {
      data.motDePasseHash = await bcrypt.hash(dto.motDePasse, BCRYPT_ROUNDS);
      data.doitChangerMotDePasse = true;
      data.tokenVersion = { increment: 1 };
    }
    // Désactivation : on coupe aussi les sessions en cours.
    if (dto.actif === false) {
      data.actif = false;
      data.tokenVersion = { increment: 1 };
    } else if (dto.actif === true) {
      data.actif = true;
    }

    try {
      const agent = await this.prisma.utilisateur.update({
        where: { id },
        data,
        select: AGENT_SELECT,
      });
      // tokenVersion ne suffit pas : un refresh token encore valide
      // rouvrirait une session avec la nouvelle version.
      if (reinitialisation || dto.actif === false) {
        await this.prisma.refreshToken.updateMany({
          where: { utilisateurId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return agent;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Ce numéro de téléphone est déjà utilisé');
      }
      throw e;
    }
  }

  // Suppression = désactivation (préserve l'historique : audit, réservations
  // saisies). Le compte ne peut plus se connecter.
  async delete(id: number, user: AuthenticatedUser) {
    await this.chargerAvecPortee(id, user);
    return this.prisma.utilisateur.update({
      where: { id },
      data: { actif: false, tokenVersion: { increment: 1 } },
      select: AGENT_SELECT,
    });
  }

  private async chargerAvecPortee(id: number, user: AuthenticatedUser) {
    const agent = await this.prisma.utilisateur.findUnique({
      where: { id },
      select: { id: true, role: true, compagnieId: true },
    });
    if (!agent || agent.role !== UserRole.AGENT) {
      throw new NotFoundException(`Agent ${id} introuvable`);
    }
    assertCompagnieScope(user, agent.compagnieId ?? -1);
    return agent;
  }

  private filtrePortee(user: AuthenticatedUser): Prisma.UtilisateurWhereInput {
    if (user.role === UserRole.ADMIN) return {};
    return { compagnieId: user.compagnieId ?? -1 };
  }
}

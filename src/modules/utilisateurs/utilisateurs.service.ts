import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma.service';
import { ROLES_LIES_COMPAGNIE } from '../../config/constants';
import { paginer } from '../../common/pagination';
import { CreateUtilisateurDto } from './dto/create-utilisateur.dto';
import { UpdateUtilisateurDto } from './dto/update-utilisateur.dto';
import { SetRoleDto } from './dto/set-role.dto';

// Ne jamais inclure motDePasseHash dans une réponse API.
const UTILISATEUR_SAFE_SELECT = {
  id: true,
  nom: true,
  telephone: true,
  email: true,
  photoUrl: true,
  role: true,
  compagnieId: true,
  doitChangerMotDePasse: true,
  dateCreation: true,
};

@Injectable()
export class UtilisateursService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateUtilisateurDto) {
    const existant = await this.prisma.utilisateur.findUnique({
      where: { telephone: dto.telephone },
    });

    if (existant) {
      throw new ConflictException('Un utilisateur existe déjà avec ce numéro de téléphone');
    }

    const motDePasseHash = dto.motDePasse
      ? await bcrypt.hash(dto.motDePasse, 10)
      : null;

    return this.prisma.utilisateur.create({
      data: {
        nom: dto.nom,
        telephone: dto.telephone,
        email: dto.email,
        motDePasseHash,
      },
      select: UTILISATEUR_SAFE_SELECT,
    });
  }

  async findAll(skip = 0, take = 10) {
    return this.prisma.utilisateur.findMany({
      ...paginer(skip, take),
      select: UTILISATEUR_SAFE_SELECT,
    });
  }

  async findOne(id: number) {
    const utilisateur = await this.prisma.utilisateur.findUnique({
      where: { id },
      select: {
        ...UTILISATEUR_SAFE_SELECT,
        reservations: true,
      },
    });

    if (!utilisateur) {
      throw new NotFoundException(`Utilisateur ${id} introuvable`);
    }

    return utilisateur;
  }

  async findByTelephone(telephone: string) {
    return this.prisma.utilisateur.findUnique({
      where: { telephone },
    });
  }

  async update(id: number, dto: UpdateUtilisateurDto) {
    const utilisateur = await this.findOne(id);

    // Vérifier si le nouvel email existe déjà
    if (dto.email && dto.email !== utilisateur.email) {
      const existant = await this.prisma.utilisateur.findFirst({
        where: { email: dto.email, NOT: { id } },
      });
      if (existant) {
        throw new ConflictException('Cet email est déjà utilisé');
      }
    }

    const motDePasseHash = dto.motDePasse
      ? await bcrypt.hash(dto.motDePasse, 10)
      : undefined;

    return this.prisma.utilisateur.update({
      where: { id },
      data: {
        nom: dto.nom,
        email: dto.email,
        photoUrl: dto.photoUrl,
        // Un mot de passe changé ici (par soi-même ou un admin) n'est plus
        // "temporaire", quel que soit le chemin emprunté pour le poser.
        ...(motDePasseHash && { motDePasseHash, doitChangerMotDePasse: false }),
      },
      select: UTILISATEUR_SAFE_SELECT,
    });
  }

  async delete(id: number) {
    await this.findOne(id);
    return this.prisma.utilisateur.delete({
      where: { id },
      select: UTILISATEUR_SAFE_SELECT,
    });
  }

  // Attribution d'un rôle (et de la compagnie de rattachement) par l'admin
  // plateforme. tokenVersion est incrémenté pour couper les sessions en cours,
  // qui ré-obtiendront un token avec le nouveau rôle à la prochaine connexion.
  async setRole(id: number, dto: SetRoleDto) {
    await this.findOne(id);

    const besoinCompagnie = ROLES_LIES_COMPAGNIE.includes(dto.role);
    if (besoinCompagnie && !dto.compagnieId) {
      throw new BadRequestException(
        `compagnieId est requis pour le rôle "${dto.role}"`,
      );
    }

    if (besoinCompagnie) {
      const compagnie = await this.prisma.compagnie.findUnique({
        where: { id: dto.compagnieId },
        select: { id: true },
      });
      if (!compagnie) throw new NotFoundException('Compagnie introuvable');
    }

    return this.prisma.utilisateur.update({
      where: { id },
      data: {
        role: dto.role,
        // null pour user / admin, la compagnie sinon.
        compagnieId: besoinCompagnie ? dto.compagnieId : null,
        tokenVersion: { increment: 1 },
      },
      select: UTILISATEUR_SAFE_SELECT,
    });
  }

  async count() {
    return this.prisma.utilisateur.count();
  }
}

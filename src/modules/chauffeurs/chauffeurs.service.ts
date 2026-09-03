import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { UserRole } from '../../config/constants';
import { assertCompagnieScope, resoudreCompagnieCible } from '../../common/scope';
import { paginer } from '../../common/pagination';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateChauffeurDto } from './dto/create-chauffeur.dto';
import { UpdateChauffeurDto } from './dto/update-chauffeur.dto';

@Injectable()
export class ChauffeursService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateChauffeurDto, user: AuthenticatedUser) {
    const compagnieId = resoudreCompagnieCible(user, dto.compagnieId);
    return this.prisma.chauffeur.create({
      data: {
        compagnieId,
        nom: dto.nom,
        telephone: dto.telephone,
        numeroPermis: dto.numeroPermis,
      },
    });
  }

  // Un rôle lié à une compagnie ne voit que ses chauffeurs ; l'admin, tous.
  findAll(user: AuthenticatedUser, skip = 0, take = 10) {
    return this.prisma.chauffeur.findMany({
      where: this.filtrePortee(user),
      ...paginer(skip, take),
      orderBy: { nom: 'asc' },
    });
  }

  async findOne(id: number, user: AuthenticatedUser) {
    const chauffeur = await this.prisma.chauffeur.findUnique({ where: { id } });
    if (!chauffeur) throw new NotFoundException(`Chauffeur ${id} introuvable`);
    assertCompagnieScope(user, chauffeur.compagnieId);
    return chauffeur;
  }

  async update(id: number, dto: UpdateChauffeurDto, user: AuthenticatedUser) {
    await this.findOne(id, user); // existence + périmètre
    return this.prisma.chauffeur.update({ where: { id }, data: dto });
  }

  async delete(id: number, user: AuthenticatedUser) {
    await this.findOne(id, user);
    return this.prisma.chauffeur.delete({ where: { id } });
  }

  private filtrePortee(user: AuthenticatedUser): Prisma.ChauffeurWhereInput {
    if (user.role === UserRole.ADMIN) return {};
    return { compagnieId: user.compagnieId ?? -1 };
  }
}

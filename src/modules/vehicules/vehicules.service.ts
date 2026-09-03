import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { UserRole } from '../../config/constants';
import { assertCompagnieScope, resoudreCompagnieCible } from '../../common/scope';
import { paginer } from '../../common/pagination';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateVehiculeDto } from './dto/create-vehicule.dto';
import { UpdateVehiculeDto } from './dto/update-vehicule.dto';

@Injectable()
export class VehiculesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateVehiculeDto, user: AuthenticatedUser) {
    const compagnieId = resoudreCompagnieCible(user, dto.compagnieId);
    try {
      return await this.prisma.vehicule.create({
        data: {
          compagnieId,
          immatriculation: dto.immatriculation,
          typeVehicule: dto.typeVehicule,
          capacite: dto.capacite,
          statut: dto.statut ?? 'actif',
        },
      });
    } catch (e) {
      this.traduireErreurUnicite(e);
    }
  }

  // Un rôle lié à une compagnie ne voit que sa flotte ; l'admin plateforme, tout.
  findAll(user: AuthenticatedUser, skip = 0, take = 10) {
    return this.prisma.vehicule.findMany({
      where: this.filtrePortee(user),
      ...paginer(skip, take),
      orderBy: { immatriculation: 'asc' },
    });
  }

  async findOne(id: number, user: AuthenticatedUser) {
    const vehicule = await this.prisma.vehicule.findUnique({ where: { id } });
    if (!vehicule) throw new NotFoundException(`Véhicule ${id} introuvable`);
    assertCompagnieScope(user, vehicule.compagnieId);
    return vehicule;
  }

  async update(id: number, dto: UpdateVehiculeDto, user: AuthenticatedUser) {
    await this.findOne(id, user); // existence + périmètre
    try {
      return await this.prisma.vehicule.update({ where: { id }, data: dto });
    } catch (e) {
      this.traduireErreurUnicite(e);
    }
  }

  async delete(id: number, user: AuthenticatedUser) {
    await this.findOne(id, user);
    return this.prisma.vehicule.delete({ where: { id } });
  }

  private filtrePortee(user: AuthenticatedUser): Prisma.VehiculeWhereInput {
    if (user.role === UserRole.ADMIN) return {};
    return { compagnieId: user.compagnieId ?? -1 };
  }

  private traduireErreurUnicite(e: unknown): never {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new ConflictException('Cette immatriculation existe déjà');
    }
    throw e;
  }
}

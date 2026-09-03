import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateVilleDto } from './dto/create-ville.dto';

@Injectable()
export class VillesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateVilleDto) {
    const existant = await this.prisma.ville.findUnique({
      where: { nom: dto.nom },
    });

    if (existant) {
      throw new ConflictException(`La ville "${dto.nom}" existe déjà`);
    }

    return this.prisma.ville.create({
      data: { nom: dto.nom },
    });
  }

  async findAll() {
    return this.prisma.ville.findMany({
      orderBy: { nom: 'asc' },
    });
  }

  async findOne(id: number) {
    const ville = await this.prisma.ville.findUnique({
      where: { id },
      include: {
        trajetsDepart: true,
        trajetsArrivee: true,
      },
    });

    if (!ville) {
      throw new NotFoundException(`Ville ${id} introuvable`);
    }

    return ville;
  }

  async findByNom(nom: string) {
    return this.prisma.ville.findUnique({
      where: { nom },
    });
  }

  async update(id: number, dto: CreateVilleDto) {
    await this.findOne(id);

    const existant = await this.prisma.ville.findFirst({
      where: { nom: dto.nom, NOT: { id } },
    });

    if (existant) {
      throw new ConflictException(`La ville "${dto.nom}" existe déjà`);
    }

    return this.prisma.ville.update({
      where: { id },
      data: { nom: dto.nom },
    });
  }

  async delete(id: number) {
    await this.findOne(id);
    return this.prisma.ville.delete({
      where: { id },
    });
  }

  async count() {
    return this.prisma.ville.count();
  }
}

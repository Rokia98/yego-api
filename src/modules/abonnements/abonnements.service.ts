import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { assertCompagnieScope } from '../../common/scope';
import { paginer } from '../../common/pagination';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateAbonnementDto } from './dto/create-abonnement.dto';
import { UpdateAbonnementDto } from './dto/update-abonnement.dto';

@Injectable()
export class AbonnementsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateAbonnementDto) {
    const compagnie = await this.prisma.compagnie.findUnique({
      where: { id: dto.compagnieId },
      select: { id: true },
    });
    if (!compagnie) throw new NotFoundException('Compagnie introuvable');

    const dateDebut = new Date(dto.dateDebut);
    const dateFin = new Date(dto.dateFin);
    if (dateFin <= dateDebut) {
      throw new BadRequestException(
        'La date de fin doit être postérieure à la date de début',
      );
    }

    return this.prisma.abonnement.create({
      data: {
        compagnieId: dto.compagnieId,
        plan: dto.plan,
        montant: dto.montant,
        dateDebut,
        dateFin,
        statut: 'actif',
      },
    });
  }

  findAll(params: {
    compagnieId?: number;
    statut?: string;
    skip?: number;
    take?: number;
  }) {
    const where: Prisma.AbonnementWhereInput = {};
    if (params.compagnieId) where.compagnieId = params.compagnieId;
    if (params.statut) where.statut = params.statut;
    return this.prisma.abonnement.findMany({
      where,
      ...paginer(params.skip, params.take),
      orderBy: { dateFin: 'desc' },
      include: { compagnie: { select: { id: true, nom: true } } },
    });
  }

  // Admin : n'importe quelle compagnie. company_admin : uniquement la sienne.
  async findByCompagnie(compagnieId: number, user: AuthenticatedUser) {
    assertCompagnieScope(user, compagnieId);
    return this.prisma.abonnement.findMany({
      where: { compagnieId },
      orderBy: { dateFin: 'desc' },
    });
  }

  async update(id: number, dto: UpdateAbonnementDto) {
    const abonnement = await this.prisma.abonnement.findUnique({ where: { id } });
    if (!abonnement) throw new NotFoundException(`Abonnement ${id} introuvable`);

    const dateFin = dto.dateFin ? new Date(dto.dateFin) : undefined;
    if (dateFin && dateFin <= abonnement.dateDebut) {
      throw new BadRequestException(
        'La date de fin doit être postérieure à la date de début',
      );
    }

    return this.prisma.abonnement.update({
      where: { id },
      data: {
        montant: dto.montant,
        dateFin,
        statut: dto.statut,
      },
    });
  }
}

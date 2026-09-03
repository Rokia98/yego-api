import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { assertCompagnieScope } from '../../common/scope';
import {
  assertCompagnieOperationnelle,
  filtreCompagnieOperationnelle,
} from '../../common/compagnie';
import { paginer } from '../../common/pagination';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateDepartDto } from './dto/create-depart.dto';
import { UpdateDepartDto } from './dto/update-depart.dto';

const INCLUDE_COMPLET = {
  trajet: { include: { compagnie: true, villeDepart: true, villeArrivee: true } },
  vehicule: true,
  chauffeur: true,
};

@Injectable()
export class DepartsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateDepartDto, user: AuthenticatedUser) {
    const trajet = await this.prisma.trajet.findUnique({
      where: { id: dto.trajetId },
      select: { id: true, compagnieId: true },
    });
    if (!trajet) throw new NotFoundException('Trajet introuvable');
    assertCompagnieScope(user, trajet.compagnieId);
    await assertCompagnieOperationnelle(this.prisma, trajet.compagnieId);
    await this.assertFlotteCoherente(trajet.compagnieId, dto.vehiculeId, dto.chauffeurId);

    return this.prisma.depart.create({
      data: {
        trajetId: dto.trajetId,
        dateDepart: new Date(dto.dateDepart),
        placesTotales: dto.placesTotales,
        placesDisponibles: dto.placesTotales,
        vehiculeId: dto.vehiculeId,
        chauffeurId: dto.chauffeurId,
      },
      include: INCLUDE_COMPLET,
    });
  }

  findAll(skip = 0, take = 10) {
    return this.prisma.depart.findMany({
      ...paginer(skip, take),
      include: INCLUDE_COMPLET,
      orderBy: { dateDepart: 'asc' },
    });
  }

  async findOne(id: number) {
    const depart = await this.prisma.depart.findUnique({
      where: { id },
      include: { ...INCLUDE_COMPLET, reservations: true },
    });

    if (!depart) {
      throw new NotFoundException(`Départ ${id} introuvable`);
    }

    return depart;
  }

  // Recherche voyageur : ville de départ, ville d'arrivée, date (ou fourchette).
  // Ne renvoie que les départs vendables : compagnie active + abonnement à jour,
  // trajet actif, départ planifié avec des places.
  async rechercher(
    villeDepart: string,
    villeArrivee: string,
    date: string,
    dateFin?: string,
  ) {
    const dateFilter = dateFin
      ? { gte: new Date(date), lte: new Date(dateFin) }
      : new Date(date);
    return this.prisma.depart.findMany({
      where: {
        dateDepart: dateFilter,
        statut: 'planifie',
        placesDisponibles: { gt: 0 },
        trajet: {
          statut: 'actif',
          villeDepart: { nom: { equals: villeDepart, mode: 'insensitive' } },
          villeArrivee: { nom: { equals: villeArrivee, mode: 'insensitive' } },
          compagnie: filtreCompagnieOperationnelle(),
        },
      },
      include: {
        trajet: {
          include: { compagnie: true, villeDepart: true, villeArrivee: true },
        },
        vehicule: true,
      },
      orderBy: { trajet: { heureDepart: 'asc' } },
    });
  }

  async update(id: number, dto: UpdateDepartDto, user: AuthenticatedUser) {
    const depart = await this.chargerAvecPortee(id, user);
    await assertCompagnieOperationnelle(this.prisma, depart.trajet.compagnieId);
    await this.assertFlotteCoherente(
      depart.trajet.compagnieId,
      dto.vehiculeId,
      dto.chauffeurId,
    );
    return this.prisma.depart.update({
      where: { id },
      data: {
        ...(dto.vehiculeId && { vehiculeId: dto.vehiculeId }),
        ...(dto.chauffeurId && { chauffeurId: dto.chauffeurId }),
        ...(dto.dateDepart && { dateDepart: new Date(dto.dateDepart) }),
        ...(dto.placesTotales !== undefined && { placesTotales: dto.placesTotales }),
        ...(dto.statut && { statut: dto.statut }),
      },
      include: INCLUDE_COMPLET,
    });
  }

  async delete(id: number, user: AuthenticatedUser) {
    await this.chargerAvecPortee(id, user);
    return this.prisma.depart.delete({ where: { id } });
  }

  count() {
    return this.prisma.depart.count();
  }

  private async chargerAvecPortee(id: number, user: AuthenticatedUser) {
    const depart = await this.prisma.depart.findUnique({
      where: { id },
      include: { trajet: { select: { compagnieId: true } } },
    });
    if (!depart) throw new NotFoundException(`Départ ${id} introuvable`);
    assertCompagnieScope(user, depart.trajet.compagnieId);
    return depart;
  }

  // Le véhicule et le chauffeur affectés doivent appartenir à la même compagnie
  // que le trajet.
  private async assertFlotteCoherente(
    compagnieId: number,
    vehiculeId?: number,
    chauffeurId?: number,
  ) {
    if (vehiculeId) {
      const vehicule = await this.prisma.vehicule.findUnique({
        where: { id: vehiculeId },
        select: { compagnieId: true },
      });
      if (!vehicule) throw new NotFoundException('Véhicule introuvable');
      if (vehicule.compagnieId !== compagnieId) {
        throw new BadRequestException(
          "Le véhicule n'appartient pas à la compagnie du trajet",
        );
      }
    }
    if (chauffeurId) {
      const chauffeur = await this.prisma.chauffeur.findUnique({
        where: { id: chauffeurId },
        select: { compagnieId: true },
      });
      if (!chauffeur) throw new NotFoundException('Chauffeur introuvable');
      if (chauffeur.compagnieId !== compagnieId) {
        throw new BadRequestException(
          "Le chauffeur n'appartient pas à la compagnie du trajet",
        );
      }
    }
  }
}

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { assertCompagnieScope } from '../../common/scope';
import { paginer } from '../../common/pagination';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateCompagnieDto } from './dto/create-compagnie.dto';
import { UpdateCompagnieDto } from './dto/update-compagnie.dto';
import { ModererCompagnieDto } from './dto/moderer-compagnie.dto';

// Pas d'abonnements ici : infos de facturation réservées à /abonnements
// (admin / company_admin). GET /compagnies est public.
const INCLUDE_COMPLET = {
  vehicules: true,
  chauffeurs: true,
  trajets: true,
};

@Injectable()
export class CompagniesService {
  constructor(private prisma: PrismaService) {}

  // Création : réservée à l'admin plateforme. La compagnie démarre 'en_attente'.
  create(dto: CreateCompagnieDto) {
    return this.prisma.compagnie.create({
      data: { ...dto, statut: 'en_attente' },
      include: { ...INCLUDE_COMPLET, utilisateurs: { where: { role: 'company_admin' }, select: { id: true, nom: true, telephone: true } } },
    });
  }

  findAll(skip = 0, take = 10) {
    return this.prisma.compagnie.findMany({
      ...paginer(skip, take),
      include: INCLUDE_COMPLET,
    });
  }

  async findOne(id: number) {
    const compagnie = await this.prisma.compagnie.findUnique({
      where: { id },
      include: { ...INCLUDE_COMPLET, utilisateurs: { where: { role: 'company_admin' }, select: { id: true, nom: true, telephone: true } } },
    });

    if (!compagnie) throw new NotFoundException('Compagnie introuvable');
    return compagnie;
  }

  findByStatut(statut: string, skip = 0, take = 10) {
    return this.prisma.compagnie.findMany({ where: { statut }, skip, take });
  }

  // Mise à jour des informations : l'admin plateforme pour toutes, un
  // company_admin uniquement pour sa propre compagnie (jamais le statut).
  async update(id: number, dto: UpdateCompagnieDto, user: AuthenticatedUser) {
    await this.assertExiste(id);
    assertCompagnieScope(user, id);
    return this.prisma.compagnie.update({
      where: { id },
      data: dto,
      include: INCLUDE_COMPLET,
    });
  }

  // Modération : changement de statut (activation / suspension). Admin uniquement.
  async moderer(id: number, dto: ModererCompagnieDto) {
    await this.assertExiste(id);
    return this.prisma.compagnie.update({
      where: { id },
      data: { statut: dto.statut },
    });
  }

  async delete(id: number) {
    await this.assertExiste(id);

    // Bloque la suppression si des réservations existent (FK Restrict côté
    // Depart → Reservation) : message clair plutôt qu'une erreur 500.
    const reservations = await this.prisma.reservation.count({
      where: { depart: { trajet: { compagnieId: id } } },
    });
    if (reservations > 0) {
      throw new ConflictException(
        `Impossible de supprimer : ${reservations} réservation(s) rattachée(s). Suspendez la compagnie à la place.`,
      );
    }

    try {
      return await this.prisma.compagnie.delete({ where: { id } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        throw new ConflictException(
          'Impossible de supprimer : des données dépendent encore de cette compagnie',
        );
      }
      throw e;
    }
  }

  count() {
    return this.prisma.compagnie.count();
  }

  private async assertExiste(id: number) {
    const c = await this.prisma.compagnie.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException('Compagnie introuvable');
  }
}

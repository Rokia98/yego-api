import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { assertCompagnieScope, resoudreCompagnieCible } from '../../common/scope';
import { assertCompagnieOperationnelle } from '../../common/compagnie';
import { paginer } from '../../common/pagination';
import { notifierVoyageursDeparts } from '../../common/notifier-voyageurs';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateTrajetDto } from './dto/create-trajet.dto';
import { UpdateTrajetDto } from './dto/update-trajet.dto';

const INCLUDE_VILLES = {
  villeDepart: true,
  villeArrivee: true,
  compagnie: true,
};

const hhmm = (t: Date | null | undefined): string | null =>
  t ? t.toISOString().slice(11, 16) : null;

@Injectable()
export class TrajetsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async create(dto: CreateTrajetDto, user: AuthenticatedUser) {
    // Un company_admin ne peut créer un trajet que pour SA compagnie ; l'admin
    // plateforme doit préciser compagnieId (celui du DTO).
    const compagnieId = resoudreCompagnieCible(user, dto.compagnieId);
    await assertCompagnieOperationnelle(this.prisma, compagnieId);
    return this.prisma.trajet.create({
      data: {
        compagnieId,
        villeDepartId: dto.villeDepartId,
        villeArriveeId: dto.villeArriveeId,
        heureDepart: new Date(`1970-01-01T${dto.heureDepart}:00Z`),
        heureArriveeEstimee: dto.heureArriveeEstimee
          ? new Date(`1970-01-01T${dto.heureArriveeEstimee}:00Z`)
          : undefined,
        prix: dto.prix,
        joursRecurrence: dto.joursRecurrence,
      },
      include: INCLUDE_VILLES,
    });
  }

  findAll(skip = 0, take = 10) {
    return this.prisma.trajet.findMany({
      ...paginer(skip, take),
      include: INCLUDE_VILLES,
      orderBy: { heureDepart: 'asc' },
    });
  }

  async findOne(id: number) {
    const trajet = await this.prisma.trajet.findUnique({
      where: { id },
      include: { ...INCLUDE_VILLES, departs: true },
    });

    if (!trajet) {
      throw new NotFoundException(`Trajet ${id} introuvable`);
    }

    return trajet;
  }

  findByCompagnie(compagnieId: number, skip = 0, take = 10) {
    return this.prisma.trajet.findMany({
      where: { compagnieId },
      ...paginer(skip, take),
      include: { villeDepart: true, villeArrivee: true },
      orderBy: { heureDepart: 'asc' },
    });
  }

  async update(id: number, dto: UpdateTrajetDto, user: AuthenticatedUser) {
    const trajet = await this.chargerAvecPortee(id, user);
    await assertCompagnieOperationnelle(this.prisma, trajet.compagnieId);
    // Interdit de transférer un trajet vers une autre compagnie via l'update
    // pour un rôle lié à une compagnie.
    const compagnieId =
      dto.compagnieId !== undefined
        ? resoudreCompagnieCible(user, dto.compagnieId)
        : trajet.compagnieId;

    const miseAJour = await this.prisma.trajet.update({
      where: { id },
      data: {
        compagnieId,
        villeDepartId: dto.villeDepartId,
        villeArriveeId: dto.villeArriveeId,
        prix: dto.prix,
        joursRecurrence: dto.joursRecurrence,
        statut: dto.statut,
        ...(dto.heureDepart && {
          heureDepart: new Date(`1970-01-01T${dto.heureDepart}:00Z`),
        }),
        ...(dto.heureArriveeEstimee && {
          heureArriveeEstimee: new Date(`1970-01-01T${dto.heureArriveeEstimee}:00Z`),
        }),
      },
      include: INCLUDE_VILLES,
    });

    await this.notifierChangementHoraire(trajet, miseAJour);
    return miseAJour;
  }

  // Prévient les voyageurs si l'heure de départ (ou d'arrivée) d'un trajet a
  // bougé : leurs départs à venir encore actifs sont impactés.
  private async notifierChangementHoraire(
    avant: { heureDepart: Date; heureArriveeEstimee: Date | null },
    apres: {
      id: number;
      heureDepart: Date;
      heureArriveeEstimee: Date | null;
      villeDepart: { nom: string };
      villeArrivee: { nom: string };
    },
  ) {
    const depAvant = hhmm(avant.heureDepart);
    const depApres = hhmm(apres.heureDepart);
    if (depAvant === depApres) return;

    const aujourdhui = new Date();
    aujourdhui.setUTCHours(0, 0, 0, 0);
    const departs = await this.prisma.depart.findMany({
      where: {
        trajetId: apres.id,
        dateDepart: { gte: aujourdhui },
        statut: { in: ['planifie', 'en_route'] },
      },
      select: { id: true },
    });

    await notifierVoyageursDeparts(
      this.prisma,
      this.notifications,
      departs.map((d) => d.id),
      {
        type: 'depart.horaire_modifie',
        titre: "Changement d'horaire",
        corps: `${apres.villeDepart.nom} → ${apres.villeArrivee.nom} : le départ passe de ${depAvant} à ${depApres}.`,
        donnees: { trajetId: apres.id, ancienneHeure: depAvant ?? '', nouvelleHeure: depApres ?? '' },
      },
    );
  }

  async delete(id: number, user: AuthenticatedUser) {
    await this.chargerAvecPortee(id, user);
    return this.prisma.trajet.delete({ where: { id } });
  }

  count() {
    return this.prisma.trajet.count();
  }

  private async chargerAvecPortee(id: number, user: AuthenticatedUser) {
    const trajet = await this.prisma.trajet.findUnique({ where: { id } });
    if (!trajet) throw new NotFoundException(`Trajet ${id} introuvable`);
    assertCompagnieScope(user, trajet.compagnieId);
    return trajet;
  }
}

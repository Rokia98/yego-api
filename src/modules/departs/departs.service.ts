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
import { siegesOccupesDepart } from '../../common/sieges';
import { notifierVoyageursDeparts } from '../../common/notifier-voyageurs';
import { RECHERCHE_DEPART } from '../../config/constants';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateDepartDto } from './dto/create-depart.dto';
import { UpdateDepartDto } from './dto/update-depart.dto';
import { ListeDepartsDto } from './dto/liste-departs.dto';

const INCLUDE_COMPLET = {
  trajet: { include: { compagnie: true, villeDepart: true, villeArrivee: true } },
  vehicule: true,
  chauffeur: true,
};

// Routes publiques (GET /departs, GET /departs/:id) : jamais de données
// personnelles — ni passagers (voir /reservations, cloisonné), ni téléphone /
// permis du chauffeur (voir /chauffeurs, réservé au personnel).
const INCLUDE_PUBLIC = {
  trajet: { include: { compagnie: true, villeDepart: true, villeArrivee: true } },
  vehicule: true,
  chauffeur: { select: { id: true, nom: true } },
};

@Injectable()
export class DepartsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

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

  findAll(f: ListeDepartsDto = {}) {
    const ordre = f.ordre ?? 'asc';
    return this.prisma.depart.findMany({
      where: {
        ...(f.compagnieId && { trajet: { compagnieId: f.compagnieId } }),
        ...(f.trajetId && { trajetId: f.trajetId }),
        ...(f.statut && { statut: f.statut }),
        ...((f.du || f.au) && {
          dateDepart: {
            ...(f.du && { gte: new Date(`${f.du}T00:00:00Z`) }),
            ...(f.au && { lte: new Date(`${f.au}T00:00:00Z`) }),
          },
        }),
      },
      ...paginer(f.skip, f.take),
      include: INCLUDE_PUBLIC,
      orderBy: [{ dateDepart: ordre }, { trajet: { heureDepart: ordre } }, { id: ordre }],
    });
  }

  async findOne(id: number) {
    const depart = await this.prisma.depart.findUnique({
      where: { id },
      include: INCLUDE_PUBLIC,
    });

    if (!depart) {
      throw new NotFoundException(`Départ ${id} introuvable`);
    }

    return depart;
  }

  // Recherche voyageur : ville de départ, ville d'arrivée, fourchette de dates.
  // Ne renvoie que les départs vendables : compagnie active + abonnement à jour,
  // trajet actif, départ planifié avec des places.
  // Villes appariées sans tenir compte de la casse NI des accents ("bouake"
  // trouve "Bouaké"). Dates : voir resoudreFourchette / RECHERCHE_DEPART.
  async rechercher(
    villeDepart: string,
    villeArrivee: string,
    date?: string,
    dateFin?: string,
  ) {
    const [departId, arriveeId] = await Promise.all([
      this.resoudreVilleId(villeDepart),
      this.resoudreVilleId(villeArrivee),
    ]);
    if (departId === null || arriveeId === null) return [];

    const { debut, fin } = this.resoudreFourchette(date, dateFin);

    return this.prisma.depart.findMany({
      where: {
        dateDepart: { gte: debut, lte: fin },
        statut: 'planifie',
        placesDisponibles: { gt: 0 },
        trajet: {
          statut: 'actif',
          villeDepartId: departId,
          villeArriveeId: arriveeId,
          compagnie: filtreCompagnieOperationnelle(),
        },
      },
      include: {
        trajet: {
          include: { compagnie: true, villeDepart: true, villeArrivee: true },
        },
        vehicule: true,
      },
      orderBy: [{ dateDepart: 'asc' }, { trajet: { heureDepart: 'asc' } }],
    });
  }

  // Résout un nom de ville en id, insensible à la casse et aux accents
  // (extension Postgres `unaccent`). Renvoie null si aucune ville ne correspond.
  private async resoudreVilleId(nom: string): Promise<number | null> {
    const lignes = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM villes
      WHERE unaccent(lower(nom)) = unaccent(lower(${nom}))
      LIMIT 1
    `;
    return lignes[0]?.id ?? null;
  }

  // `date` absente → aujourd'hui (00:00). `dateFin` absente → date + fenêtre par
  // défaut. La fenêtre est bornée à FENETRE_MAX_JOURS.
  private resoudreFourchette(date?: string, dateFin?: string) {
    const debut = date ? new Date(date) : new Date();
    debut.setHours(0, 0, 0, 0);

    const maxFin = new Date(debut);
    maxFin.setDate(maxFin.getDate() + RECHERCHE_DEPART.FENETRE_MAX_JOURS);

    let fin: Date;
    if (dateFin) {
      fin = new Date(dateFin);
      fin.setHours(23, 59, 59, 999);
      if (fin > maxFin) fin = maxFin;
    } else {
      fin = new Date(debut);
      fin.setDate(fin.getDate() + RECHERCHE_DEPART.FENETRE_DEFAUT_JOURS);
    }
    return { debut, fin };
  }

  // Plan de salle côté voyageur avant réservation : sièges déjà pris sur ce
  // départ (tickets émis + sièges retenus par les réservations confirmées, le
  // choix se faisant avant paiement).
  async sieges(id: number) {
    const depart = await this.prisma.depart.findUnique({
      where: { id },
      select: {
        placesTotales: true,
        placesDisponibles: true,
        vehicule: { select: { capacite: true } },
      },
    });
    if (!depart) throw new NotFoundException(`Départ ${id} introuvable`);

    const occupes = [...(await siegesOccupesDepart(this.prisma, id))].sort();
    const placesVendues = depart.placesTotales - depart.placesDisponibles;

    return {
      placesTotales: depart.vehicule?.capacite ?? depart.placesTotales,
      placesDisponibles: depart.placesDisponibles,
      // Nombre total de places vendues (toutes réservations non libérées).
      placesVendues,
      // Sièges précis déjà pris (choix voyageur + tickets émis).
      occupes,
      // Places vendues sans siège attribué (placement libre) : le plan ne peut
      // pas les situer ; le client bloque ce nombre de sièges ou l'affiche.
      placesSansSiege: Math.max(0, placesVendues - occupes.length),
    };
  }

  async update(id: number, dto: UpdateDepartDto, user: AuthenticatedUser) {
    const depart = await this.chargerAvecPortee(id, user);
    await assertCompagnieOperationnelle(this.prisma, depart.trajet.compagnieId);
    await this.assertFlotteCoherente(
      depart.trajet.compagnieId,
      dto.vehiculeId,
      dto.chauffeurId,
    );
    const misAJour = await this.prisma.depart.update({
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

    // Date de départ décalée → prévenir les voyageurs concernés.
    const ancienneDate = depart.dateDepart.toISOString().slice(0, 10);
    const nouvelleDate = misAJour.dateDepart.toISOString().slice(0, 10);
    if (ancienneDate !== nouvelleDate) {
      await notifierVoyageursDeparts(this.prisma, this.notifications, [id], {
        type: 'depart.date_modifiee',
        titre: 'Changement de date',
        corps: `${misAJour.trajet.villeDepart.nom} → ${misAJour.trajet.villeArrivee.nom} : le départ est reporté du ${ancienneDate} au ${nouvelleDate}.`,
        donnees: { departId: id, ancienneDate, nouvelleDate },
      });
    }
    return misAJour;
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

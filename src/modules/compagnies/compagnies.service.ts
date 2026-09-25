import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma.service';
import { assertCompagnieScope } from '../../common/scope';
import { paginer } from '../../common/pagination';
import { genererMotDePasse } from '../../common/motdepasse';
import { ROLES_LIES_COMPAGNIE, UserRole } from '../../config/constants';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateCompagnieDto } from './dto/create-compagnie.dto';
import { UpdateCompagnieDto } from './dto/update-compagnie.dto';
import { ModererCompagnieDto } from './dto/moderer-compagnie.dto';
import { CreerCompteAdminDto } from './dto/creer-compte-admin.dto';

const BCRYPT_ROUNDS = 12;

// Pas d'abonnements ici : infos de facturation réservées à /abonnements
// (admin / company_admin). GET /compagnies est public.
// Ni téléphone ni numéro de permis des chauffeurs (données personnelles) :
// le détail passe par /chauffeurs, réservé au personnel de la compagnie.
const INCLUDE_COMPLET = {
  vehicules: true,
  chauffeurs: { select: { id: true, nom: true } },
  trajets: true,
};

// Gestionnaire(s) de la compagnie. Le numéro (qui sert aussi d'identifiant de
// connexion) n'est inclus que pour le personnel habilité — voir findOne.
const gestionnaires = (avecTelephone: boolean) => ({
  utilisateurs: {
    where: { role: 'company_admin' },
    select: { id: true, nom: true, telephone: avecTelephone },
  },
});

@Injectable()
export class CompagniesService {
  constructor(private prisma: PrismaService) {}

  // Création : réservée à l'admin plateforme. La compagnie démarre 'en_attente'.
  create(dto: CreateCompagnieDto) {
    return this.prisma.compagnie.create({
      data: { ...dto, statut: 'en_attente' },
      include: { ...INCLUDE_COMPLET, ...gestionnaires(true) },
    });
  }

  findAll(skip = 0, take = 10) {
    return this.prisma.compagnie.findMany({
      ...paginer(skip, take),
      include: INCLUDE_COMPLET,
    });
  }

  // `user` : appelant identifié (optionnel, route publique). Admin plateforme
  // ou personnel de cette compagnie → téléphone du gestionnaire inclus.
  async findOne(id: number, user?: AuthenticatedUser | null) {
    const habilite =
      user?.role === UserRole.ADMIN ||
      (user != null &&
        ROLES_LIES_COMPAGNIE.includes(user.role) &&
        user.compagnieId === id);
    const compagnie = await this.prisma.compagnie.findUnique({
      where: { id },
      include: { ...INCLUDE_COMPLET, ...gestionnaires(habilite) },
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

  // Crée (ou régénère le mot de passe) du compte gestionnaire d'une compagnie.
  // Réservé à l'admin plateforme (perm compagnie:create sur le contrôleur).
  // Le mot de passe temporaire n'est renvoyé qu'ici, une seule fois.
  async creerCompteAdmin(id: number, dto: CreerCompteAdminDto) {
    await this.assertExiste(id);

    const motDePasse = genererMotDePasse();
    const motDePasseHash = await bcrypt.hash(motDePasse, BCRYPT_ROUNDS);

    const existant = await this.prisma.utilisateur.findUnique({
      where: { telephone: dto.telephone },
      select: { id: true, role: true, compagnieId: true },
    });

    if (existant) {
      const estAdminDeCetteCompagnie =
        existant.role === UserRole.COMPANY_ADMIN &&
        existant.compagnieId === id;
      if (!estAdminDeCetteCompagnie) {
        throw new ConflictException(
          'Ce numéro est déjà rattaché à un autre compte',
        );
      }
      // Régénération : nouveau mot de passe + invalidation des sessions en cours.
      const maj = await this.prisma.utilisateur.update({
        where: { id: existant.id },
        data: {
          nom: dto.nom,
          email: dto.email,
          motDePasseHash,
          actif: true,
          doitChangerMotDePasse: true,
          tokenVersion: { increment: 1 },
        },
        select: { id: true, nom: true, telephone: true },
      });
      return { ...maj, motDePasseTemporaire: motDePasse };
    }

    const cree = await this.prisma.utilisateur.create({
      data: {
        nom: dto.nom,
        telephone: dto.telephone,
        email: dto.email,
        motDePasseHash,
        role: UserRole.COMPANY_ADMIN,
        compagnieId: id,
        actif: true,
        doitChangerMotDePasse: true,
      },
      select: { id: true, nom: true, telephone: true },
    });
    return { ...cree, motDePasseTemporaire: motDePasse };
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

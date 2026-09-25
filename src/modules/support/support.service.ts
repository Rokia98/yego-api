import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PERMISSIONS, aLaPermission } from '../../config/permissions';
import { ROLES_LIES_COMPAGNIE, UserRole } from '../../config/constants';
import { assertCompagnieScope } from '../../common/scope';
import { paginer } from '../../common/pagination';
import {
  AjouterMessageDto,
  CreerDemandeDto,
  ListeDemandesDto,
  ModifierDemandeDto,
} from './dto/support.dto';

const DEMANDE_INCLUDE = {
  auteur: { select: { id: true, nom: true, telephone: true, role: true } },
  compagnie: { select: { id: true, nom: true } },
} satisfies Prisma.DemandeSupportInclude;

const MESSAGE_AUTEUR = {
  auteur: { select: { id: true, nom: true, role: true } },
} satisfies Prisma.MessageSupportInclude;

type Demande = {
  id: number;
  auteurId: number;
  auteurRole: string;
  compagnieId: number | null;
  statut: string;
  sujet: string;
};

/**
 * Support : demandes d'assistance.
 *
 * Portée (lecture) : voyageur / agent → leurs demandes ; company_admin → celles
 * de sa compagnie (personnel ET voyageurs rattachés par leur réservation) ;
 * admin → toutes.
 *
 * Traitant (répondre en tant que support, changer statut/priorité) : admin
 * partout ; company_admin sur les demandes VOYAGEURS de sa compagnie. Les
 * demandes du personnel d'une compagnie sont traitées par l'équipe Yègo.
 */
@Injectable()
export class SupportService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  async creer(dto: CreerDemandeDto, user: AuthenticatedUser) {
    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException(
        "L'équipe Yègo traite les demandes, elle n'en ouvre pas",
      );
    }

    // compagnieId dérivé côté serveur, jamais pris du client.
    let compagnieId: number | null = ROLES_LIES_COMPAGNIE.includes(user.role)
      ? user.compagnieId
      : null;

    if (dto.reservationId) {
      const resa = await this.prisma.reservation.findUnique({
        where: { id: dto.reservationId },
        select: {
          utilisateurId: true,
          depart: { select: { trajet: { select: { compagnieId: true } } } },
        },
      });
      if (!resa) throw new NotFoundException('Réservation introuvable');
      const compagnieResa = resa.depart.trajet.compagnieId;
      if (user.role === UserRole.USER) {
        if (resa.utilisateurId !== user.userId) {
          throw new ForbiddenException("Cette réservation n'est pas la vôtre");
        }
        compagnieId = compagnieResa;
      } else {
        assertCompagnieScope(user, compagnieResa);
      }
    }

    const maintenant = new Date();
    return this.prisma.demandeSupport.create({
      data: {
        auteurId: user.userId,
        auteurRole: user.role,
        compagnieId,
        reservationId: dto.reservationId ?? null,
        categorie: dto.categorie,
        sujet: dto.sujet,
        dernierMessageA: maintenant,
        nbMessages: 1,
        messages: {
          create: {
            auteurId: user.userId,
            auteurRole: user.role,
            contenu: dto.message,
            dateCreation: maintenant,
          },
        },
      },
      include: {
        ...DEMANDE_INCLUDE,
        messages: { include: MESSAGE_AUTEUR, orderBy: { dateCreation: 'asc' } },
      },
    });
  }

  lister(user: AuthenticatedUser, f: ListeDemandesDto = {}) {
    return this.prisma.demandeSupport.findMany({
      where: { AND: [this.portee(user), ...this.filtres(user, f)] },
      ...paginer(f.skip, f.take),
      include: DEMANDE_INCLUDE,
      orderBy: [{ dernierMessageA: 'desc' }, { id: 'desc' }],
    });
  }

  async detail(id: number, user: AuthenticatedUser) {
    const demande = await this.charger(id, user);
    const messages = await this.prisma.messageSupport.findMany({
      where: {
        demandeId: id,
        // Notes internes : équipe Yègo uniquement.
        ...(user.role !== UserRole.ADMIN && { interne: false }),
      },
      include: MESSAGE_AUTEUR,
      orderBy: [{ dateCreation: 'asc' }, { id: 'asc' }],
    });
    return { ...demande, messages };
  }

  async ajouterMessage(id: number, dto: AjouterMessageDto, user: AuthenticatedUser) {
    const demande = await this.charger(id, user);
    const interne = dto.interne === true;
    if (interne && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Les notes internes sont réservées à l’équipe Yègo');
    }
    if (demande.statut === 'fermee') {
      throw new BadRequestException('Cette demande est fermée');
    }

    const traitant = this.estTraitant(user, demande);
    const auteur = demande.auteurId === user.userId;
    if (!traitant && !auteur) {
      throw new ForbiddenException('Vous ne pouvez pas répondre à cette demande');
    }

    // Transitions : réponse du support sur une demande ouverte → en_cours ;
    // relance de l'auteur sur une demande résolue → réouverte. Une note
    // interne ne change ni le statut ni le fil visible (compteur, date).
    let statut: string | undefined;
    if (!interne && traitant && demande.statut === 'ouverte') statut = 'en_cours';
    if (!interne && auteur && demande.statut === 'resolue') statut = 'ouverte';

    const maintenant = new Date();
    const [message] = await this.prisma.$transaction([
      this.prisma.messageSupport.create({
        data: {
          demandeId: id,
          auteurId: user.userId,
          auteurRole: user.role,
          contenu: dto.contenu,
          interne,
          dateCreation: maintenant,
        },
        include: MESSAGE_AUTEUR,
      }),
      this.prisma.demandeSupport.update({
        where: { id },
        data: interne
          ? {}
          : {
              dernierMessageA: maintenant,
              nbMessages: { increment: 1 },
              ...(statut && { statut }),
            },
      }),
    ]);

    if (!interne && traitant && !auteur) {
      await this.notifications.notifier(demande.auteurId, {
        type: 'support.reponse',
        titre: 'Réponse du support',
        corps: `Nouvelle réponse à votre demande « ${demande.sujet} ».`,
        donnees: { demandeId: id },
      });
    }
    return message;
  }

  async modifier(id: number, dto: ModifierDemandeDto, user: AuthenticatedUser) {
    if (dto.statut === undefined && dto.priorite === undefined) {
      throw new BadRequestException('Rien à modifier (statut ou priorite)');
    }
    const demande = await this.charger(id, user);
    const traitant = this.estTraitant(user, demande);
    const auteur = demande.auteurId === user.userId;

    if (!traitant) {
      // L'auteur peut seulement clôturer sa propre demande.
      if (!auteur || dto.priorite !== undefined || dto.statut !== 'fermee') {
        throw new ForbiddenException(
          'Vous pouvez seulement fermer votre propre demande',
        );
      }
    }

    const maj = await this.prisma.demandeSupport.update({
      where: { id },
      data: {
        ...(dto.statut && { statut: dto.statut }),
        ...(dto.priorite && { priorite: dto.priorite }),
      },
      include: DEMANDE_INCLUDE,
    });

    if (traitant && dto.statut && dto.statut !== demande.statut) {
      await this.audit.record({
        action: 'support.statut',
        entite: 'demande_support',
        entiteId: id,
        acteurId: user.userId,
        acteurRole: user.role,
        metadata: { avant: demande.statut, apres: dto.statut },
      });
      if (dto.statut === 'resolue' && !auteur) {
        await this.notifications.notifier(demande.auteurId, {
          type: 'support.statut',
          titre: 'Demande résolue',
          corps: `Votre demande « ${demande.sujet} » a été marquée comme résolue.`,
          donnees: { demandeId: id, statut: 'resolue' },
        });
      }
    }
    return maj;
  }

  // Badge de navigation : demandes à traiter dans la portée de l'appelant.
  async compteurs(user: AuthenticatedUser) {
    const lignes = await this.prisma.demandeSupport.groupBy({
      by: ['statut'],
      where: {
        AND: [this.portee(user), { statut: { in: ['ouverte', 'en_cours'] } }],
      },
      _count: { _all: true },
    });
    const n = (s: string) => lignes.find((l) => l.statut === s)?._count._all ?? 0;
    return { ouverte: n('ouverte'), en_cours: n('en_cours') };
  }

  // Demande visible par l'appelant, sinon 404 (sans révéler son existence).
  private async charger(id: number, user: AuthenticatedUser) {
    const demande = await this.prisma.demandeSupport.findFirst({
      where: { AND: [{ id }, this.portee(user)] },
      include: DEMANDE_INCLUDE,
    });
    if (!demande) throw new NotFoundException('Demande introuvable');
    return demande;
  }

  private estTraitant(user: AuthenticatedUser, demande: Demande): boolean {
    if (!aLaPermission(user.role, PERMISSIONS.SUPPORT_MANAGE)) return false;
    if (user.role === UserRole.ADMIN) return true;
    return (
      demande.auteurRole === UserRole.USER &&
      user.compagnieId != null &&
      demande.compagnieId === user.compagnieId
    );
  }

  private portee(user: AuthenticatedUser): Prisma.DemandeSupportWhereInput {
    if (user.role === UserRole.ADMIN) return {};
    if (user.role === UserRole.COMPANY_ADMIN && user.compagnieId != null) {
      return { compagnieId: user.compagnieId };
    }
    return { auteurId: user.userId };
  }

  private filtres(
    user: AuthenticatedUser,
    f: ListeDemandesDto,
  ): Prisma.DemandeSupportWhereInput[] {
    const where: Prisma.DemandeSupportWhereInput[] = [];
    if (f.statut) where.push({ statut: f.statut });
    if (f.categorie) where.push({ categorie: f.categorie });
    if (f.origine === 'voyageur') where.push({ auteurRole: UserRole.USER });
    if (f.origine === 'compagnie') {
      where.push({ auteurRole: { in: ROLES_LIES_COMPAGNIE } });
    }
    if (f.compagnieId && user.role === UserRole.ADMIN) {
      where.push({ compagnieId: f.compagnieId });
    }
    if (f.q) {
      const texte = { contains: f.q, mode: 'insensitive' as const };
      const ou: Prisma.DemandeSupportWhereInput[] = [
        { sujet: texte },
        { auteur: { nom: texte } },
      ];
      const id = /^#?(\d{1,9})$/.exec(f.q);
      if (id) ou.push({ id: Number(id[1]) });
      where.push({ OR: ou });
    }
    return where;
  }
}

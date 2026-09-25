import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import { UserRole } from '../../config/constants';
import { peutVoirRessourceVoyageur } from '../../common/scope';
import { paginer } from '../../common/pagination';
import { siegesOccupesDepart } from '../../common/sieges';
import {
  clePubliquePem,
  estJetonSigne,
  signerTicket,
  verifierTicket,
} from '../../common/ticket-signature';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ListeValidationsDto } from './dto/liste-validations.dto';

export interface ActeurContexte {
  userId: number;
  role?: string;
  compagnieId?: number | null;
  ip?: string;
  // Champs supplémentaires à joindre au journal d'audit (ex. horodatage du
  // scan hors-ligne lors d'une synchronisation).
  metaExtra?: Record<string, unknown>;
}

const RESERVATION_AVEC_COMPAGNIE = {
  reservation: {
    include: {
      depart: { include: { trajet: { select: { compagnieId: true } } } },
    },
  },
} satisfies Prisma.TicketInclude;

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // Génère un ticket pour une réservation payée. Accessible au voyageur
  // propriétaire et au personnel (agent / company_admin) de la compagnie.
  async genererPourReservation(
    reservationId: number,
    siege: string | undefined,
    user: AuthenticatedUser,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        paiement: true,
        tickets: {
          where: { statut: { not: 'annule' } },
          select: { siege: true },
        },
        depart: { include: { trajet: { select: { compagnieId: true } } } },
      },
    });
    if (!reservation) throw new NotFoundException('Réservation introuvable');
    this.assertAcces(reservation, user);
    if (reservation.statut !== 'confirmee') {
      throw new BadRequestException(
        'Cette réservation est annulée ou expirée',
      );
    }
    if (!reservation.paiement || reservation.paiement.statut !== 'paye') {
      throw new BadRequestException(
        "Le paiement de cette réservation n'est pas confirmé",
      );
    }
    if (reservation.tickets.length >= reservation.nombrePlaces) {
      throw new BadRequestException(
        `Cette réservation a déjà ${reservation.nombrePlaces} ticket(s) (une par place)`,
      );
    }

    // Sans siège explicite, on prend le prochain siège choisi à la réservation
    // (choix fait avant paiement) qui n'a pas encore de ticket.
    let siegeFinal = siege;
    if (!siegeFinal && reservation.sieges.length > 0) {
      const dejaEmis = new Set(
        reservation.tickets
          .map((t) => t.siege)
          .filter((s): s is string => s !== null),
      );
      siegeFinal = reservation.sieges.find((s) => !dejaEmis.has(s));
    }

    // Un siège ne peut être occupé qu'une fois sur un même départ (tickets +
    // sièges retenus par d'autres réservations). On ignore le choix propre à
    // cette réservation, qu'on est justement en train de matérialiser.
    if (siegeFinal) {
      const occupes = await siegesOccupesDepart(
        this.prisma,
        reservation.departId,
        reservationId,
      );
      if (occupes.has(siegeFinal)) {
        throw new ConflictException(
          `Le siège ${siegeFinal} est déjà attribué sur ce départ`,
        );
      }
    }

    // Le codeQr est un jeton signé (Ed25519) qui embarque de quoi le vérifier
    // hors-ligne au contrôle. Il contient l'id du ticket : on crée d'abord la
    // ligne, puis on la signe et on remplace le codeQr (transaction atomique).
    const dateDepart = reservation.depart.dateDepart.toISOString().slice(0, 10);
    return this.prisma.$transaction(async (tx) => {
      const cree = await tx.ticket.create({
        data: {
          reservationId,
          codeQr: `provisoire-${randomUUID()}`,
          siege: siegeFinal ?? null,
        },
      });
      const codeQr = signerTicket({
        t: cree.id,
        r: reservationId,
        d: reservation.departId,
        c: reservation.depart.trajet.compagnieId,
        s: siegeFinal ?? null,
        dd: dateDepart,
      });
      return tx.ticket.update({
        where: { id: cree.id },
        data: { codeQr },
        include: { reservation: { include: { depart: true } } },
      });
    });
  }

  // Clé publique de vérification des QR — le contrôleur la met en cache pour
  // valider les tickets sans réseau.
  clePublique() {
    return { algo: 'ed25519', clePublique: clePubliquePem() };
  }

  async findByReservation(reservationId: number, user: AuthenticatedUser) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { depart: { include: { trajet: { select: { compagnieId: true } } } } },
    });
    if (!reservation) throw new NotFoundException('Réservation introuvable');
    this.assertAcces(reservation, user);

    return this.prisma.ticket.findMany({
      where: { reservationId },
      include: { reservation: { include: { depart: true } } },
    });
  }

  async findOne(id: number, user: AuthenticatedUser) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: RESERVATION_AVEC_COMPAGNIE,
    });
    if (!ticket) throw new NotFoundException(`Ticket ${id} introuvable`);
    this.assertAcces(ticket.reservation, user);
    return ticket;
  }

  // Liste cloisonnée : voyageur -> ses tickets ; personnel -> ceux de leur
  // compagnie ; admin -> tous.
  findAllScoped(user: AuthenticatedUser, skip = 0, take = 10) {
    return this.prisma.ticket.findMany({
      where: this.filtrePortee(user),
      ...paginer(skip, take),
      include: { reservation: { include: { depart: true } } },
      orderBy: { dateCreation: 'desc' },
    });
  }

  // Scanné à l'embarquement par un agent/contrôleur (PermissionsGuard).
  // Un agent/company_admin ne valide que les tickets de SA compagnie ;
  // l'admin plateforme, tous. Chaque tentative est journalisée (audit).
  async valider(codeQr: string, ctx?: ActeurContexte) {
    const journaliserTot = (resultat: string) =>
      this.audit.record({
        action: 'ticket.validation',
        entite: 'ticket',
        entiteId: null,
        acteurId: ctx?.userId,
        acteurRole: ctx?.role,
        ip: ctx?.ip,
        metadata: { codeQr, resultat, ...ctx?.metaExtra },
      });

    // QR au format jeton signé : on rejette tout de suite une signature
    // invalide (QR falsifié / illisible) sans même toucher la base.
    if (estJetonSigne(codeQr)) {
      const verif = verifierTicket(codeQr);
      if (!verif.valide) {
        await journaliserTot('signature_invalide');
        return { valide: false, message: 'QR invalide (signature non vérifiée)' };
      }
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { codeQr },
      include: {
        reservation: {
          include: {
            paiement: { select: { statut: true } },
            depart: { include: { trajet: { select: { compagnieId: true } } } },
          },
        },
      },
    });

    if (
      ticket &&
      ctx &&
      ctx.role !== UserRole.ADMIN &&
      ctx.compagnieId != null &&
      ticket.reservation.depart.trajet.compagnieId !== ctx.compagnieId
    ) {
      await this.audit.record({
        action: 'ticket.validation',
        entite: 'ticket',
        entiteId: ticket.id,
        acteurId: ctx.userId,
        acteurRole: ctx.role,
        ip: ctx.ip,
        metadata: { codeQr, resultat: 'refuse_hors_compagnie', ...ctx.metaExtra },
      });
      throw new ForbiddenException(
        "Ce ticket n'appartient pas à un départ de votre compagnie",
      );
    }

    const journaliser = (resultat: string, ticketId?: number) =>
      this.audit.record({
        action: 'ticket.validation',
        entite: 'ticket',
        entiteId: ticketId ?? null,
        acteurId: ctx?.userId,
        acteurRole: ctx?.role,
        ip: ctx?.ip,
        metadata: { codeQr, resultat, ...ctx?.metaExtra },
      });

    if (!ticket) {
      await journaliser('introuvable');
      return { valide: false, message: 'Ticket introuvable' };
    }
    if (ticket.statut === 'utilise') {
      await journaliser('deja_utilise', ticket.id);
      return { valide: false, message: 'Ticket déjà utilisé' };
    }
    if (ticket.statut === 'annule') {
      await journaliser('annule', ticket.id);
      return { valide: false, message: 'Ticket annulé' };
    }
    // Le ticket seul ne suffit pas : la réservation doit être toujours en
    // vigueur (pas annulée/remboursée) et payée.
    if (ticket.reservation.statut !== 'confirmee') {
      await journaliser('reservation_annulee', ticket.id);
      return { valide: false, message: 'Réservation annulée ou expirée' };
    }
    if (ticket.reservation.paiement?.statut !== 'paye') {
      await journaliser('non_paye', ticket.id);
      return { valide: false, message: 'Paiement non confirmé ou remboursé' };
    }

    // Conditionnel : deux scans simultanés ne peuvent pas valider tous les deux.
    const maj = await this.prisma.ticket.updateMany({
      where: { id: ticket.id, statut: 'valide' },
      data: { statut: 'utilise' },
    });
    if (maj.count === 0) {
      await journaliser('deja_utilise', ticket.id);
      return { valide: false, message: 'Ticket déjà utilisé' };
    }
    await journaliser('valide', ticket.id);
    return { valide: true, message: 'Ticket validé, bon voyage' };
  }

  async annuler(id: number, user: AuthenticatedUser) {
    const ticket = await this.findOne(id, user);
    if (ticket.statut === 'utilise') {
      throw new BadRequestException(
        "Impossible d'annuler un ticket déjà utilisé",
      );
    }
    return this.prisma.ticket.update({
      where: { id },
      data: { statut: 'annule' },
    });
  }

  count() {
    return this.prisma.ticket.count();
  }

  // Historique des validations à l'embarquement, à partir du journal d'audit
  // (action 'ticket.validation' — succès ET échecs). Enrichi avec le trajet
  // quand le ticket existe encore.
  async historiqueValidations(
    user: AuthenticatedUser,
    skip = 0,
    take = 10,
    filtres: Pick<ListeValidationsDto, 'resultat' | 'du' | 'au'> = {},
  ) {
    const where: Prisma.AuditLogWhereInput = { action: 'ticket.validation' };
    const resultatValide = { metadata: { path: ['resultat'], equals: 'valide' } };
    if (filtres.resultat === 'valide') Object.assign(where, resultatValide);
    if (filtres.resultat === 'refuse') where.NOT = resultatValide;
    if (filtres.du || filtres.au) {
      const fin = filtres.au ? new Date(`${filtres.au}T00:00:00Z`) : null;
      fin?.setUTCDate(fin.getUTCDate() + 1); // `au` inclus → < lendemain 00:00
      where.dateCreation = {
        ...(filtres.du && { gte: new Date(`${filtres.du}T00:00:00Z`) }),
        ...(fin && { lt: fin }),
      };
    }
    if (user.role === UserRole.ADMIN) {
      // toutes les compagnies
    } else if (
      user.role === UserRole.COMPANY_ADMIN &&
      user.compagnieId != null
    ) {
      where.acteur = { compagnieId: user.compagnieId };
    } else {
      where.acteurId = user.userId;
    }

    const lignes = await this.prisma.auditLog.findMany({
      where,
      ...paginer(skip, take),
      orderBy: { dateCreation: 'desc' },
      select: { entiteId: true, metadata: true, dateCreation: true },
    });

    const ticketIds = [
      ...new Set(
        lignes
          .map((l) => l.entiteId)
          .filter((v): v is number => v != null),
      ),
    ];
    const tickets = ticketIds.length
      ? await this.prisma.ticket.findMany({
          where: { id: { in: ticketIds } },
          include: {
            reservation: {
              include: {
                depart: {
                  include: {
                    trajet: {
                      include: {
                        villeDepart: { select: { nom: true } },
                        villeArrivee: { select: { nom: true } },
                        compagnie: { select: { nom: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        })
      : [];
    const parId = new Map(tickets.map((t) => [t.id, t]));

    return lignes.map((l) => {
      const meta = (l.metadata as unknown as {
        codeQr?: string;
        resultat?: string;
      } | null) ?? {};
      const ticket = l.entiteId != null ? parId.get(l.entiteId) : undefined;
      return {
        ticketId: ticket?.id ?? null,
        siege: ticket?.siege ?? null,
        codeQr: meta.codeQr ?? ticket?.codeQr ?? null,
        resultat: meta.resultat ?? null,
        date: l.dateCreation,
        reservation: ticket
          ? {
              nombrePlaces: ticket.reservation.nombrePlaces,
              depart: {
                dateDepart: ticket.reservation.depart.dateDepart,
                trajet: {
                  heureDepart: ticket.reservation.depart.trajet.heureDepart,
                  villeDepart: ticket.reservation.depart.trajet.villeDepart,
                  villeArrivee: ticket.reservation.depart.trajet.villeArrivee,
                  compagnie: ticket.reservation.depart.trajet.compagnie,
                },
              },
            }
          : null,
      };
    });
  }

  // Manifeste d'un départ, téléchargé par le contrôleur tant qu'il a du réseau :
  // clé publique + liste des tickets (avec statut, pour repérer les révocations
  // annule/utilise). Ensuite le contrôle se fait 100 % hors-ligne.
  async manifesteDepart(departId: number, user: AuthenticatedUser) {
    const depart = await this.prisma.depart.findUnique({
      where: { id: departId },
      include: {
        trajet: {
          include: {
            villeDepart: { select: { nom: true } },
            villeArrivee: { select: { nom: true } },
            compagnie: { select: { id: true, nom: true } },
          },
        },
      },
    });
    if (!depart) throw new NotFoundException(`Départ ${departId} introuvable`);

    if (
      user.role !== UserRole.ADMIN &&
      user.compagnieId != null &&
      depart.trajet.compagnie.id !== user.compagnieId
    ) {
      throw new ForbiddenException(
        "Ce départ n'appartient pas à votre compagnie",
      );
    }

    const tickets = await this.prisma.ticket.findMany({
      where: { reservation: { departId } },
      include: {
        reservation: {
          select: {
            id: true,
            statut: true,
            nombrePlaces: true,
            passagerNom: true,
            paiement: { select: { statut: true } },
            utilisateur: { select: { nom: true } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    return {
      depart: {
        id: depart.id,
        dateDepart: depart.dateDepart,
        statut: depart.statut,
        heureDepart: depart.trajet.heureDepart,
        villeDepart: depart.trajet.villeDepart.nom,
        villeArrivee: depart.trajet.villeArrivee.nom,
        compagnie: depart.trajet.compagnie,
      },
      genereA: new Date().toISOString(),
      algo: 'ed25519',
      clePublique: clePubliquePem(),
      tickets: tickets.map((t) => ({
        ticketId: t.id,
        codeQr: t.codeQr,
        siege: t.siege,
        // Statut effectif pour le contrôle hors-ligne : un ticket encore
        // 'valide' d'une réservation annulée ou non payée est révoqué.
        statut:
          t.statut === 'valide' &&
          (t.reservation.statut !== 'confirmee' ||
            t.reservation.paiement?.statut !== 'paye')
            ? 'annule'
            : t.statut,
        reservationId: t.reservation.id,
        passager:
          t.reservation.utilisateur?.nom ?? t.reservation.passagerNom ?? null,
      })),
    };
  }

  // Rejoue les scans faits hors-ligne par le contrôleur. Chaque scan repasse
  // par `valider()` : le premier succès marque le ticket `utilise`, un doublon
  // renvoie `deja_utilise` (signal de conflit entre deux contrôleurs).
  async synchroniserValidations(
    scans: { codeQr: string; scanneA?: string; resultatLocal?: string }[],
    ctx: ActeurContexte,
  ) {
    const resultats: {
      codeQr: string;
      valide: boolean;
      message: string;
    }[] = [];
    for (const scan of scans) {
      const verdict = await this.valider(scan.codeQr, {
        ...ctx,
        metaExtra: {
          source: 'sync_hors_ligne',
          scanneA: scan.scanneA ?? null,
          resultatLocal: scan.resultatLocal ?? null,
        },
      }).catch((err) => ({
        valide: false,
        message:
          err instanceof ForbiddenException
            ? 'Ticket hors de votre compagnie'
            : 'Erreur de synchronisation',
      }));
      resultats.push({ codeQr: scan.codeQr, ...verdict });
    }
    return { traites: resultats.length, resultats };
  }

  private assertAcces(
    reservation: {
      utilisateurId: number | null;
      depart: { trajet: { compagnieId: number } };
    },
    user: AuthenticatedUser,
  ) {
    if (
      !peutVoirRessourceVoyageur(
        user,
        reservation.utilisateurId,
        reservation.depart.trajet.compagnieId,
      )
    ) {
      throw new ForbiddenException("Vous n'avez pas accès à ce ticket");
    }
  }

  private filtrePortee(user: AuthenticatedUser): Prisma.TicketWhereInput {
    if (user.role === UserRole.ADMIN) return {};
    if (
      (user.role === UserRole.AGENT || user.role === UserRole.COMPANY_ADMIN) &&
      user.compagnieId != null
    ) {
      return {
        reservation: { depart: { trajet: { compagnieId: user.compagnieId } } },
      };
    }
    return { reservation: { utilisateurId: user.userId } };
  }
}

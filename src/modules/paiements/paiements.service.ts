import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  assertCompagnieScope,
  peutVoirRessourceVoyageur,
} from '../../common/scope';
import { paginer } from '../../common/pagination';
import { UserRole } from '../../config/constants';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  JekoService,
  StatutJeko,
  erreurJekoVersHttp,
  versCentimes,
} from '../jeko/jeko.service';
import {
  TELEPHONE_MOBILE_MONEY_CI,
  confirmeParUssd,
  depuisMoyenJeko,
  versMoyenJeko,
} from '../../common/moyens-paiement';
import { normaliserTelephone } from '../../common/telephone';
import { CreatePaiementDto } from './dto/create-paiement.dto';
import { CreatePaiementGuichetDto } from './dto/create-paiement-guichet.dto';
import { UpdatePaiementDto } from './dto/update-paiement.dto';

const RESERVATION_COMPAGNIE = {
  reservation: {
    include: {
      depart: { include: { trajet: { select: { compagnieId: true } } } },
    },
  },
};

// Référence Jèko d'un paiement : une par tentative (Jèko refuse de réutiliser
// une référence, même après un échec opérateur).
const REFERENCE_PAIEMENT = /^YEGO-P(\d+)-T\d+$/;

// Une demande Jèko cesse d'être payable 30 min après sa création : en deçà, une
// relance identique (même moyen, même numéro) renvoie la demande en cours au
// lieu d'en ouvrir une seconde, payable elle aussi.
const DEMANDE_JEKO_VALIDE_MS = 25 * 60 * 1000;

@Injectable()
export class PaiementsService {
  private readonly logger = new Logger(PaiementsService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private jeko: JekoService,
  ) {}

  // Si Jèko est configuré (JEKO_API_KEY), un paiement mobile money ouvre une
  // demande de paiement direct opérateur ; la confirmation arrive ensuite par
  // webhook (POST /jeko/webhook) ou par réconciliation, jamais en synchrone.
  //
  // Sécurité : le montant n'est jamais pris depuis le body du client, il
  // est recalculé à partir du prix du trajet de la réservation, sinon un
  // client pourrait payer 1 FCFA pour n'importe quel trajet.
  // Initie (ou relance) le paiement en ligne d'une réservation. Idempotent :
  // s'il existe déjà un paiement 'en_attente' ou 'echoue' pour la réservation,
  // on le réutilise (mise à jour du moyen + retour en 'en_attente') plutôt que
  // d'échouer sur la contrainte d'unicité — un paiement échoué n'est donc pas
  // un cul-de-sac.
  async create(dto: CreatePaiementDto, requestingUserId: number) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: dto.reservationId },
      include: {
        depart: { include: { trajet: true } },
        paiement: true,
        utilisateur: { select: { telephone: true } },
      },
    });

    if (!reservation) {
      throw new NotFoundException('Réservation introuvable');
    }
    if (reservation.utilisateurId !== requestingUserId) {
      throw new ForbiddenException("Vous ne pouvez payer que vos propres réservations");
    }
    if (reservation.statut !== 'confirmee') {
      throw new BadRequestException('Cette réservation est annulée ou expirée');
    }

    const montant = reservation.depart.trajet.prix.times(reservation.nombrePlaces);

    const existant = reservation.paiement;
    if (existant) {
      if (existant.statut === 'paye') {
        throw new BadRequestException('Cette réservation est déjà payée');
      }
      if (existant.statut === 'rembourse') {
        throw new BadRequestException('Cette réservation a été remboursée');
      }
    }

    if (this.jeko.estConfigure()) {
      return this.initierPaiementJeko(
        dto,
        montant,
        existant,
        reservation.utilisateur?.telephone,
      );
    }

    if (existant) {
      // 'en_attente' ou 'echoue' → on relance le même paiement.
      return this.prisma.paiement.update({
        where: { reservationId: dto.reservationId },
        data: {
          montant,
          moyenPaiement: dto.moyenPaiement,
          referenceTransaction: dto.referenceTransaction ?? null,
          statut: 'en_attente',
        },
        include: { reservation: true },
      });
    }

    return this.prisma.paiement.create({
      data: {
        reservationId: dto.reservationId,
        montant,
        moyenPaiement: dto.moyenPaiement,
        referenceTransaction: dto.referenceTransaction,
        statut: 'en_attente',
      },
      include: { reservation: true },
    });
  }

  // Ouvre (ou relance) une demande de paiement Jèko en mode direct opérateur.
  // Réponse : le paiement + `actionRequise` pour l'app — 'redirection' (ouvrir
  // urlPaiement : Orange / Wave / Djamo) ou 'ussd' (MTN / Moov : le payeur
  // valide sur son téléphone, l'app affiche un écran d'attente).
  private async initierPaiementJeko(
    dto: CreatePaiementDto,
    montant: Prisma.Decimal,
    existant: {
      id: number;
      statut: string;
      moyenPaiement: string;
      telephonePayeur: string | null;
      urlPaiement: string | null;
      jekoDemandeLe: Date | null;
    } | null,
    telephoneCompte: string | undefined,
  ) {
    const moyenJeko = versMoyenJeko(dto.moyenPaiement);
    if (!moyenJeko) {
      throw new BadRequestException(
        'Le paiement en espèces se fait au guichet, pas en ligne',
      );
    }
    const telephone =
      dto.telephonePayeur ?? (normaliserTelephone(telephoneCompte) as string | undefined);
    if (!telephone || !TELEPHONE_MOBILE_MONEY_CI.test(telephone)) {
      throw new BadRequestException(
        'Indiquez le numéro Mobile Money qui paie (telephonePayeur, +225 01/05/07…)',
      );
    }

    const actionRequise = confirmeParUssd(dto.moyenPaiement) ? 'ussd' : 'redirection';

    if (
      existant?.statut === 'en_attente' &&
      existant.urlPaiement &&
      existant.jekoDemandeLe &&
      Date.now() - existant.jekoDemandeLe.getTime() < DEMANDE_JEKO_VALIDE_MS &&
      existant.moyenPaiement === dto.moyenPaiement &&
      existant.telephonePayeur === telephone
    ) {
      const enCours = await this.prisma.paiement.findUniqueOrThrow({
        where: { id: existant.id },
        include: { reservation: true },
      });
      return { ...enCours, actionRequise };
    }

    const donnees = {
      montant,
      moyenPaiement: dto.moyenPaiement,
      telephonePayeur: telephone,
      referenceTransaction: null,
      statut: 'en_attente',
      urlPaiement: null,
    };
    const paiement = existant
      ? await this.prisma.paiement.update({
          where: { id: existant.id },
          data: { ...donnees, jekoTentatives: { increment: 1 } },
        })
      : await this.prisma.paiement.create({
          data: { ...donnees, reservationId: dto.reservationId, jekoTentatives: 1 },
        });

    const reference = `YEGO-P${paiement.id}-T${paiement.jekoTentatives}`;
    let demande;
    try {
      demande = await this.jeko.creerDemandePaiement({
        reference,
        montantFcfa: montant.toNumber(),
        moyen: moyenJeko,
        telephonePayeur: telephone,
        reservationId: dto.reservationId,
      });
    } catch (err) {
      // La référence est consommée même en cas d'échec opérateur : la
      // prochaine relance en prendra une nouvelle (tentative + 1).
      await this.prisma.paiement.update({
        where: { id: paiement.id },
        data: { statut: 'echoue', jekoReference: reference },
      });
      erreurJekoVersHttp(err, 'Paiement');
    }

    const maj = await this.prisma.paiement.update({
      where: { id: paiement.id },
      data: {
        jekoPaymentRequestId: demande.id,
        jekoReference: reference,
        jekoDemandeLe: new Date(),
        urlPaiement: demande.redirectUrl,
      },
      include: { reservation: true },
    });
    return { ...maj, actionRequise };
  }

  // Encaissement au guichet : un agent / company_admin enregistre un paiement
  // qu'il a reçu au comptoir (espèces ou transfert mobile money confirmé sur
  // place). Le paiement est directement 'paye'. Réservé à la compagnie du départ.
  async encaisserAuGuichet(
    dto: CreatePaiementGuichetDto,
    user: AuthenticatedUser,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: dto.reservationId },
      include: {
        paiement: true,
        depart: { include: { trajet: { select: { compagnieId: true, prix: true } } } },
      },
    });
    if (!reservation) throw new NotFoundException('Réservation introuvable');
    assertCompagnieScope(user, reservation.depart.trajet.compagnieId);
    if (reservation.statut !== 'confirmee') {
      throw new BadRequestException('Cette réservation est annulée ou expirée');
    }
    if (reservation.paiement) {
      throw new BadRequestException(
        'Cette réservation a déjà un paiement enregistré',
      );
    }

    const montant = reservation.depart.trajet.prix.times(reservation.nombrePlaces);
    const paiement = await this.prisma.paiement.create({
      data: {
        reservationId: dto.reservationId,
        montant,
        moyenPaiement: dto.moyenPaiement,
        referenceTransaction: dto.referenceTransaction,
        statut: 'paye',
        datePaiement: new Date(),
      },
      include: { reservation: true },
    });

    await this.audit.record({
      action: 'paiement.guichet',
      entite: 'paiement',
      entiteId: paiement.id,
      acteurId: user.userId,
      acteurRole: user.role,
      metadata: {
        reservationId: dto.reservationId,
        moyenPaiement: dto.moyenPaiement,
        montant: montant.toString(),
      },
    });

    return paiement;
  }

  // Voyageur → ses paiements · agent / company_admin → ceux de leur compagnie ·
  // admin → tous.
  findAllScoped(user: AuthenticatedUser, skip = 0, take = 10) {
    return this.prisma.paiement.findMany({
      where: this.filtrePortee(user),
      ...paginer(skip, take),
      include: { reservation: true },
      orderBy: { datePaiement: 'desc' },
    });
  }

  async findOne(id: number, user: AuthenticatedUser) {
    const paiement = await this.prisma.paiement.findUnique({
      where: { id },
      include: RESERVATION_COMPAGNIE,
    });
    if (!paiement) throw new NotFoundException(`Paiement ${id} introuvable`);
    this.assertAcces(paiement, user);
    return paiement;
  }

  async findByReservation(reservationId: number, user: AuthenticatedUser) {
    const paiement = await this.prisma.paiement.findUnique({
      where: { reservationId },
      include: RESERVATION_COMPAGNIE,
    });
    if (!paiement) throw new NotFoundException('Paiement introuvable');
    this.assertAcces(paiement, user);
    return paiement;
  }

  // Appelé uniquement par le webhook opérateur mobile money, authentifié par
  // secret partagé au niveau du contrôleur (pas par un utilisateur connecté).
  //
  // Ne confirme qu'un paiement en attente (ou échoué puis relancé) d'une
  // réservation toujours en vigueur. Rejouer le webhook sur un paiement déjà
  // payé est un no-op (idempotent) ; un paiement remboursé, ou une réservation
  // annulée/expirée entre-temps (places peut-être revendues), donne 409 : les
  // fonds reçus sont à rembourser, pas à transformer en voyage.
  async confirmer(reservationId: number, referenceTransaction?: string) {
    const existant = await this.prisma.paiement.findUnique({
      where: { reservationId },
      include: { reservation: true },
    });
    if (!existant) throw new NotFoundException('Paiement introuvable');
    if (existant.statut === 'paye') return existant;
    if (existant.statut === 'rembourse') {
      throw new ConflictException('Ce paiement a déjà été remboursé');
    }
    if (existant.reservation.statut !== 'confirmee') {
      throw new ConflictException(
        'Réservation annulée ou expirée : paiement non appliqué, à rembourser',
      );
    }

    // Conditionnel : si le cron d'expiration ou une annulation passe entre la
    // lecture et l'écriture, rien n'est modifié.
    const maj = await this.prisma.paiement.updateMany({
      where: {
        reservationId,
        statut: { in: ['en_attente', 'echoue'] },
        reservation: { statut: 'confirmee' },
      },
      data: {
        statut: 'paye',
        datePaiement: new Date(),
        ...(referenceTransaction ? { referenceTransaction } : {}),
      },
    });
    if (maj.count === 0) {
      throw new ConflictException(
        'Le paiement ou la réservation a changé d’état, confirmation refusée',
      );
    }
    const paiement = await this.prisma.paiement.findUniqueOrThrow({
      where: { reservationId },
      include: { reservation: true },
    });

    await this.notifications.notifier(paiement.reservation.utilisateurId, {
      type: 'paiement.confirme',
      titre: 'Paiement confirmé',
      corps: 'Votre paiement est reçu. Votre ticket est disponible.',
      donnees: { reservationId, paiementId: paiement.id },
    });

    return paiement;
  }

  // Webhook Jèko TRANSACTION_COMPLETED (paiement réussi). La signature est
  // vérifiée en amont ; on recoupe quand même le montant avec la base.
  // Ne lève pas sur un cas métier (paiement inconnu, résa expirée…) : ces cas
  // sont journalisés et audités, et Jèko ne doit pas rejouer le webhook.
  async appliquerPaiementJeko(tx: {
    reference?: string;
    paymentRequestId?: string;
    transactionId?: string;
    montantCentimes?: number;
    moyenJeko?: string;
    telephonePayeur?: string;
  }) {
    const paiement = await this.trouverPaiementJeko(tx.reference, tx.paymentRequestId);
    if (!paiement) {
      this.logger.warn(
        `Webhook Jèko : aucun paiement pour ${tx.reference ?? '?'} / ${tx.paymentRequestId ?? '?'}`,
      );
      return null;
    }

    // Jèko exprime les montants en centimes ; on tolère aussi des FCFA pour ne
    // pas bloquer les confirmations si le format du webhook évolue.
    if (
      tx.montantCentimes != null &&
      tx.montantCentimes !== versCentimes(paiement.montant.toNumber()) &&
      tx.montantCentimes !== paiement.montant.toNumber()
    ) {
      this.logger.error(
        `Webhook Jèko : montant ${tx.montantCentimes} incohérent pour le paiement ${paiement.id} (${paiement.montant} FCFA)`,
      );
      await this.audit.record({
        action: 'paiement.jeko_montant_incoherent',
        entite: 'paiement',
        entiteId: paiement.id,
        metadata: { ...tx, montantAttendu: paiement.montant.toString() },
      });
      return null;
    }

    if (paiement.statut === 'paye') {
      // Rejeu du même webhook : no-op. Une AUTRE transaction sur un paiement
      // déjà soldé (deux demandes payées) = trop-perçu à rembourser.
      if (
        tx.transactionId &&
        paiement.referenceTransaction &&
        paiement.referenceTransaction !== tx.transactionId
      ) {
        await this.audit.record({
          action: 'paiement.jeko_doublon',
          entite: 'paiement',
          entiteId: paiement.id,
          metadata: { ...tx, dejaPayePar: paiement.referenceTransaction },
        });
      }
      return paiement;
    }

    // C'est peut-être une tentative antérieure (autre moyen, autre numéro) qui
    // a été payée : on garde ce qui a réellement servi, destination d'un
    // éventuel remboursement.
    const moyen = depuisMoyenJeko(tx.moyenJeko);
    const telephone =
      tx.telephonePayeur && TELEPHONE_MOBILE_MONEY_CI.test(tx.telephonePayeur)
        ? tx.telephonePayeur
        : null;
    if ((moyen && moyen !== paiement.moyenPaiement) || (telephone && telephone !== paiement.telephonePayeur)) {
      await this.prisma.paiement.update({
        where: { id: paiement.id },
        data: {
          ...(moyen ? { moyenPaiement: moyen } : {}),
          ...(telephone ? { telephonePayeur: telephone } : {}),
        },
      });
    }

    try {
      return await this.confirmer(
        paiement.reservationId,
        tx.transactionId ?? tx.paymentRequestId,
      );
    } catch (err) {
      if (err instanceof ConflictException) {
        this.logger.error(
          `Paiement Jèko reçu mais non appliqué (paiement ${paiement.id}) : ${err.message} — à rembourser`,
        );
        await this.audit.record({
          action: 'paiement.jeko_a_rembourser',
          entite: 'paiement',
          entiteId: paiement.id,
          metadata: { ...tx, motif: err.message },
        });
        return null;
      }
      throw err;
    }
  }

  // Demande Jèko terminée en erreur (expirée, refusée) : Jèko n'envoie pas de
  // webhook pour un paiement échoué, on l'apprend en l'interrogeant.
  async marquerEchecJeko(paiementId: number, motif: string | null) {
    const maj = await this.prisma.paiement.updateMany({
      where: { id: paiementId, statut: 'en_attente' },
      data: { statut: 'echoue', urlPaiement: null },
    });
    if (maj.count === 0) return;
    const paiement = await this.prisma.paiement.findUniqueOrThrow({
      where: { id: paiementId },
      include: { reservation: true },
    });
    await this.notifications.notifier(paiement.reservation.utilisateurId, {
      type: 'paiement.echoue',
      titre: 'Paiement échoué',
      corps: "Votre paiement n'a pas abouti. Vous pouvez réessayer.",
      donnees: { reservationId: paiement.reservationId, paiementId, motif: motif ?? '' },
    });
  }

  // Interroge Jèko sur la demande en cours et applique son issue. Utilisé par
  // la réconciliation périodique et par POST /paiements/reservation/:id/verifier
  // (l'app y passe au retour de la page opérateur).
  async synchroniserAvecJeko(paiement: {
    id: number;
    statut: string;
    jekoPaymentRequestId: string | null;
  }): Promise<StatutJeko | null> {
    if (!paiement.jekoPaymentRequestId || paiement.statut !== 'en_attente') {
      return null;
    }
    const demande = await this.jeko.lireDemandePaiement(paiement.jekoPaymentRequestId);
    if (demande.status === 'success') {
      await this.appliquerPaiementJeko({
        reference: demande.reference,
        paymentRequestId: demande.id,
      });
    } else if (demande.status === 'error') {
      await this.marquerEchecJeko(paiement.id, demande.errorReason);
    }
    return demande.status;
  }

  async verifierAupresDeJeko(reservationId: number, user: AuthenticatedUser) {
    const paiement = await this.findByReservation(reservationId, user);
    if (this.jeko.estConfigure()) {
      try {
        await this.synchroniserAvecJeko(paiement);
      } catch (err) {
        erreurJekoVersHttp(err, 'Vérification du paiement');
      }
    }
    return this.findByReservation(reservationId, user);
  }

  private trouverPaiementJeko(reference?: string, paymentRequestId?: string) {
    const m = reference ? REFERENCE_PAIEMENT.exec(reference) : null;
    if (m) {
      return this.prisma.paiement.findUnique({ where: { id: Number(m[1]) } });
    }
    if (paymentRequestId) {
      return this.prisma.paiement.findUnique({
        where: { jekoPaymentRequestId: paymentRequestId },
      });
    }
    return Promise.resolve(null);
  }

  // Simulation d'une réponse opérateur mobile money (flag PAYMENT_SIMULATION).
  // Réservé au voyageur propriétaire de la réservation (ou admin). 'succes'
  // rejoint exactement le chemin du webhook (confirmer) ; 'echec' passe le
  // paiement en 'echoue' — la réservation reste réservée et peut être repayée
  // en relançant la simulation avec 'succes'.
  async simuler(
    reservationId: number,
    resultat: 'succes' | 'echec',
    user: AuthenticatedUser,
  ) {
    const paiement = await this.prisma.paiement.findUnique({
      where: { reservationId },
      include: { reservation: true },
    });
    if (!paiement) {
      throw new NotFoundException(
        "Aucun paiement à simuler : créez d'abord le paiement (POST /paiements)",
      );
    }
    if (
      user.role !== UserRole.ADMIN &&
      paiement.reservation.utilisateurId !== user.userId
    ) {
      throw new ForbiddenException(
        'Vous ne pouvez simuler que le paiement de vos propres réservations',
      );
    }
    if (paiement.statut === 'paye') {
      throw new BadRequestException('Ce paiement est déjà confirmé');
    }
    if (paiement.statut === 'rembourse') {
      throw new BadRequestException('Ce paiement a été remboursé');
    }
    if (paiement.reservation.statut !== 'confirmee') {
      throw new BadRequestException('Cette réservation est annulée ou expirée');
    }

    if (resultat === 'succes') {
      const confirme = await this.confirmer(reservationId);
      await this.audit.record({
        action: 'paiement.simulation',
        entite: 'paiement',
        entiteId: confirme.id,
        acteurId: user.userId,
        acteurRole: user.role,
        metadata: { reservationId, resultat: 'succes' },
      });
      return confirme;
    }

    const echoue = await this.prisma.paiement.update({
      where: { reservationId },
      data: { statut: 'echoue' },
      include: { reservation: true },
    });
    await this.audit.record({
      action: 'paiement.simulation',
      entite: 'paiement',
      entiteId: echoue.id,
      acteurId: user.userId,
      acteurRole: user.role,
      metadata: { reservationId, resultat: 'echec' },
    });
    await this.notifications.notifier(echoue.reservation.utilisateurId, {
      type: 'paiement.echoue',
      titre: 'Paiement échoué',
      corps: "Votre paiement n'a pas abouti. Vous pouvez réessayer.",
      donnees: { reservationId, paiementId: echoue.id },
    });
    return echoue;
  }

  async update(id: number, dto: UpdatePaiementDto, requestingUserId: number) {
    const paiement = await this.prisma.paiement.findUnique({
      where: { id },
      include: { reservation: true },
    });
    if (!paiement) {
      throw new NotFoundException(`Paiement ${id} introuvable`);
    }
    this.assertOwnership(paiement.reservation.utilisateurId, requestingUserId);
    if (paiement.statut === 'paye') {
      throw new BadRequestException('Impossible de modifier un paiement déjà confirmé');
    }

    return this.prisma.paiement.update({
      where: { id },
      data: dto,
      include: { reservation: true },
    });
  }

  async delete(id: number, requestingUserId: number) {
    const paiement = await this.prisma.paiement.findUnique({
      where: { id },
      include: { reservation: true },
    });
    if (!paiement) {
      throw new NotFoundException(`Paiement ${id} introuvable`);
    }
    this.assertOwnership(paiement.reservation.utilisateurId, requestingUserId);
    if (paiement.statut === 'paye' || paiement.statut === 'rembourse') {
      throw new BadRequestException(
        'Un paiement confirmé ou remboursé ne peut pas être supprimé',
      );
    }
    // Une demande Jèko reste payable ~30 min : sans la ligne, un paiement reçu
    // ensuite ne serait plus rattachable à la réservation.
    if (paiement.jekoReference) {
      throw new BadRequestException(
        'Un paiement en ligne Jèko ne peut pas être supprimé',
      );
    }

    return this.prisma.paiement.delete({
      where: { id },
    });
  }

  count() {
    return this.prisma.paiement.count();
  }

  private assertOwnership(ownerId: number | null, requestingUserId: number) {
    if (ownerId !== requestingUserId) {
      throw new ForbiddenException("Vous n'avez pas accès à ce paiement");
    }
  }

  private assertAcces(
    paiement: {
      reservation: {
        utilisateurId: number | null;
        depart: { trajet: { compagnieId: number } };
      };
    },
    user: AuthenticatedUser,
  ) {
    if (
      !peutVoirRessourceVoyageur(
        user,
        paiement.reservation.utilisateurId,
        paiement.reservation.depart.trajet.compagnieId,
      )
    ) {
      throw new ForbiddenException("Vous n'avez pas accès à ce paiement");
    }
  }

  private filtrePortee(user: AuthenticatedUser): Prisma.PaiementWhereInput {
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

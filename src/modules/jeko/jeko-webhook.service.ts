import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma.service';
import { PaiementsService } from '../paiements/paiements.service';
import { RemboursementsService } from '../remboursements/remboursements.service';
import { ReversementsService } from '../reversements/reversements.service';
import { JekoService, StatutJeko } from './jeko.service';

// Corps de TRANSACTION_COMPLETED (plat, sans champ `event`).
export interface TransactionJeko {
  id?: string;
  status?: StatutJeko;
  transactionType?: 'payment' | 'transfer';
  amount?: { amount?: number; currency?: string };
  fees?: { amount?: number; currency?: string };
  paymentMethod?: string;
  counterpartIdentifier?: string;
  transactionDetails?: { id?: string; reference?: string };
}

const REFERENCE_REMBOURSEMENT = /^YEGO-RB(\d+)-T\d+$/;
const REFERENCE_REVERSEMENT = /^YEGO-RV(\d+)$/;

// Au-delà, une demande de paiement n'est plus payable : inutile de la sonder.
const FENETRE_RECONCILIATION_PAIEMENT_MS = 2 * 60 * 60 * 1000;
const LOT_RECONCILIATION = 50;

/**
 * Point d'entrée des événements Jèko : webhook signé (POST /jeko/webhook) et
 * réconciliation périodique. Jèko ne réessaie un webhook que 3 fois en 3 s et
 * n'en envoie AUCUN pour un paiement échoué : la réconciliation interroge donc
 * l'API pour tout ce qui reste en attente.
 */
@Injectable()
export class JekoWebhookService {
  private readonly logger = new Logger(JekoWebhookService.name);

  constructor(
    private prisma: PrismaService,
    private jeko: JekoService,
    private paiements: PaiementsService,
    private remboursements: RemboursementsService,
    private reversements: ReversementsService,
  ) {}

  async traiter(evenement: string | undefined, corps: TransactionJeko): Promise<void> {
    if (evenement !== 'TRANSACTION_COMPLETED') {
      this.logger.log(`Événement Jèko ignoré : ${evenement ?? '(aucun)'}`);
      return;
    }
    const reference = corps.transactionDetails?.reference;
    const statut = corps.status;
    if (!statut) return;

    if (corps.transactionType === 'payment') {
      if (statut !== 'success') return;
      await this.paiements.appliquerPaiementJeko({
        reference,
        paymentRequestId: corps.transactionDetails?.id,
        transactionId: corps.id,
        montantCentimes: corps.amount?.amount,
        moyenJeko: corps.paymentMethod,
        telephonePayeur: corps.counterpartIdentifier,
      });
      return;
    }

    if (corps.transactionType === 'transfer' && reference) {
      const rb = REFERENCE_REMBOURSEMENT.exec(reference);
      if (rb) {
        await this.remboursements.appliquerResultatTransfert(Number(rb[1]), statut);
        return;
      }
      const rv = REFERENCE_REVERSEMENT.exec(reference);
      if (rv) {
        await this.reversements.appliquerResultatTransfert(Number(rv[1]), statut, {
          fraisCentimes: corps.fees?.amount,
        });
        return;
      }
    }
    this.logger.warn(
      `Transaction Jèko non rattachée : ${corps.transactionType ?? '?'} ${reference ?? '(sans référence)'}`,
    );
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilier(): Promise<{ paiements: number; remboursements: number; reversements: number }> {
    const bilan = { paiements: 0, remboursements: 0, reversements: 0 };
    if (!this.jeko.estConfigure()) return bilan;

    const depuis = new Date(Date.now() - FENETRE_RECONCILIATION_PAIEMENT_MS);
    const paiements = await this.prisma.paiement.findMany({
      where: {
        statut: 'en_attente',
        jekoPaymentRequestId: { not: null },
        jekoDemandeLe: { gte: depuis },
      },
      select: { id: true, statut: true, jekoPaymentRequestId: true },
      take: LOT_RECONCILIATION,
    });
    for (const p of paiements) {
      await this.sansPlanter(`paiement ${p.id}`, async () => {
        if ((await this.paiements.synchroniserAvecJeko(p)) !== 'pending') bilan.paiements++;
      });
    }

    const remboursements = await this.prisma.remboursement.findMany({
      where: { statut: 'en_cours', jekoTransferId: { not: null } },
      select: { id: true, jekoTransferId: true },
      take: LOT_RECONCILIATION,
    });
    for (const r of remboursements) {
      await this.sansPlanter(`remboursement ${r.id}`, async () => {
        await this.remboursements.synchroniserTransfert(r);
        bilan.remboursements++;
      });
    }

    const reversements = await this.prisma.reversement.findMany({
      where: { statut: 'en_cours', jekoTransferId: { not: null } },
      select: { id: true, jekoTransferId: true },
      take: LOT_RECONCILIATION,
    });
    for (const r of reversements) {
      await this.sansPlanter(`reversement ${r.id}`, async () => {
        await this.reversements.synchroniserTransfert(r);
        bilan.reversements++;
      });
    }
    return bilan;
  }

  // Une ligne en erreur (Jèko indisponible…) ne bloque pas le reste du lot.
  private async sansPlanter(libelle: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(`Réconciliation Jèko ${libelle} : ${(err as Error).message}`);
    }
  }
}

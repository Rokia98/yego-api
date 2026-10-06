import { Module } from '@nestjs/common';
import { PaiementsModule } from '../paiements/paiements.module';
import { RemboursementsModule } from '../remboursements/remboursements.module';
import { ReversementsModule } from '../reversements/reversements.module';
import { JekoWebhookController } from './jeko-webhook.controller';
import { JekoWebhookService } from './jeko-webhook.service';

// Webhook + réconciliation Jèko : aiguille chaque transaction vers le module
// concerné (paiement, remboursement, reversement).
@Module({
  imports: [PaiementsModule, RemboursementsModule, ReversementsModule],
  providers: [JekoWebhookService],
  controllers: [JekoWebhookController],
})
export class JekoIntegrationModule {}

import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { JekoService } from './jeko.service';
import { JekoWebhookService, TransactionJeko } from './jeko-webhook.service';

// Appelé par Jèko (pas de JWT) : authentifié par la signature HMAC du corps
// brut. À déclarer dans le Dashboard Jèko → Paramètres → API & Webhooks :
//   https://<api>/api/v1/jeko/webhook
@Controller('jeko')
export class JekoWebhookController {
  constructor(
    private jeko: JekoService,
    private webhooks: JekoWebhookService,
    private config: ConfigService,
  ) {}

  // Page de retour opérateur → app mobile. Les opérateurs exigent une URL
  // http(s) : on y pointe JEKO_SUCCESS_URL / JEKO_ERROR_URL
  // (https://<api>/api/v1/jeko/retour/succes|echec) et on relaie vers le deep
  // link de l'app. Cible fixe (APP_DEEP_LINK_PAIEMENT), paramètres filtrés :
  // pas de redirection ouverte. Simple accélérateur : l'app vérifie toujours
  // le paiement via POST /paiements/reservation/:id/verifier.
  @Get('retour/:statut')
  retour(
    @Param('statut') statut: string,
    @Query('reservationId') reservationId: string | undefined,
    @Query('reference') reference: string | undefined,
    @Res() res: Response,
  ) {
    const cible = new URL(
      this.config.get<string>('APP_DEEP_LINK_PAIEMENT') || 'yego://paiement',
    );
    cible.searchParams.set('statut', statut === 'succes' ? 'succes' : 'echec');
    if (reservationId && /^\d{1,10}$/.test(reservationId)) {
      cible.searchParams.set('reservationId', reservationId);
    }
    if (reference && /^YEGO-P\d+-T\d+$/.test(reference)) {
      cible.searchParams.set('reference', reference);
    }
    const lien = cible.toString();
    const lienHtml = lien.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    res
      .status(302)
      .location(lien)
      .type('html')
      .send(
        `<!doctype html><meta charset="utf-8"><title>Yègo</title>` +
          `<p>Retour vers l'application Yègo…</p><p><a href="${lienHtml}">Ouvrir Yègo</a></p>`,
      );
  }

  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  async recevoir(
    @Req() req: RawBodyRequest<Request>,
    @Headers('jeko-signature') signature: string | undefined,
    @Headers('jeko-event') evenement: string | undefined,
  ) {
    const brut = req.rawBody;
    if (!brut) throw new BadRequestException('Corps de requête manquant');
    if (!this.jeko.verifierSignature(brut, signature)) {
      throw new UnauthorizedException('Signature Jèko invalide');
    }
    let corps: TransactionJeko;
    try {
      corps = JSON.parse(brut.toString('utf8'));
    } catch {
      throw new BadRequestException('Corps JSON invalide');
    }
    // Une erreur inattendue remonte en 500 : Jèko réessaie (et la
    // réconciliation rattrape sinon). Les cas métier ne lèvent pas.
    await this.webhooks.traiter(evenement, corps);
    return { recu: true };
  }
}

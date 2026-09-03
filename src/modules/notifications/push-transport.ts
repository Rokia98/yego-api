import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

export interface PushMessage {
  tokens: string[];
  titre: string;
  corps: string;
  donnees?: Record<string, string>;
}

export interface PushResultat {
  envoyes: number;
  // Jetons rejetés définitivement (désinstallés) : à supprimer en base.
  tokensInvalides: string[];
}

/**
 * Transport d'envoi push. Deux implémentations :
 *  - FCM si FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY sont fournis ;
 *  - journalisation simple sinon (dev / sans compte Firebase).
 * Le choix est fait au démarrage (voir onModuleInit).
 */
@Injectable()
export class PushTransport implements OnModuleInit {
  private readonly logger = new Logger(PushTransport.name);
  private app: admin.app.App | null = null;

  constructor(private config: ConfigService) {}

  onModuleInit(): void {
    const projectId = this.config.get<string>('FCM_PROJECT_ID');
    const clientEmail = this.config.get<string>('FCM_CLIENT_EMAIL');
    const privateKey = this.config
      .get<string>('FCM_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');

    if (projectId && clientEmail && privateKey) {
      this.app =
        admin.apps.length > 0
          ? admin.apps[0]!
          : admin.initializeApp({
              credential: admin.credential.cert({
                projectId,
                clientEmail,
                privateKey,
              }),
            });
      this.logger.log('Notifications push : transport FCM actif.');
    } else {
      this.logger.warn(
        'Notifications push : FCM non configuré, mode journalisation seule.',
      );
    }
  }

  get actif(): boolean {
    return this.app !== null;
  }

  async envoyer(message: PushMessage): Promise<PushResultat> {
    if (message.tokens.length === 0) {
      return { envoyes: 0, tokensInvalides: [] };
    }

    if (!this.app) {
      this.logger.debug(
        `[push simulé] "${message.titre}" → ${message.tokens.length} appareil(s)`,
      );
      return { envoyes: message.tokens.length, tokensInvalides: [] };
    }

    const reponse = await admin.messaging(this.app).sendEachForMulticast({
      tokens: message.tokens,
      notification: { title: message.titre, body: message.corps },
      data: message.donnees ?? {},
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });

    const tokensInvalides: string[] = [];
    reponse.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        tokensInvalides.push(message.tokens[i]);
      }
    });

    return { envoyes: reponse.successCount, tokensInvalides };
  }
}

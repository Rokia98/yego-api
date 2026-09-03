import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { paginer } from '../../common/pagination';
import { PushTransport } from './push-transport';
import { EnregistrerAppareilDto } from './dto/enregistrer-appareil.dto';

export interface Notif {
  type: string;
  titre: string;
  corps: string;
  donnees?: Record<string, string | number>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private push: PushTransport,
  ) {}

  // --- Appareils -----------------------------------------------------------
  async enregistrerAppareil(utilisateurId: number, dto: EnregistrerAppareilDto) {
    // upsert : un même jeton peut être réattribué à un autre utilisateur
    // (revente d'appareil, changement de compte).
    return this.prisma.appareilNotification.upsert({
      where: { token: dto.token },
      create: {
        utilisateurId,
        token: dto.token,
        plateforme: dto.plateforme,
      },
      update: {
        utilisateurId,
        plateforme: dto.plateforme,
        derniereUtilisation: new Date(),
      },
    });
  }

  async retirerAppareil(utilisateurId: number, token: string) {
    await this.prisma.appareilNotification.deleteMany({
      where: { token, utilisateurId },
    });
    return { message: 'Appareil retiré' };
  }

  // --- Envoi -------------------------------------------------------------
  // Persiste la notification (fil in-app) puis tente l'envoi push. Ne lève
  // jamais d'erreur : une notification ne doit pas faire échouer l'action métier.
  async notifier(utilisateurId: number | null | undefined, notif: Notif): Promise<void> {
    if (!utilisateurId) return; // ex. réservation guichet sans compte

    try {
      await this.prisma.notification.create({
        data: {
          utilisateurId,
          type: notif.type,
          titre: notif.titre,
          corps: notif.corps,
          donnees: this.serialiser(notif.donnees),
        },
      });

      const appareils = await this.prisma.appareilNotification.findMany({
        where: { utilisateurId },
        select: { token: true },
      });
      if (appareils.length === 0) return;

      const res = await this.push.envoyer({
        tokens: appareils.map((a) => a.token),
        titre: notif.titre,
        corps: notif.corps,
        donnees: this.enChaines({ type: notif.type, ...notif.donnees }),
      });

      if (res.tokensInvalides.length > 0) {
        await this.prisma.appareilNotification.deleteMany({
          where: { token: { in: res.tokensInvalides } },
        });
      }
    } catch (e) {
      this.logger.error(
        `Échec notification (${notif.type}) pour l'utilisateur ${utilisateurId}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  // --- Fil in-app -------------------------------------------------------
  listerPour(
    utilisateurId: number,
    opts: { skip?: number; take?: number; nonLu?: boolean },
  ) {
    return this.prisma.notification.findMany({
      where: {
        utilisateurId,
        ...(opts.nonLu ? { lu: false } : {}),
      },
      ...paginer(opts.skip, opts.take),
      orderBy: { dateCreation: 'desc' },
    });
  }

  compterNonLues(utilisateurId: number) {
    return this.prisma.notification
      .count({ where: { utilisateurId, lu: false } })
      .then((nonLues) => ({ nonLues }));
  }

  async marquerLu(utilisateurId: number, id: number) {
    const res = await this.prisma.notification.updateMany({
      where: { id, utilisateurId },
      data: { lu: true },
    });
    if (res.count === 0) throw new NotFoundException('Notification introuvable');
    return { message: 'Marquée comme lue' };
  }

  async marquerToutLu(utilisateurId: number) {
    const res = await this.prisma.notification.updateMany({
      where: { utilisateurId, lu: false },
      data: { lu: true },
    });
    return { marquees: res.count };
  }

  private serialiser(
    d?: Record<string, string | number>,
  ): Prisma.InputJsonValue | undefined {
    return d ? (d as Prisma.InputJsonObject) : undefined;
  }

  private enChaines(
    d: Record<string, string | number | undefined>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(d)) {
      if (v !== undefined && v !== null) out[k] = String(v);
    }
    return out;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { paginer } from '../../common/pagination';

export interface AuditEntree {
  action: string;
  entite: string;
  entiteId?: number | null;
  acteurId?: number | null;
  acteurRole?: string | null;
  ip?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Journalise les actions sensibles (remboursements, validation de tickets…).
 * L'écriture ne doit JAMAIS faire échouer l'action métier : toute erreur est
 * seulement loggée.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async record(entree: AuditEntree): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entree.action,
          entite: entree.entite,
          entiteId: entree.entiteId ?? null,
          acteurId: entree.acteurId ?? null,
          acteurRole: entree.acteurRole ?? null,
          ip: entree.ip ?? null,
          metadata: entree.metadata,
        },
      });
    } catch (err) {
      this.logger.error(
        `Échec d'écriture du journal d'audit (${entree.action})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  list(params: {
    skip?: number;
    take?: number;
    entite?: string;
    action?: string;
  }) {
    const { entite, action } = params;
    return this.prisma.auditLog.findMany({
      where: {
        ...(entite ? { entite } : {}),
        ...(action ? { action } : {}),
      },
      ...paginer(params.skip, params.take),
      orderBy: { dateCreation: 'desc' },
      include: {
        acteur: { select: { id: true, nom: true, telephone: true, role: true } },
      },
    });
  }
}

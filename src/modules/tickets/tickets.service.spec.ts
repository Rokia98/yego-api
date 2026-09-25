import { ForbiddenException } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { UserRole } from '../../config/constants';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

const user = (
  role: UserRole,
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser => ({
  userId: 7,
  telephone: '+2250700000003',
  role,
  compagnieId: 1,
  ...overrides,
});

describe('TicketsService.historiqueValidations', () => {
  let prisma: any;
  let service: TicketsService;

  beforeEach(() => {
    prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            entiteId: 10,
            dateCreation: new Date('2026-09-04T09:00:00Z'),
            metadata: { codeQr: 'qr-10', resultat: 'valide' },
          },
          {
            entiteId: null,
            dateCreation: new Date('2026-09-04T08:00:00Z'),
            metadata: { codeQr: 'qr-inconnu', resultat: 'introuvable' },
          },
        ]),
      },
      ticket: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10,
            siege: '3',
            codeQr: 'qr-10',
            reservation: {
              nombrePlaces: 1,
              depart: {
                dateDepart: new Date('2026-09-10'),
                trajet: {
                  heureDepart: new Date('1970-01-01T08:00:00Z'),
                  villeDepart: { nom: 'Korhogo' },
                  villeArrivee: { nom: 'Abidjan' },
                  compagnie: { nom: 'Garantis Transport' },
                },
              },
            },
          },
        ]),
      },
    };
    service = new TicketsService(prisma, { record: jest.fn() } as never);
  });

  it('un agent ne voit que ses propres scans', async () => {
    await service.historiqueValidations(user(UserRole.AGENT), 0, 10);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { action: 'ticket.validation', acteurId: 7 },
      }),
    );
  });

  it('un company_admin voit les scans de sa compagnie', async () => {
    await service.historiqueValidations(user(UserRole.COMPANY_ADMIN), 0, 10);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          action: 'ticket.validation',
          acteur: { compagnieId: 1 },
        },
      }),
    );
  });

  it("un admin voit tout (pas de filtre d'acteur)", async () => {
    await service.historiqueValidations(
      user(UserRole.ADMIN, { compagnieId: null }),
      0,
      10,
    );
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { action: 'ticket.validation' } }),
    );
  });

  it('enrichit avec le trajet, et tolère un ticket introuvable', async () => {
    const res = await service.historiqueValidations(user(UserRole.AGENT), 0, 10);

    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({
      ticketId: 10,
      siege: '3',
      codeQr: 'qr-10',
      resultat: 'valide',
      reservation: {
        depart: { trajet: { villeArrivee: { nom: 'Abidjan' } } },
      },
    });
    expect(res[1]).toMatchObject({
      ticketId: null,
      siege: null,
      codeQr: 'qr-inconnu',
      resultat: 'introuvable',
      reservation: null,
    });
  });
});

describe('TicketsService.valider — cloisonnement par compagnie', () => {
  let prisma: any;
  let audit: { record: jest.Mock };
  let service: TicketsService;

  const ticketCompagnie1 = {
    id: 42,
    statut: 'valide',
    reservation: {
      statut: 'confirmee',
      paiement: { statut: 'paye' },
      depart: { trajet: { compagnieId: 1 } },
    },
  };

  beforeEach(() => {
    audit = { record: jest.fn() };
    prisma = {
      ticket: {
        findUnique: jest.fn().mockResolvedValue(ticketCompagnie1),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new TicketsService(prisma, audit as never);
  });

  it("refuse (403) un agent d'une AUTRE compagnie, journalise l'attempt, ne touche pas le ticket", async () => {
    await expect(
      service.valider('un-code-qr', {
        userId: 8,
        role: UserRole.AGENT,
        compagnieId: 2, // UTB, différent du ticket (compagnie 1)
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ticket.validation',
        entiteId: 42,
        acteurId: 8,
        metadata: expect.objectContaining({ resultat: 'refuse_hors_compagnie' }),
      }),
    );
  });

  it('accepte un agent de la MÊME compagnie', async () => {
    const res = await service.valider('un-code-qr', {
      userId: 5,
      role: UserRole.AGENT,
      compagnieId: 1,
    });
    expect(res.valide).toBe(true);
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 42, statut: 'valide' },
      data: { statut: 'utilise' },
    });
  });

  it("l'admin plateforme n'est jamais bloqué par le cloisonnement", async () => {
    const res = await service.valider('un-code-qr', {
      userId: 1,
      role: UserRole.ADMIN,
      compagnieId: null,
    });
    expect(res.valide).toBe(true);
  });

  it('sans contexte (ctx absent), pas de vérification de portée', async () => {
    const res = await service.valider('un-code-qr');
    expect(res.valide).toBe(true);
  });
});

describe('TicketsService.valider — réservation et paiement', () => {
  let prisma: any;
  let audit: { record: jest.Mock };
  let service: TicketsService;

  const ticket = (reservation: Record<string, unknown>) => ({
    id: 42,
    statut: 'valide',
    reservation: {
      statut: 'confirmee',
      paiement: { statut: 'paye' },
      depart: { trajet: { compagnieId: 1 } },
      ...reservation,
    },
  });
  const agent = { userId: 5, role: UserRole.AGENT, compagnieId: 1 };

  beforeEach(() => {
    audit = { record: jest.fn() };
    prisma = {
      ticket: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new TicketsService(prisma, audit as never);
  });

  it("refuse le ticket d'une réservation annulée (même si le ticket est resté 'valide')", async () => {
    prisma.ticket.findUnique.mockResolvedValue(ticket({ statut: 'annulee' }));
    const res = await service.valider('qr', agent);
    expect(res.valide).toBe(false);
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ resultat: 'reservation_annulee' }),
      }),
    );
  });

  it('refuse le ticket si le paiement a été remboursé', async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      ticket({ paiement: { statut: 'rembourse' } }),
    );
    const res = await service.valider('qr', agent);
    expect(res.valide).toBe(false);
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
  });

  it('scan concurrent : si le ticket a été utilisé entre-temps → déjà utilisé', async () => {
    prisma.ticket.findUnique.mockResolvedValue(ticket({}));
    prisma.ticket.updateMany.mockResolvedValue({ count: 0 });
    const res = await service.valider('qr', agent);
    expect(res).toEqual({ valide: false, message: 'Ticket déjà utilisé' });
  });
});

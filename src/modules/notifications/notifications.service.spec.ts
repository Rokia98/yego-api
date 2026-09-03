import { NotificationsService } from './notifications.service';

describe('NotificationsService.notifier', () => {
  let prisma: any;
  let push: { envoyer: jest.Mock };
  let service: NotificationsService;

  beforeEach(() => {
    prisma = {
      notification: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      appareilNotification: {
        findMany: jest.fn().mockResolvedValue([{ token: 'tok-a' }, { token: 'tok-b' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    push = { envoyer: jest.fn().mockResolvedValue({ envoyes: 2, tokensInvalides: [] }) };
    service = new NotificationsService(prisma, push as never);
  });

  const notif = { type: 'paiement.confirme', titre: 'T', corps: 'C', donnees: { reservationId: 5 } };

  it("ne fait rien si l'utilisateur est null (réservation guichet)", async () => {
    await service.notifier(null, notif);
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(push.envoyer).not.toHaveBeenCalled();
  });

  it('persiste la notification puis envoie le push', async () => {
    await service.notifier(42, notif);
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ utilisateurId: 42, type: 'paiement.confirme' }),
      }),
    );
    expect(push.envoyer).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['tok-a', 'tok-b'] }),
    );
  });

  it('supprime les jetons rejetés par FCM', async () => {
    push.envoyer.mockResolvedValue({ envoyes: 1, tokensInvalides: ['tok-b'] });
    await service.notifier(42, notif);
    expect(prisma.appareilNotification.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: ['tok-b'] } },
    });
  });

  it("n'échoue jamais si le push lève une erreur", async () => {
    push.envoyer.mockRejectedValue(new Error('FCM down'));
    await expect(service.notifier(42, notif)).resolves.toBeUndefined();
  });
});

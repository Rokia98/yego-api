import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentsService, detecterType } from './documents.service';
import { UserRole } from '../../config/constants';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(true),
  unlinkSync: jest.fn(),
  mkdirSync: jest.fn(),
  createReadStream: jest.fn().mockReturnValue({ pipe: jest.fn() }),
}));
const fs = jest.requireMock('fs');

const gestionnaire = (compagnieId: number | null): AuthenticatedUser => ({
  userId: 2,
  telephone: '+2250700000002',
  role: UserRole.COMPANY_ADMIN,
  compagnieId,
});
const admin: AuthenticatedUser = {
  userId: 1,
  telephone: '+2250700000001',
  role: UserRole.ADMIN,
  compagnieId: null,
};

const fichier = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File =>
  ({
    fieldname: 'document',
    originalname: 'registre.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('%PDF-1.4 contenu'),
    ...overrides,
  }) as Express.Multer.File;

describe('detecterType', () => {
  it('reconnaît PDF, PNG et JPEG à leur signature, rien d’autre', () => {
    expect(detecterType(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(detecterType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(detecterType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(detecterType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(detecterType(undefined)).toBeNull();
  });
});

describe('DocumentsService', () => {
  let prisma: any;
  let service: DocumentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      compagnie: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
      compagnieDocument: {
        create: jest.fn().mockResolvedValue({ id: 10, compagnieId: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({
          id: 10,
          compagnieId: 1,
          cheminFichier: '/app/uploads/compagnies/1/x.pdf',
          mimeType: 'application/pdf',
          nomFichier: 'registre.pdf',
        }),
        update: jest.fn().mockResolvedValue({ id: 10, statut: 'valide' }),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    service = new DocumentsService(prisma);
  });

  describe('upload', () => {
    it('refuse si la compagnie est introuvable (404)', async () => {
      prisma.compagnie.findUnique.mockResolvedValue(null);
      await expect(
        service.upload(1, gestionnaire(1), 'registre_commerce', fichier()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("refuse un gestionnaire d'une autre compagnie (403), avant tout accès disque", async () => {
      await expect(
        service.upload(1, gestionnaire(2), 'registre_commerce', fichier()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('refuse sans fichier (400)', async () => {
      await expect(
        service.upload(1, gestionnaire(1), 'registre_commerce', undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuse un type MIME non autorisé (400)', async () => {
      await expect(
        service.upload(1, gestionnaire(1), 'registre_commerce', fichier({ mimetype: 'text/plain' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('refuse un fichier trop volumineux (400)', async () => {
      await expect(
        service.upload(1, gestionnaire(1), 'registre_commerce', fichier({ size: 10 * 1024 * 1024 })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('écrit le fichier puis crée la ligne (admin, toute compagnie)', async () => {
      await service.upload(1, admin, 'piece_identite_gerant', fichier());
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      expect(prisma.compagnieDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            compagnieId: 1,
            type: 'piece_identite_gerant',
            nomFichier: 'registre.pdf',
            tailleOctets: 1024,
            mimeType: 'application/pdf',
          }),
        }),
      );
    });
  });

  describe('supprimer', () => {
    it("supprime le fichier disque puis la ligne", async () => {
      await service.supprimer(1, 10, gestionnaire(1));
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(prisma.compagnieDocument.delete).toHaveBeenCalledWith({ where: { id: 10 } });
    });

    it("404 si le document n'appartient pas à cette compagnie", async () => {
      prisma.compagnieDocument.findUnique.mockResolvedValue({
        id: 10,
        compagnieId: 2,
        cheminFichier: 'x',
      });
      await expect(service.supprimer(1, 10, admin)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('revoir', () => {
    it('pose statut + commentaire + dateRevue', async () => {
      await service.revoir(1, 10, { statut: 'refuse', commentaireAdmin: 'illisible' });
      expect(prisma.compagnieDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statut: 'refuse', commentaireAdmin: 'illisible' }),
        }),
      );
    });
  });
});

import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Un seul client Prisma (donc un seul pool de connexions) pour toute l'API.
// Le déclarer dans chaque module créait un pool par module : ~25 connexions
// ouvertes au démarrage, assez pour saturer une base hébergée (Neon).
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

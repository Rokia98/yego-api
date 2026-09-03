import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { UtilisateursService } from './utilisateurs.service';
import { UtilisateursController } from './utilisateurs.controller';

@Module({
  providers: [UtilisateursService, PrismaService],
  controllers: [UtilisateursController],
  exports: [UtilisateursService],
})
export class UtilisateursModule {}

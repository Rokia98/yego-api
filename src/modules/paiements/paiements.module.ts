import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PaiementsService } from './paiements.service';
import { PaiementsController } from './paiements.controller';

@Module({
  providers: [PaiementsService, PrismaService],
  controllers: [PaiementsController],
  exports: [PaiementsService],
})
export class PaiementsModule {}

import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AbonnementsService } from './abonnements.service';
import { AbonnementsController } from './abonnements.controller';

@Module({
  providers: [AbonnementsService, PrismaService],
  controllers: [AbonnementsController],
  exports: [AbonnementsService],
})
export class AbonnementsModule {}

import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { RemboursementsService } from './remboursements.service';
import { RemboursementsController } from './remboursements.controller';

@Module({
  providers: [RemboursementsService, PrismaService],
  controllers: [RemboursementsController],
  exports: [RemboursementsService],
})
export class RemboursementsModule {}

import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ReversementsService } from './reversements.service';
import { ReversementsController } from './reversements.controller';

@Module({
  providers: [ReversementsService, PrismaService],
  controllers: [ReversementsController],
  exports: [ReversementsService],
})
export class ReversementsModule {}

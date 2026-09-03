import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TrajetsService } from './trajets.service';
import { TrajetsController } from './trajets.controller';

@Module({
  providers: [TrajetsService, PrismaService],
  controllers: [TrajetsController],
  exports: [TrajetsService],
})
export class TrajetsModule {}

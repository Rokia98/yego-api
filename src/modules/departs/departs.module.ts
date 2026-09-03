import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { DepartsService } from './departs.service';
import { DepartsController } from './departs.controller';

@Module({
  providers: [DepartsService, PrismaService],
  controllers: [DepartsController],
  exports: [DepartsService],
})
export class DepartsModule {}

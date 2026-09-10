import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  providers: [DashboardService, PrismaService],
  controllers: [DashboardController],
  exports: [DashboardService],
})
export class DashboardModule {}

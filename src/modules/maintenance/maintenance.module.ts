import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MaintenanceService } from './maintenance.service';

@Module({
  providers: [MaintenanceService, PrismaService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}

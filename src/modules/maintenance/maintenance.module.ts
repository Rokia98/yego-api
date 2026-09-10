import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MaintenanceService } from './maintenance.service';
import { SuiviModule } from '../suivi/suivi.module';

@Module({
  imports: [SuiviModule],
  providers: [MaintenanceService, PrismaService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}

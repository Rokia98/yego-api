import { Module } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { SuiviModule } from '../suivi/suivi.module';

@Module({
  imports: [SuiviModule],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}

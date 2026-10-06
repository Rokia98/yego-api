import { Module } from '@nestjs/common';
import { SuiviService } from './suivi.service';
import { SuiviController } from './suivi.controller';

@Module({
  providers: [SuiviService],
  controllers: [SuiviController],
  exports: [SuiviService],
})
export class SuiviModule {}

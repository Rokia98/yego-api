import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { SuiviService } from './suivi.service';
import { SuiviController } from './suivi.controller';

@Module({
  providers: [SuiviService, PrismaService],
  controllers: [SuiviController],
  exports: [SuiviService],
})
export class SuiviModule {}

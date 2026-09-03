import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { VehiculesService } from './vehicules.service';
import { VehiculesController } from './vehicules.controller';

@Module({
  providers: [VehiculesService, PrismaService],
  controllers: [VehiculesController],
  exports: [VehiculesService],
})
export class VehiculesModule {}

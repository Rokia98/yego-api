import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { VillesService } from './villes.service';
import { VillesController } from './villes.controller';

@Module({
  providers: [VillesService, PrismaService],
  controllers: [VillesController],
  exports: [VillesService],
})
export class VillesModule {}

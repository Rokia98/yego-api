import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CompagniesService } from './compagnies.service';
import { CompagniesController } from './compagnies.controller';

@Module({
  providers: [CompagniesService, PrismaService],
  controllers: [CompagniesController],
  exports: [CompagniesService],
})
export class CompagniesModule {}

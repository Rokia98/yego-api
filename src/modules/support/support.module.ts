import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';

@Module({
  providers: [SupportService, PrismaService],
  controllers: [SupportController],
})
export class SupportModule {}

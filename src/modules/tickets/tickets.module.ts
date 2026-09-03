import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';

@Module({
  providers: [TicketsService, PrismaService],
  controllers: [TicketsController],
  exports: [TicketsService],
})
export class TicketsModule {}

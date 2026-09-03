import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';

@Module({
  providers: [AgentsService, PrismaService],
  controllers: [AgentsController],
  exports: [AgentsService],
})
export class AgentsModule {}

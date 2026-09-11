import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';

@Module({
  providers: [DocumentsService, PrismaService],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}

import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

// Global : n'importe quel service peut injecter AuditService sans réimporter.
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, PrismaService],
  exports: [AuditService],
})
export class AuditModule {}

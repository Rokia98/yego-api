import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PushTransport } from './push-transport';

// Global : n'importe quel service métier peut injecter NotificationsService.
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, PushTransport, PrismaService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

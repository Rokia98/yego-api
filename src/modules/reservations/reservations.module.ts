import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';
import { ReservationExpirationService } from './reservation-expiration.service';

@Module({
  providers: [ReservationsService, ReservationExpirationService, PrismaService],
  controllers: [ReservationsController],
  exports: [ReservationsService, ReservationExpirationService],
})
export class ReservationsModule {}

import { Module } from '@nestjs/common';
import { AbonnementsService } from './abonnements.service';
import { AbonnementsController } from './abonnements.controller';

@Module({
  providers: [AbonnementsService],
  controllers: [AbonnementsController],
  exports: [AbonnementsService],
})
export class AbonnementsModule {}

import { Module } from '@nestjs/common';
import { ReversementsService } from './reversements.service';
import { ReversementsController } from './reversements.controller';
import { RetraitsService } from './retraits.service';
import { RetraitsController } from './retraits.controller';

@Module({
  providers: [ReversementsService, RetraitsService],
  controllers: [ReversementsController, RetraitsController],
  exports: [ReversementsService, RetraitsService],
})
export class ReversementsModule {}

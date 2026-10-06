import { Module } from '@nestjs/common';
import { ReversementsService } from './reversements.service';
import { ReversementsController } from './reversements.controller';

@Module({
  providers: [ReversementsService],
  controllers: [ReversementsController],
  exports: [ReversementsService],
})
export class ReversementsModule {}

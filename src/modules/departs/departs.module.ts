import { Module } from '@nestjs/common';
import { DepartsService } from './departs.service';
import { DepartsController } from './departs.controller';

@Module({
  providers: [DepartsService],
  controllers: [DepartsController],
  exports: [DepartsService],
})
export class DepartsModule {}

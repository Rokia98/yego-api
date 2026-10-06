import { Module } from '@nestjs/common';
import { TrajetsService } from './trajets.service';
import { TrajetsController } from './trajets.controller';

@Module({
  providers: [TrajetsService],
  controllers: [TrajetsController],
  exports: [TrajetsService],
})
export class TrajetsModule {}

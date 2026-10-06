import { Module } from '@nestjs/common';
import { CompagniesService } from './compagnies.service';
import { CompagniesController } from './compagnies.controller';

@Module({
  providers: [CompagniesService],
  controllers: [CompagniesController],
  exports: [CompagniesService],
})
export class CompagniesModule {}

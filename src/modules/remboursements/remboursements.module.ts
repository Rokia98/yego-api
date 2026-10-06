import { Module } from '@nestjs/common';
import { RemboursementsService } from './remboursements.service';
import { RemboursementsController } from './remboursements.controller';

@Module({
  providers: [RemboursementsService],
  controllers: [RemboursementsController],
  exports: [RemboursementsService],
})
export class RemboursementsModule {}

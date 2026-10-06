import { Module } from '@nestjs/common';
import { ChauffeursService } from './chauffeurs.service';
import { ChauffeursController } from './chauffeurs.controller';

@Module({
  providers: [ChauffeursService],
  controllers: [ChauffeursController],
  exports: [ChauffeursService],
})
export class ChauffeursModule {}

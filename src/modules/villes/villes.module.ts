import { Module } from '@nestjs/common';
import { VillesService } from './villes.service';
import { VillesController } from './villes.controller';

@Module({
  providers: [VillesService],
  controllers: [VillesController],
  exports: [VillesService],
})
export class VillesModule {}

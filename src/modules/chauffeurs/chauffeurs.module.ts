import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ChauffeursService } from './chauffeurs.service';
import { ChauffeursController } from './chauffeurs.controller';

@Module({
  providers: [ChauffeursService, PrismaService],
  controllers: [ChauffeursController],
  exports: [ChauffeursService],
})
export class ChauffeursModule {}

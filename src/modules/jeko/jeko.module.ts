import { Global, Module } from '@nestjs/common';
import { JekoService } from './jeko.service';

// Client Jèko partagé (paiements, remboursements, reversements).
@Global()
@Module({
  providers: [JekoService],
  exports: [JekoService],
})
export class JekoModule {}

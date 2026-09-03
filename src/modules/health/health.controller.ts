import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../prisma.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  // Sonde de liveness : le process répond.
  @SkipThrottle()
  @Get()
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // Sonde de readiness : la base de données est joignable.
  // Utilisée par le healthcheck Docker / l'orchestrateur avant d'envoyer du trafic.
  @SkipThrottle()
  @Get('ready')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'unreachable',
      });
    }
    return { status: 'ok', database: 'ok', timestamp: new Date().toISOString() };
  }
}

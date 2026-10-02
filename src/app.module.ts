import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { validate } from './config/env.validation';
import { PrismaService } from './prisma.service';
import { HealthModule } from './modules/health/health.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { AgentsModule } from './modules/agents/agents.module';
import { AbonnementsModule } from './modules/abonnements/abonnements.module';
import { UtilisateursModule } from './modules/utilisateurs/utilisateurs.module';
import { CompagniesModule } from './modules/compagnies/compagnies.module';
import { TrajetsModule } from './modules/trajets/trajets.module';
import { VehiculesModule } from './modules/vehicules/vehicules.module';
import { ChauffeursModule } from './modules/chauffeurs/chauffeurs.module';
import { DepartsModule } from './modules/departs/departs.module';
import { VillesModule } from './modules/villes/villes.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { RemboursementsModule } from './modules/remboursements/remboursements.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { PaiementsModule } from './modules/paiements/paiements.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SuiviModule } from './modules/suivi/suivi.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SupportModule } from './modules/support/support.module';
import { JekoModule } from './modules/jeko/jeko.module';
import { JekoIntegrationModule } from './modules/jeko/jeko-integration.module';
import { ReversementsModule } from './modules/reversements/reversements.module';

@Module({
  imports: [
    // Charge .env et valide le schéma d'environnement au démarrage :
    // un secret manquant ou trop faible empêche le boot (voir env.validation.ts).
    ConfigModule.forRoot({ isGlobal: true, validate }),
    // Tâches planifiées (expiration des réservations non payées).
    ScheduleModule.forRoot(),
    // Limite globale par défaut ; des limites plus strictes sont appliquées
    // sur les routes sensibles (voir auth.controller.ts) via @Throttle().
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    HealthModule,
    MaintenanceModule,
    NotificationsModule,
    AuditModule,
    AuthModule,
    AgentsModule,
    AbonnementsModule,
    UtilisateursModule,
    CompagniesModule,
    TrajetsModule,
    VehiculesModule,
    ChauffeursModule,
    DepartsModule,
    VillesModule,
    ReservationsModule,
    RemboursementsModule,
    TicketsModule,
    PaiementsModule,
    DashboardModule,
    SuiviModule,
    DocumentsModule,
    SupportModule,
    JekoModule,
    ReversementsModule,
    JekoIntegrationModule,
  ],
  providers: [
    PrismaService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [PrismaService],
})
export class AppModule {}

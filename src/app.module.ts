import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { MutationAuditGuard } from './audit/guards/mutation-audit.guard';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { ClientsModule } from './clients/clients.module';
import { CreditInquiriesModule } from './credit-inquiries/credit-inquiries.module';
import { CatalogModule } from './catalog/catalog.module';
import { validateEnvironment } from './config/environment';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { InventoryModule } from './inventory/inventory.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { SupplyModule } from './supply/supply.module';
import { SalesModule } from './sales/sales.module';
import { UsersModule } from './users/users.module';
import { CashModule } from './cash/cash.module';
import { ExpensesModule } from './expenses/expenses.module';
import { VehiclePaymentsModule } from './vehicle-payments/vehicle-payments.module';
import { IncomesModule } from './incomes/incomes.module';
import { SupplierPurchasesModule } from './supplier-purchases/supplier-purchases.module';
import { CommissionsModule } from './commissions/commissions.module';
import { CreditPlansModule } from './credit-plans/credit-plans.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 100,
      },
    ]),
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
    MailModule,
    UsersModule,
    RolesModule,
    ClientsModule,
    CreditInquiriesModule,
    CatalogModule,
    InventoryModule,
    SuppliersModule,
    SupplyModule,
    SalesModule,
    CashModule,
    SupplierPurchasesModule,
    IncomesModule,
    ExpensesModule,
    VehiclePaymentsModule,
    CommissionsModule,
    CreditPlansModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_GUARD,
      useClass: MutationAuditGuard,
    },
  ],
})
export class AppModule {}

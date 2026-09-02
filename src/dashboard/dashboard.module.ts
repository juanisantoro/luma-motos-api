import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { ClientsModule } from '../clients/clients.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { CreditInquiriesModule } from '../credit-inquiries/credit-inquiries.module';
import { CreditPlansModule } from '../credit-plans/credit-plans.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesModule } from '../sales/sales.module';
import { SupplierPurchasesModule } from '../supplier-purchases/supplier-purchases.module';
import { VehiclePaymentsModule } from '../vehicle-payments/vehicle-payments.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// This module orchestrates the home-screen aggregations only - it injects
// and reuses the business services below rather than re-implementing their
// query logic. It never mutates anything.
@Module({
  imports: [
    SalesModule,
    CommissionsModule,
    CashModule,
    CreditPlansModule,
    CreditInquiriesModule,
    InventoryModule,
    ClientsModule,
    SupplierPurchasesModule,
    VehiclePaymentsModule,
    ExpensesModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}

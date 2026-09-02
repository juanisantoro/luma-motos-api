import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { SupplierPurchasesController } from './supplier-purchases.controller';
import { SupplierPurchasesService } from './supplier-purchases.service';

@Module({
  imports: [CashModule],
  controllers: [SupplierPurchasesController],
  providers: [SupplierPurchasesService],
  exports: [SupplierPurchasesService],
})
export class SupplierPurchasesModule {}

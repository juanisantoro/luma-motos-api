import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';

// Sólo lectura: junta lo que ya cargan Ingresos, Gastos, Gastos de motos y
// autos, Compras y Comisiones, por mes de trabajo.
@Module({
  imports: [SalesModule],
  controllers: [BalanceController],
  providers: [BalanceService],
})
export class BalanceModule {}

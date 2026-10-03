import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesModule } from '../sales/sales.module';
import { VehiclePaymentsModule } from '../vehicle-payments/vehicle-payments.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AssistantToolsService } from './assistant.tools';

// Los módulos importados sólo aportan los servicios de lectura que usan las
// consultas de datos de Lumi (ver assistant.tools.ts).
@Module({
  imports: [SalesModule, VehiclePaymentsModule, InventoryModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantToolsService],
})
export class AssistantModule {}

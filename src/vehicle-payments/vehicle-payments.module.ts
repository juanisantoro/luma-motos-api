import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { VehiclePaymentsController } from './vehicle-payments.controller';
import { VehiclePaymentsService } from './vehicle-payments.service';

@Module({
  imports: [CashModule],
  controllers: [VehiclePaymentsController],
  providers: [VehiclePaymentsService],
  exports: [VehiclePaymentsService],
})
export class VehiclePaymentsModule {}

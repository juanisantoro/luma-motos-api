import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { ServiceOrdersController } from './service-orders.controller';
import { ServiceOrdersService } from './service-orders.service';

@Module({
  imports: [CashModule],
  controllers: [ServiceOrdersController],
  providers: [ServiceOrdersService],
  exports: [ServiceOrdersService],
})
export class ServiceOrdersModule {}

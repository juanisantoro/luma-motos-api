import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { ServiceOrdersController } from './service-orders.controller';
import { ServiceOrdersService } from './service-orders.service';
import { ServiceRemindersController } from './service-reminders.controller';
import { ServiceRemindersService } from './service-reminders.service';

@Module({
  imports: [CashModule],
  controllers: [ServiceOrdersController, ServiceRemindersController],
  providers: [ServiceOrdersService, ServiceRemindersService],
  exports: [ServiceOrdersService, ServiceRemindersService],
})
export class ServiceOrdersModule {}

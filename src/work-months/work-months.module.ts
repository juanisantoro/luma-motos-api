import { Global, Module } from '@nestjs/common';
import { WorkMonthsController } from './work-months.controller';
import { WorkMonthsService } from './work-months.service';

// Global: comisiones, ventas e inicio usan el mismo calendario.
@Global()
@Module({
  controllers: [WorkMonthsController],
  providers: [WorkMonthsService],
  exports: [WorkMonthsService],
})
export class WorkMonthsModule {}

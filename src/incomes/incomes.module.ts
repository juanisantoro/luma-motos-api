import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { IncomesController } from './incomes.controller';
import { IncomesService } from './incomes.service';

@Module({
  imports: [CashModule],
  controllers: [IncomesController],
  providers: [IncomesService],
})
export class IncomesModule {}

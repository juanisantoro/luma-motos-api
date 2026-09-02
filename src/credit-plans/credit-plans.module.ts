import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { CreditPlansController } from './credit-plans.controller';
import { CreditPlansService } from './credit-plans.service';

@Module({
  imports: [CashModule],
  controllers: [CreditPlansController],
  providers: [CreditPlansService],
  exports: [CreditPlansService],
})
export class CreditPlansModule {}

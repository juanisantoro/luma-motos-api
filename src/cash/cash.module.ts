import { Module } from '@nestjs/common';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';
import { PartnerWithdrawalsService } from './partner-withdrawals.service';

@Module({
  controllers: [CashController],
  providers: [CashService, PartnerWithdrawalsService],
  exports: [CashService],
})
export class CashModule {}

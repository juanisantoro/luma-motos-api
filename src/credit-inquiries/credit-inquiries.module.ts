import { Module } from '@nestjs/common';
import {
  CreditInquiriesController,
  FinancialInstitutionsController,
} from './credit-inquiries.controller';
import { CreditInquiriesService } from './credit-inquiries.service';
import { IdempotencyKeyPipe } from './idempotency-key.pipe';

@Module({
  controllers: [CreditInquiriesController, FinancialInstitutionsController],
  providers: [CreditInquiriesService, IdempotencyKeyPipe],
  exports: [CreditInquiriesService],
})
export class CreditInquiriesModule {}

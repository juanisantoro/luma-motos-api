import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AuditedMutation } from '../audit/decorators/audited-mutation.decorator';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  AnyPermissions,
  Permissions,
} from '../auth/decorators/permissions.decorator';
import {
  CreateCreditInquiryDto,
  CreateFinancialInstitutionDto,
  CreditHistoryQueryDto,
  FinancialInstitutionListQueryDto,
  ReferenceListQueryDto,
  RejectedInquiryQueryDto,
  VerifyDocumentQueryDto,
} from './credit-inquiries.dto';
import { CreditInquiriesService } from './credit-inquiries.service';
import { IdempotencyKeyPipe } from './idempotency-key.pipe';

@Controller('credit-inquiries')
export class CreditInquiriesController {
  constructor(
    private readonly service: CreditInquiriesService,
    private readonly idempotencyKeyPipe: IdempotencyKeyPipe,
  ) {}

  @Get('rejected')
  @Permissions(PERMISSION_CODES.CREDIT_INQUIRIES_READ)
  findRejected(
    @Query() query: RejectedInquiryQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findRejected(query, actor);
  }

  @Get('verify')
  @Permissions(PERMISSION_CODES.CREDIT_INQUIRIES_VERIFY)
  verifyDocument(
    @Query() query: VerifyDocumentQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.verifyDocument(query, actor);
  }

  @Get('clients/:clientId/history')
  @Permissions(PERMISSION_CODES.CREDIT_INQUIRIES_READ)
  findClientHistory(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query() query: CreditHistoryQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findClientHistory(clientId, query, actor);
  }

  @Get('registrants')
  @Permissions(PERMISSION_CODES.CREDIT_INQUIRIES_READ)
  findRegistrants(
    @Query() query: ReferenceListQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findRegistrants(query, actor);
  }

  @Get('branches')
  @AnyPermissions(
    PERMISSION_CODES.CREDIT_INQUIRIES_READ,
    PERMISSION_CODES.CREDIT_INQUIRIES_VERIFY,
    PERMISSION_CODES.CREDIT_INQUIRIES_CREATE,
  )
  findBranches(
    @Query() query: ReferenceListQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findBranches(query, actor);
  }

  @Post()
  @Permissions(PERMISSION_CODES.CREDIT_INQUIRIES_CREATE)
  @AuditedMutation()
  create(
    @Body() input: CreateCreditInquiryDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.create(
      input,
      this.idempotencyKeyPipe.transform(idempotencyKey),
      actor,
    );
  }
}

@Controller('financial-institutions')
export class FinancialInstitutionsController {
  constructor(private readonly service: CreditInquiriesService) {}

  @Get()
  @AnyPermissions(
    PERMISSION_CODES.CREDIT_INQUIRIES_READ,
    PERMISSION_CODES.CREDIT_INQUIRIES_CREATE,
  )
  findAll(
    @Query() query: FinancialInstitutionListQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findFinancialInstitutions(query, actor);
  }

  @Post()
  @Permissions(PERMISSION_CODES.FINANCIAL_INSTITUTIONS_MANAGE)
  @AuditedMutation()
  create(
    @Body() input: CreateFinancialInstitutionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.createFinancialInstitution(input, actor);
  }
}

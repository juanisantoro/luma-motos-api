import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditedMutation } from '../audit/decorators/audited-mutation.decorator';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  ConfirmOperationCreditDto,
  CreateCreditPlanDto,
  CreditInstallmentQueryDto,
  CreditPlanQueryDto,
  PayCreditInstallmentDto,
  UpdateCreditPlanDto,
} from './credit-plans.dto';
import { CreditPlansService } from './credit-plans.service';

@Controller('credit-plans')
@Permissions(PERMISSION_CODES.CREDIT_PLANS_READ)
export class CreditPlansController {
  constructor(private readonly service: CreditPlansService) {}

  @Get()
  findAll(
    @Query() query: CreditPlanQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.listPlans(query, actor);
  }

  @Post()
  @Permissions(PERMISSION_CODES.CREDIT_PLANS_MANAGE)
  @AuditedMutation()
  create(
    @Body() input: CreateCreditPlanDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.createPlan(input, actor);
  }

  @Patch(':id')
  @Permissions(PERMISSION_CODES.CREDIT_PLANS_MANAGE)
  @AuditedMutation()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateCreditPlanDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.updatePlan(id, input, actor);
  }

  @Get('installments')
  @Permissions(PERMISSION_CODES.CREDIT_PLANS_READ)
  installments(
    @Query() query: CreditInstallmentQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.listInstallments(query, actor);
  }

  @Post('installments/:id/pay')
  @Permissions(PERMISSION_CODES.CREDIT_PLANS_COLLECT)
  @AuditedMutation()
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: PayCreditInstallmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.payInstallment(id, input, actor);
  }

  @Get('operations/:operationId')
  async operationCredit(
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const credit = await this.service.getOperationCredit(operationId, actor);
    if (!credit) throw new NotFoundException('This operation has no credit plan');
    return credit;
  }

  @Post('operations/:operationId')
  // Any user who can create/complete a sales operation should be able to
  // attach the personal credit plan the customer accepted, even without
  // creditos.gestionar (that permission is reserved for administering the
  // plan catalog itself, not for a single sale's own payment method).
  @Permissions(PERMISSION_CODES.SALES_MANAGE)
  @AuditedMutation()
  confirm(
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @Body() input: ConfirmOperationCreditDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.confirmOperationCredit(operationId, input, actor);
  }
}

import {
  Body,
  Controller,
  Get,
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
  CreateExpenseDto,
  ExpenseQueryDto,
  RegisterFinancialMovementDto,
  ReverseFinancialMovementDto,
  UpdateExpenseDto,
} from '../finance/finance.dto';
import { ExpensesService } from './expenses.service';

@Controller('expenses')
@Permissions(PERMISSION_CODES.EXPENSES_READ)
export class ExpensesController {
  constructor(private readonly service: ExpensesService) {}

  @Get()
  findAll(
    @Query() query: ExpenseQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findAll(query, actor);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findOne(id, actor);
  }

  @Post()
  @Permissions(PERMISSION_CODES.EXPENSES_MANAGE)
  @AuditedMutation()
  create(
    @Body() input: CreateExpenseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.create(input, actor);
  }

  @Patch(':id')
  @Permissions(PERMISSION_CODES.EXPENSES_MANAGE)
  @AuditedMutation()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateExpenseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.update(id, input, actor);
  }

  @Post(':id/payments')
  @Permissions(PERMISSION_CODES.EXPENSES_PAY)
  @AuditedMutation()
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RegisterFinancialMovementDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.pay(id, input, actor);
  }

  @Post(':id/recoveries')
  @Permissions(PERMISSION_CODES.EXPENSES_RECOVER)
  @AuditedMutation()
  recover(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RegisterFinancialMovementDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.recover(id, input, actor);
  }

  @Post(':id/movements/:movementId/reverse')
  @Permissions(PERMISSION_CODES.CASH_REVERSE)
  @AuditedMutation()
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('movementId', ParseUUIDPipe) movementId: string,
    @Body() input: ReverseFinancialMovementDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.reverse(id, movementId, input, actor);
  }
}

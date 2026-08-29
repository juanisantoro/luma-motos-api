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
  CashAccountQueryDto,
  CashMovementQueryDto,
  CashTransferQueryDto,
  CreateCashAccountDto,
  CreateCashTransferDto,
  ReverseFinancialMovementDto,
  UpdateCashAccountDto,
} from '../finance/finance.dto';
import { CashService } from './cash.service';

@Controller('cash')
export class CashController {
  constructor(private readonly service: CashService) {}

  @Get('accounts')
  @Permissions(PERMISSION_CODES.CASH_READ)
  accounts(
    @Query() query: CashAccountQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findAccounts(query, actor);
  }

  @Get('accounts/:id')
  @Permissions(PERMISSION_CODES.CASH_READ)
  account(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findAccount(id, actor);
  }

  @Post('accounts')
  @Permissions(PERMISSION_CODES.CASH_MANAGE)
  @AuditedMutation()
  createAccount(
    @Body() input: CreateCashAccountDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.createAccount(input, actor);
  }

  @Patch('accounts/:id')
  @Permissions(PERMISSION_CODES.CASH_MANAGE)
  @AuditedMutation()
  updateAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateCashAccountDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.updateAccount(id, input, actor);
  }

  @Get('movements')
  @Permissions(PERMISSION_CODES.CASH_READ)
  movements(
    @Query() query: CashMovementQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findMovements(query, actor);
  }

  @Get('transfers')
  @Permissions(PERMISSION_CODES.CASH_READ)
  transfers(
    @Query() query: CashTransferQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findTransfers(query, actor);
  }

  @Get('transfers/:id')
  @Permissions(PERMISSION_CODES.CASH_READ)
  transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findTransfer(id, actor);
  }

  @Post('transfers')
  @Permissions(PERMISSION_CODES.CASH_TRANSFER)
  @AuditedMutation()
  createTransfer(
    @Body() input: CreateCashTransferDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.createTransfer(input, actor);
  }

  @Post('transfers/:id/reverse')
  @Permissions(PERMISSION_CODES.CASH_REVERSE)
  @AuditedMutation()
  reverseTransfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReverseFinancialMovementDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.reverseTransfer(id, input, actor);
  }
}

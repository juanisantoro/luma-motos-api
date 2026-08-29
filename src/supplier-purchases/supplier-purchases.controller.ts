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
  CreateSupplierPurchaseDto,
  RegisterFinancialMovementDto,
  ReverseFinancialMovementDto,
  SupplierPurchaseQueryDto,
  UpdateSupplierPurchaseDto,
} from '../finance/finance.dto';
import { SupplierPurchasesService } from './supplier-purchases.service';

@Controller('supplier-purchases')
@Permissions(PERMISSION_CODES.PURCHASES_READ)
export class SupplierPurchasesController {
  constructor(private readonly service: SupplierPurchasesService) {}

  @Get()
  findAll(
    @Query() query: SupplierPurchaseQueryDto,
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
  @Permissions(PERMISSION_CODES.PURCHASES_MANAGE)
  @AuditedMutation()
  create(
    @Body() input: CreateSupplierPurchaseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.create(input, actor);
  }

  @Patch(':id')
  @Permissions(PERMISSION_CODES.PURCHASES_MANAGE)
  @AuditedMutation()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateSupplierPurchaseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.update(id, input, actor);
  }

  @Post(':id/payments')
  @Permissions(PERMISSION_CODES.PURCHASES_PAY)
  @AuditedMutation()
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RegisterFinancialMovementDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.pay(id, input, actor);
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

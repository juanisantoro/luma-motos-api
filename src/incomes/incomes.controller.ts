import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { tipo_vehiculo_luma } from '@prisma/client';
import { AuditedMutation } from '../audit/decorators/audited-mutation.decorator';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  ConfirmCashHandoverDto,
  CreateIncomeDto,
  IncomeQueryDto,
  RegisterFinancialMovementDto,
  ReverseFinancialMovementDto,
  UpdateIncomeDto,
} from '../finance/finance.dto';
import { IncomesService } from './incomes.service';

@Controller('incomes')
@Permissions(PERMISSION_CODES.INCOMES_READ)
export class IncomesController {
  constructor(private readonly service: IncomesService) {}

  @Get('types')
  types() {
    return this.service.types();
  }

  @Get('cash-handover/recipients')
  handoverRecipients(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('organizationId', new ParseUUIDPipe({ optional: true }))
    organizationId?: string,
    @Query(
      'vehicleType',
      new ParseEnumPipe(tipo_vehiculo_luma, { optional: true }),
    )
    vehicleType?: tipo_vehiculo_luma,
  ) {
    return this.service.handoverRecipients(actor, organizationId, vehicleType);
  }

  @Get()
  findAll(
    @Query() query: IncomeQueryDto,
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
  @Permissions(PERMISSION_CODES.INCOMES_MANAGE)
  @AuditedMutation()
  create(
    @Body() input: CreateIncomeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.create(input, actor);
  }

  @Patch(':id')
  @Permissions(PERMISSION_CODES.INCOMES_MANAGE)
  @AuditedMutation()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateIncomeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.update(id, input, actor);
  }

  @Post(':id/collections')
  @Permissions(PERMISSION_CODES.INCOMES_COLLECT)
  @AuditedMutation()
  collect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RegisterFinancialMovementDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.collect(id, input, actor);
  }

  @Post(':id/cash-handover/confirm')
  @Permissions(PERMISSION_CODES.CASH_RECEIVE_HANDOVER)
  @AuditedMutation()
  confirmHandover(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ConfirmCashHandoverDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.confirmHandover(id, input, actor);
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

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
  ApproveSalesOperationDto,
  CreateSalesOperationDto,
  ReasonedSalesActionDto,
  ReleaseSalesReservationDto,
  ReserveSalesUnitDto,
  SalesOperationQueryDto,
  UpdateSalesOperationDto,
  VersionedSalesActionDto,
} from './sales.dto';
import { SalesService } from './sales.service';

@Controller('sales/operations')
@Permissions(PERMISSION_CODES.SALES_READ)
export class SalesController {
  constructor(private readonly service: SalesService) {}

  @Get()
  findAll(
    @Query() query: SalesOperationQueryDto,
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
  @Permissions(PERMISSION_CODES.SALES_MANAGE)
  @AuditedMutation()
  create(
    @Body() input: CreateSalesOperationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.create(input, actor);
  }

  @Patch(':id')
  @Permissions(PERMISSION_CODES.SALES_MANAGE)
  @AuditedMutation()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateSalesOperationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.update(id, input, actor);
  }

  @Post(':id/reservation')
  @Permissions(PERMISSION_CODES.STOCK_RESERVATIONS_MANAGE)
  @AuditedMutation()
  reserve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReserveSalesUnitDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.reserve(id, input, actor);
  }

  @Post(':id/reservation/release')
  @Permissions(PERMISSION_CODES.STOCK_RESERVATIONS_MANAGE)
  @AuditedMutation()
  releaseReservation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReleaseSalesReservationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.releaseReservation(id, input, actor);
  }

  @Post(':id/submit')
  @Permissions(PERMISSION_CODES.SALES_MANAGE)
  @AuditedMutation()
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: VersionedSalesActionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.submit(id, input, actor);
  }

  @Post(':id/approve')
  @Permissions(PERMISSION_CODES.SALES_APPROVE)
  @AuditedMutation()
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ApproveSalesOperationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.approve(id, input, actor);
  }

  @Post(':id/reject')
  @Permissions(PERMISSION_CODES.SALES_APPROVE)
  @AuditedMutation()
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReasonedSalesActionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.reject(id, input, actor);
  }

  @Post(':id/cancel')
  @Permissions(PERMISSION_CODES.SALES_CANCEL)
  @AuditedMutation()
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReasonedSalesActionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.cancel(id, input, actor);
  }

  @Post(':id/close')
  @Permissions(PERMISSION_CODES.SALES_CLOSE)
  @AuditedMutation()
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: VersionedSalesActionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.close(id, input, actor);
  }
}

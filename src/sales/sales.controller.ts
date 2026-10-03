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
  AssignSalesUnitDto,
  CorrectSalesOperationDto,
  CreateSalesOperationDto,
  CreateSalesTradeInDto,
  ReasonedSalesActionDto,
  ReplaceSalesPaymentPlanDto,
  ReleaseSalesReservationDto,
  ReserveSalesUnitDto,
  SalesOperationQueryDto,
  SalesFinancialInstitutionQueryDto,
  SalesPricePolicyQueryDto,
  SalesSellerQueryDto,
  MarkFinancingPaymentDto,
  RegisterSalesComponentCollectionDto,
  RevertFinancingPaymentDto,
  RegisterSalesLicensePlateDto,
  RegisterSalesLicensingCollectionDto,
  RequestSalesSupplyDto,
  SalesOperationTrackingQueryDto,
  UpdateSalesLicensingDto,
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

  // Fase 4: grilla de seguimiento (acordado, cobrado, saldo, efectivo sin
  // rendir, unidad y patentamiento) con el detalle de ingresos.
  @Get('tracking')
  @Permissions(PERMISSION_CODES.SALES_READ, PERMISSION_CODES.INCOMES_READ)
  tracking(
    @Query() query: SalesOperationTrackingQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.tracking(query, actor);
  }

  @Get('sellers')
  sellers(
    @Query() query: SalesSellerQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.sellers(query, actor);
  }

  @Get('contacts')
  contacts(
    @Query() query: SalesSellerQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.contacts(query, actor);
  }

  @Get('price-policy')
  pricePolicy(
    @Query() query: SalesPricePolicyQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.pricePolicy(query, actor);
  }

  @Get('financial-institutions')
  financialInstitutions(
    @Query() query: SalesFinancialInstitutionQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.financialInstitutions(query, actor);
  }

  // Fase 5: feriados nacionales y días hábiles de la ventana estimada de
  // patente, para que el front previsualice las mismas fechas que guarda la API.
  @Get('licensing-calendar')
  licensingCalendar() {
    return this.service.licensingCalendar();
  }

  @Get('approvals')
  @Permissions(PERMISSION_CODES.SALES_APPROVE)
  pendingApprovals(
    @Query() query: SalesOperationQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.pendingApprovals(query, actor);
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

  // Corrección administrativa desde la grilla: edita los datos de la venta
  // en cualquier estado, sin cambiar el estado ni pedir aprobación.
  @Patch(':id/correction')
  @Permissions(PERMISSION_CODES.SALES_CORRECT)
  @AuditedMutation()
  correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CorrectSalesOperationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.correct(id, input, actor);
  }

  @Patch(':id/licensing')
  @Permissions(PERMISSION_CODES.SALES_LICENSING_MANAGE)
  @AuditedMutation()
  updateLicensing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateSalesLicensingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.updateLicensing(id, input, actor);
  }

  @Post(':id/licensing/plate')
  @Permissions(PERMISSION_CODES.SALES_LICENSING_MANAGE)
  @AuditedMutation()
  registerLicensePlate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RegisterSalesLicensePlateDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.registerLicensePlate(id, input, actor);
  }

  @Post(':id/licensing/collections')
  @Permissions(
    PERMISSION_CODES.SALES_LICENSING_MANAGE,
    PERMISSION_CODES.INCOMES_COLLECT,
  )
  @AuditedMutation()
  collectLicensing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RegisterSalesLicensingCollectionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.collectLicensing(id, input, actor);
  }

  @Post(':id/payment-components/:componentId/collections')
  @Permissions(PERMISSION_CODES.SALES_READ, PERMISSION_CODES.INCOMES_COLLECT)
  @AuditedMutation()
  collectPaymentComponent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('componentId', ParseUUIDPipe) componentId: string,
    @Body() input: RegisterSalesComponentCollectionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.collectPaymentComponent(id, componentId, input, actor);
  }

  @Post(':id/payment-components/:componentId/financing-payment')
  @Permissions(PERMISSION_CODES.SALES_READ, PERMISSION_CODES.INCOMES_COLLECT)
  @AuditedMutation()
  markFinancingPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('componentId', ParseUUIDPipe) componentId: string,
    @Body() input: MarkFinancingPaymentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.markFinancingPayment(id, componentId, input, actor);
  }

  @Post(':id/payment-components/:componentId/financing-payment/revert')
  @Permissions(PERMISSION_CODES.SALES_READ, PERMISSION_CODES.INCOMES_COLLECT)
  @AuditedMutation()
  revertFinancingPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('componentId', ParseUUIDPipe) componentId: string,
    @Body() input: RevertFinancingPaymentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.revertFinancingPayment(id, componentId, input, actor);
  }

  @Post(':id/assign-unit')
  @Permissions(PERMISSION_CODES.SALES_ASSIGN_UNIT)
  @AuditedMutation()
  assignUnit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: AssignSalesUnitDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.assignUnit(id, input, actor);
  }

  @Post(':id/supply-request')
  @Permissions(
    PERMISSION_CODES.SALES_ASSIGN_UNIT,
    PERMISSION_CODES.SUPPLY_MANAGE,
  )
  @AuditedMutation()
  requestSupply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RequestSalesSupplyDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.requestSupply(id, input, actor);
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

  @Post(':id/payment-plan')
  @Permissions(PERMISSION_CODES.SALES_MANAGE)
  @AuditedMutation()
  replacePaymentPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReplaceSalesPaymentPlanDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.replacePaymentPlan(id, input, actor);
  }

  @Post(':id/trade-ins')
  @Permissions(PERMISSION_CODES.SALES_MANAGE)
  @AuditedMutation()
  createTradeIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CreateSalesTradeInDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.createTradeIn(id, input, actor);
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

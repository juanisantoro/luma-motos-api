import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AuditedMutation } from '../audit/decorators/audited-mutation.decorator';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  CreateServiceOrderDto,
  DeliverServiceOrderDto,
  SaveServiceWorkDto,
  ServiceOrderQueryDto,
  ServiceOrderReasonDto,
  ServiceTypeDto,
  ServiceTypeQueryDto,
  UpdateServiceOrderDto,
  VehicleLookupQueryDto,
} from './service-orders.dto';
import { ServiceOrdersService } from './service-orders.service';

// Service (taller). Quien recibe la moto (service.gestionar), quien la
// trabaja (service.trabajar) y quien la cobra (service.cobrar) son permisos
// distintos; todos parten de service.consultar.
@Controller('service-orders')
@Permissions(PERMISSION_CODES.SERVICE_READ)
export class ServiceOrdersController {
  constructor(private readonly service: ServiceOrdersService) {}

  @Get('types')
  types(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ServiceTypeQueryDto,
  ) {
    return this.service.types(actor, query.includeInactive ?? false);
  }

  @Post('types')
  @Permissions(PERMISSION_CODES.SERVICE_TYPES_MANAGE)
  @AuditedMutation()
  createType(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() input: ServiceTypeDto,
  ) {
    return this.service.createType(input, actor);
  }

  @Put('types/:id')
  @Permissions(PERMISSION_CODES.SERVICE_TYPES_MANAGE)
  @AuditedMutation()
  updateType(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ServiceTypeDto,
  ) {
    return this.service.updateType(id, input, actor);
  }

  @Get('vehicle-lookup')
  @Permissions(PERMISSION_CODES.SERVICE_MANAGE)
  lookupVehicle(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: VehicleLookupQueryDto,
  ) {
    return this.service.lookupVehicle(query.q, actor);
  }

  @Get()
  findAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ServiceOrderQueryDto,
  ) {
    return this.service.findAll(query, actor);
  }

  @Get(':id')
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.findOne(id, actor);
  }

  @Post()
  @Permissions(PERMISSION_CODES.SERVICE_MANAGE)
  @AuditedMutation()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() input: CreateServiceOrderDto,
  ) {
    return this.service.create(input, actor);
  }

  @Patch(':id')
  @Permissions(PERMISSION_CODES.SERVICE_MANAGE)
  @AuditedMutation()
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateServiceOrderDto,
  ) {
    return this.service.update(id, input, actor);
  }

  @Put(':id/work')
  @Permissions(PERMISSION_CODES.SERVICE_WORK)
  @AuditedMutation()
  saveWork(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: SaveServiceWorkDto,
  ) {
    return this.service.saveWork(id, input, actor);
  }

  @Post(':id/finish')
  @Permissions(PERMISSION_CODES.SERVICE_WORK)
  @AuditedMutation()
  finish(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: SaveServiceWorkDto,
  ) {
    return this.service.finish(id, input, actor);
  }

  @Post(':id/reopen')
  @Permissions(PERMISSION_CODES.SERVICE_MANAGE)
  @AuditedMutation()
  reopen(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ServiceOrderReasonDto,
  ) {
    return this.service.reopen(id, input, actor);
  }

  @Post(':id/deliver')
  @Permissions(PERMISSION_CODES.SERVICE_COLLECT)
  @AuditedMutation()
  deliver(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: DeliverServiceOrderDto,
  ) {
    return this.service.deliver(id, input, actor);
  }

  @Post(':id/cancel')
  @Permissions(PERMISSION_CODES.SERVICE_MANAGE)
  @AuditedMutation()
  cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ServiceOrderReasonDto,
  ) {
    return this.service.cancel(id, input, actor);
  }
}

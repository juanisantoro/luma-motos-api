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
  CreateVehiclePaymentCatalogEntryDto,
  CreateVehiclePaymentDto,
  UpdateVehiclePaymentDto,
  VehiclePaymentQueryDto,
} from './vehicle-payments.dto';
import { VehiclePaymentsService } from './vehicle-payments.service';

@Controller('vehicle-payments')
@Permissions(PERMISSION_CODES.VEHICLE_PAYMENTS_READ)
export class VehiclePaymentsController {
  constructor(private readonly service: VehiclePaymentsService) {}

  @Get('concepts')
  concepts() {
    return this.service.concepts();
  }

  @Get('providers')
  providers() {
    return this.service.providers();
  }

  @Post('concepts')
  @Permissions(PERMISSION_CODES.VEHICLE_PAYMENTS_MANAGE)
  @AuditedMutation()
  addConcept(@Body() input: CreateVehiclePaymentCatalogEntryDto) {
    return this.service.addConcept(input);
  }

  @Post('providers')
  @Permissions(PERMISSION_CODES.VEHICLE_PAYMENTS_MANAGE)
  @AuditedMutation()
  addProvider(@Body() input: CreateVehiclePaymentCatalogEntryDto) {
    return this.service.addProvider(input);
  }

  @Get()
  findAll(
    @Query() query: VehiclePaymentQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findAll(query, actor);
  }

  @Post()
  @Permissions(PERMISSION_CODES.VEHICLE_PAYMENTS_MANAGE)
  @AuditedMutation()
  create(
    @Body() input: CreateVehiclePaymentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.create(input, actor);
  }

  @Patch(':id')
  @Permissions(PERMISSION_CODES.VEHICLE_PAYMENTS_MANAGE)
  @AuditedMutation()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateVehiclePaymentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.update(id, input, actor);
  }
}

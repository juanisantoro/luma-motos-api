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
  AvailabilityQueryDto,
  SupplierInputDto,
  SupplierQueryDto,
  UpdateSupplierDto,
  UpsertAvailabilityDto,
} from './suppliers.dto';
import { SuppliersService } from './suppliers.service';
@Controller()
@Permissions(PERMISSION_CODES.SUPPLIERS_READ)
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}
  @Get('suppliers') findAll(
    @Query() query: SupplierQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findAll(query, actor);
  }
  @Get('suppliers/:id') findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findOne(id, actor);
  }
  @Post('suppliers')
  @Permissions(PERMISSION_CODES.SUPPLIERS_MANAGE)
  @AuditedMutation()
  create(
    @Body() input: SupplierInputDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.create(input, actor);
  }
  @Patch('suppliers/:id')
  @Permissions(PERMISSION_CODES.SUPPLIERS_MANAGE)
  @AuditedMutation()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateSupplierDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.update(id, input, actor);
  }
  @Get('supplier-availability') availability(
    @Query() query: AvailabilityQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.availability(query, actor);
  }
  @Put('supplier-availability')
  @Permissions(PERMISSION_CODES.SUPPLIERS_MANAGE)
  @AuditedMutation()
  upsertAvailability(
    @Body() input: UpsertAvailabilityDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.upsertAvailability(input, actor);
  }
}

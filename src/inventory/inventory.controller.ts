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
  BulkInventoryUnitsDto,
  CreateCatalogInventoryDto,
  InventoryBranchQueryDto,
  InventoryMovementQueryDto,
  CreateInventoryUnitDto,
  InventoryQueryDto,
  TransferInventoryUnitDto,
  UpdateInventoryUnitDto,
} from './inventory.dto';
import { InventoryService } from './inventory.service';
@Controller('inventory/units')
@Permissions(PERMISSION_CODES.INVENTORY_READ)
export class InventoryController {
  constructor(private readonly service: InventoryService) {}
  @Get() findAll(
    @Query() query: InventoryQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findAll(query, actor);
  }
  @Get(':id') findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findOne(id, actor);
  }
  @Post()
  @Permissions(PERMISSION_CODES.INVENTORY_MANAGE)
  @AuditedMutation()
  create(
    @Body() input: CreateInventoryUnitDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.create(input, actor);
  }
  @Post('bulk')
  @Permissions(PERMISSION_CODES.INVENTORY_MANAGE)
  @AuditedMutation()
  bulk(
    @Body() input: BulkInventoryUnitsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.createBulk(input, actor);
  }
  @Post('catalog-bulk')
  @Permissions(
    PERMISSION_CODES.INVENTORY_MANAGE,
    PERMISSION_CODES.CATALOG_MANAGE,
  )
  @AuditedMutation()
  createCatalogBulk(
    @Body() input: CreateCatalogInventoryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.createCatalogBulk(input, actor);
  }
  @Patch(':id')
  @Permissions(PERMISSION_CODES.INVENTORY_MANAGE)
  @AuditedMutation()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateInventoryUnitDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.update(id, input, actor);
  }
  @Post(':id/transfer')
  @Permissions(PERMISSION_CODES.INVENTORY_TRANSFER)
  @AuditedMutation()
  transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: TransferInventoryUnitDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.transfer(id, input, actor);
  }
  @Get(':id/movements') movements(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: InventoryMovementQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.movements(id, query, actor);
  }
}

@Controller('inventory/branches')
@Permissions(PERMISSION_CODES.INVENTORY_READ)
export class InventoryBranchesController {
  constructor(private readonly service: InventoryService) {}

  @Get()
  findAll(
    @Query() query: InventoryBranchQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.branches(query, actor);
  }
}

@Controller('inventory/colors')
@Permissions(PERMISSION_CODES.INVENTORY_READ)
export class InventoryColorsController {
  constructor(private readonly service: InventoryService) {}

  @Get()
  findAll() {
    return this.service.colors();
  }
}

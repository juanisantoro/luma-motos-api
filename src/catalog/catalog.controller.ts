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
import { CatalogService } from './catalog.service';
import {
  CatalogQueryDto,
  CreateModelDto,
  CreatePricePolicyDto,
  CreateVersionDto,
  NameDto,
  UpdateModelDto,
  UpdateNameDto,
  UpdateVersionDto,
} from './catalog.dto';

@Controller('catalog')
@Permissions(PERMISSION_CODES.CATALOG_READ)
export class CatalogController {
  constructor(private readonly service: CatalogService) {}
  @Get('brands') brands(
    @Query() query: CatalogQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.brands(query, actor);
  }
  @Get('brands/:id') brand(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.brand(id, actor);
  }
  @Post('brands')
  @Permissions(PERMISSION_CODES.CATALOG_MANAGE)
  @AuditedMutation()
  createBrand(@Body() input: NameDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.createBrand(input, actor);
  }
  @Patch('brands/:id')
  @Permissions(PERMISSION_CODES.CATALOG_MANAGE)
  @AuditedMutation()
  updateBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateNameDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.updateBrand(id, input, actor);
  }
  @Get('models') models(
    @Query() query: CatalogQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.models(query, actor);
  }
  @Get('models/:id') model(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.model(id, actor);
  }
  @Post('models')
  @Permissions(PERMISSION_CODES.CATALOG_MANAGE)
  @AuditedMutation()
  createModel(
    @Body() input: CreateModelDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.createModel(input, actor);
  }
  @Patch('models/:id')
  @Permissions(PERMISSION_CODES.CATALOG_MANAGE)
  @AuditedMutation()
  updateModel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateModelDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.updateModel(id, input, actor);
  }
  @Get('versions') versions(
    @Query() query: CatalogQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.versions(query, actor);
  }
  @Get('versions/:id') version(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.version(id, actor);
  }
  @Post('versions')
  @Permissions(PERMISSION_CODES.CATALOG_MANAGE)
  @AuditedMutation()
  createVersion(
    @Body() input: CreateVersionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.createVersion(input, actor);
  }
  @Patch('versions/:id')
  @Permissions(PERMISSION_CODES.CATALOG_MANAGE)
  @AuditedMutation()
  updateVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateVersionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.updateVersion(id, input, actor);
  }
  @Get('price-policies') policies(
    @Query() query: CatalogQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.pricePolicies(query, actor);
  }
  @Post('price-policies')
  @Permissions(PERMISSION_CODES.CATALOG_MANAGE)
  @AuditedMutation()
  createPolicy(
    @Body() input: CreatePricePolicyDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.createPricePolicy(input, actor);
  }
}

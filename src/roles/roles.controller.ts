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
import { CloneRoleDto } from './dto/clone-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { RoleListQueryDto } from './dto/role-list-query.dto';
import { UpdateRoleStatusDto } from './dto/update-role-status.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

@Controller('roles')
@Permissions(PERMISSION_CODES.ROLES_READ)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  findAll(
    @Query() query: RoleListQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.rolesService.findAll(query, actor);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.rolesService.findOne(id, actor);
  }

  @Post()
  @Permissions(PERMISSION_CODES.ROLES_MANAGE)
  @AuditedMutation()
  create(
    @Body() input: CreateRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.rolesService.create(input, actor);
  }

  @Patch(':id')
  @Permissions(PERMISSION_CODES.ROLES_MANAGE)
  @AuditedMutation()
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.rolesService.update(id, input, actor);
  }

  @Patch(':id/status')
  @Permissions(PERMISSION_CODES.ROLES_MANAGE)
  @AuditedMutation()
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateRoleStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.rolesService.updateStatus(id, input, actor);
  }

  @Post(':id/clone')
  @Permissions(PERMISSION_CODES.ROLES_MANAGE)
  @AuditedMutation()
  clone(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: CloneRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.rolesService.clone(id, input, actor);
  }
}

@Controller('permissions')
@Permissions(PERMISSION_CODES.ROLES_READ)
export class PermissionsController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  findAll(@CurrentUser() actor: AuthenticatedUser) {
    return this.rolesService.findPermissions(actor);
  }
}

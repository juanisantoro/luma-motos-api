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
import type { AuthenticatedUser } from '../auth/auth.types';
import { PERMISSION_CODES } from '../auth/auth.constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BranchListQueryDto } from './dto/branch-list-query.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserAccessDto } from './dto/update-user-access.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UserListQueryDto } from './dto/user-list-query.dto';
import { UsersService } from './users.service';

@Controller('users')
@Permissions(PERMISSION_CODES.USERS_READ)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll(
    @Query() query: UserListQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usersService.findAll(query, actor);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usersService.findOne(id, actor);
  }

  @Post()
  @Permissions(PERMISSION_CODES.USERS_MANAGE)
  @AuditedMutation()
  create(
    @Body() input: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usersService.create(input, actor);
  }

  @Patch(':id/access')
  @Permissions(PERMISSION_CODES.USERS_MANAGE)
  @AuditedMutation()
  updateAccess(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateUserAccessDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usersService.updateAccess(id, input, actor);
  }

  @Patch(':id/status')
  @Permissions(PERMISSION_CODES.USERS_MANAGE)
  @AuditedMutation()
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateUserStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usersService.updateStatus(id, input, actor);
  }

  @Post(':id/temporary-password')
  @Permissions(PERMISSION_CODES.USERS_MANAGE)
  @AuditedMutation()
  resetTemporaryPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usersService.resetTemporaryPassword(id, actor);
  }
}

@Controller()
@Permissions(PERMISSION_CODES.USERS_READ)
export class UserReferenceDataController {
  constructor(private readonly usersService: UsersService) {}

  @Get('roles')
  findRoles(@CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.findRoles(actor);
  }

  @Get('organizations')
  findOrganizations(@CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.findOrganizations(actor);
  }

  @Get('branches')
  findBranches(
    @Query() query: BranchListQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usersService.findBranches(query, actor);
  }
}

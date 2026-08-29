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
import { ClientListQueryDto } from './dto/client-list-query.dto';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientStatusDto } from './dto/update-client-status.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientsService } from './clients.service';

@Controller('clients')
@Permissions(PERMISSION_CODES.CLIENTS_READ)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  findAll(
    @Query() query: ClientListQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.clientsService.findAll(query, actor);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.clientsService.findOne(id, actor);
  }

  @Post()
  @Permissions(PERMISSION_CODES.CLIENTS_MANAGE)
  @AuditedMutation()
  create(
    @Body() input: CreateClientDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.clientsService.create(input, actor);
  }

  @Patch(':id')
  @Permissions(PERMISSION_CODES.CLIENTS_MANAGE)
  @AuditedMutation()
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateClientDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.clientsService.update(id, input, actor);
  }

  @Patch(':id/status')
  @Permissions(PERMISSION_CODES.CLIENTS_MANAGE)
  @AuditedMutation()
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateClientStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.clientsService.updateStatus(id, input, actor);
  }
}

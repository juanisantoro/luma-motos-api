import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AuditedMutation } from '../audit/decorators/audited-mutation.decorator';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  CreateSupplyRequestDto,
  ReceiveSupplyRequestDto,
  SupplyRequestQueryDto,
  SupplyTransitionDto,
} from './supply.dto';
import { SupplyService } from './supply.service';
@Controller('supply-requests')
@Permissions(PERMISSION_CODES.SUPPLY_READ)
export class SupplyController {
  constructor(private readonly service: SupplyService) {}
  @Get() findAll(
    @Query() query: SupplyRequestQueryDto,
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
  @Permissions(PERMISSION_CODES.SUPPLY_MANAGE)
  @AuditedMutation()
  create(
    @Body() input: CreateSupplyRequestDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.create(input, actor);
  }
  @Post(':id/transitions')
  @Permissions(PERMISSION_CODES.SUPPLY_MANAGE)
  @AuditedMutation()
  transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: SupplyTransitionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.transition(id, input, actor);
  }
  @Post(':id/receive')
  @Permissions(PERMISSION_CODES.SUPPLY_RECEIVE)
  @AuditedMutation()
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReceiveSupplyRequestDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.receive(id, input, actor);
  }
}

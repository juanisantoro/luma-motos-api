import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AuditQueryService } from './audit-query.service';
import {
  AuditLogQueryDto,
  AuditMoneyQueryDto,
} from './dto/audit-log-query.dto';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditQuery: AuditQueryService) {}

  @Get()
  @Permissions('auditoria.consultar')
  findAll(
    @Query() query: AuditLogQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auditQuery.findLogs(query, user);
  }

  @Get('filters')
  @Permissions('auditoria.consultar')
  filters(@CurrentUser() user: AuthenticatedUser) {
    return this.auditQuery.filters(user);
  }

  @Get('money-movements')
  @Permissions('auditoria.consultar')
  moneyMovements(
    @Query() query: AuditMoneyQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auditQuery.moneyMovements(query, user);
  }

  @Get('operations/:id')
  @Permissions('auditoria.consultar')
  operationTrace(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auditQuery.operationTrace(id, user);
  }
}

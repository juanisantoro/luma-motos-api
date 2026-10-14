import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { AuditedMutation } from '../audit/decorators/audited-mutation.decorator';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  ResolveServiceReminderDto,
  ServiceReminderKeyDto,
  ServiceRemindersQueryDto,
} from './service-reminders.dto';
import { ServiceRemindersService } from './service-reminders.service';

// Avisos de service (1º service y anual). Los ve y los resuelve cualquiera
// que vea el taller: la administrativa y el mecánico.
@Controller('service-reminders')
@Permissions(PERMISSION_CODES.SERVICE_READ)
export class ServiceRemindersController {
  constructor(private readonly service: ServiceRemindersService) {}

  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ServiceRemindersQueryDto,
  ) {
    return this.service.list(actor, query);
  }

  @Post()
  @AuditedMutation()
  resolve(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() input: ResolveServiceReminderDto,
  ) {
    return this.service.resolve(actor, input);
  }

  @Delete()
  @AuditedMutation()
  reopen(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() input: ServiceReminderKeyDto,
  ) {
    return this.service.reopen(actor, input);
  }
}

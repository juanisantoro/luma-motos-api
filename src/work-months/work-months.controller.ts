import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { AuditedMutation } from '../audit/decorators/audited-mutation.decorator';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  SetWorkMonthCutDto,
  WorkMonthParamDto,
  WorkMonthsQueryDto,
} from './work-months.dto';
import { WorkMonthsService } from './work-months.service';

// La lista no pide permiso: cualquier usuario necesita saber de qué día a
// qué día va cada mes (inicio, comisiones, filtros). Mover un corte sí.
@Controller('work-months')
export class WorkMonthsController {
  constructor(private readonly service: WorkMonthsService) {}

  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: WorkMonthsQueryDto,
  ) {
    return this.service.list(actor, query.organizationId);
  }

  @Put(':period')
  @Permissions(PERMISSION_CODES.WORK_MONTHS_MANAGE)
  @AuditedMutation()
  setCut(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: WorkMonthParamDto,
    @Body() input: SetWorkMonthCutDto,
  ) {
    return this.service.setCut(
      actor,
      params.period,
      input.cutDate,
      input.organizationId,
    );
  }

  @Delete(':period')
  @Permissions(PERMISSION_CODES.WORK_MONTHS_MANAGE)
  @AuditedMutation()
  removeCut(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: WorkMonthParamDto,
    @Query() query: WorkMonthsQueryDto,
  ) {
    return this.service.removeCut(actor, params.period, query.organizationId);
  }
}

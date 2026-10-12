import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BalanceQueryDto } from './balance.dto';
import { BalanceService } from './balance.service';

// Balance del mes: sólo administradores. Usa el mismo permiso que mover los
// cortes, porque es la herramienta para cerrar el mes.
@Controller('balance')
export class BalanceController {
  constructor(private readonly service: BalanceService) {}

  @Get()
  @Permissions(PERMISSION_CODES.WORK_MONTHS_MANAGE)
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: BalanceQueryDto,
  ) {
    return this.service.monthly(actor, query);
  }
}

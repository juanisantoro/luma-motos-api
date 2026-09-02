import { Controller, Get, Param } from '@nestjs/common';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BcraService } from './bcra.service';
import { CuitParamPipe } from './cuit-param.pipe';

// Public-BCRA-backed CUIT/CUIL lookup for the credit-plans module. This is
// intentionally its own module, separate from credit-inquiries: that module
// tracks Luma's own manually-registered rejections by other financieras,
// while this one is a live, unpersisted read against the BCRA "Central de
// Deudores". Gated by the same base permission as the rest of credit-plans
// (`creditos.consultar`) - the full period-by-period/entity detail is only
// attached to the response for actors that also hold
// `creditos.bcra.detalle` (see BcraService.canSeeDetail).
@Controller('bcra')
@Permissions(PERMISSION_CODES.CREDIT_PLANS_READ)
export class BcraController {
  constructor(private readonly service: BcraService) {}

  @Get('situacion/:cuit')
  getSituacion(
    @Param('cuit', CuitParamPipe) cuit: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.getSituacion(cuit, actor);
  }
}

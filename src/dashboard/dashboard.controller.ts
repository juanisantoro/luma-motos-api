import { Controller, Get } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

// No @Permissions() here on purpose: this single endpoint serves all five
// roles, each with a different section set. Every section the service
// computes is individually gated by the actor's real permissions inside
// DashboardService.getHome() (never by role name) - a request with no
// matching sections still gets 200 with just the greeting, same as any
// other authenticated request.
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('inicio')
  home(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.getHome(actor);
  }
}

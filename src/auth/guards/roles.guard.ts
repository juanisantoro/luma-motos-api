import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedPrincipal } from '../auth.types';
import { RoleCode } from '../auth.constants';
import { ROLES_KEY } from '../decorators/roles.decorator';

interface RequestWithPrincipal {
  user?: AuthenticatedPrincipal;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleCode[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const roleCode = request.user?.user.role.code;

    return (
      roleCode !== undefined &&
      requiredRoles.some((requiredRole) => requiredRole === roleCode)
    );
  }
}

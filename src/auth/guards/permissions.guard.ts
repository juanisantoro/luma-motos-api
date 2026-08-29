import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedPrincipal } from '../auth.types';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

interface RequestWithPrincipal {
  user?: AuthenticatedPrincipal;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const permissions = new Set(request.user?.user.role.permissions ?? []);

    return requiredPermissions.every((permission) =>
      permissions.has(permission),
    );
  }
}

import { SetMetadata } from '@nestjs/common';
import { RoleCode } from '../auth.constants';

export const ROLES_KEY = 'requiredRoles';

export const Roles = (...roles: RoleCode[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedPrincipal, AuthenticatedUser } from '../auth.types';

interface RequestWithPrincipal {
  user: AuthenticatedPrincipal;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<RequestWithPrincipal>().user.user,
);

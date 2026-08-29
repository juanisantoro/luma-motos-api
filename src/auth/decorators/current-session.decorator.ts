import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth.types';

interface RequestWithPrincipal {
  user: AuthenticatedPrincipal;
}

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    context.switchToHttp().getRequest<RequestWithPrincipal>().user.sessionId,
);

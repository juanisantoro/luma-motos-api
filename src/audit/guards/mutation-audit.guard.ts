import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUDITED_MUTATION_KEY } from '../decorators/audited-mutation.decorator';

interface HttpRequest {
  method: string;
  originalUrl: string;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class MutationAuditGuard implements CanActivate {
  private readonly logger = new Logger(MutationAuditGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    const isAudited = this.reflector.getAllAndOverride<boolean>(
      AUDITED_MUTATION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!isAudited) {
      this.logger.error(
        `Blocked unaudited mutation: ${request.method} ${request.originalUrl}`,
      );
      throw new InternalServerErrorException();
    }

    return true;
  }
}

import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { AuthenticatedPrincipal } from '../auth/auth.types';

// Deja en el log cada pedido que la API rechaza (400, 403, 409, 500, ...) con
// quién lo hizo, qué mandó y por qué falló, para poder revisarlo después
// aunque el usuario sólo haya visto un cartel genérico. La respuesta no
// cambia: la arma el filtro por defecto de Nest.
//
// Cada caso es una línea JSON que empieza con "api-error", para buscarla en
// los logs de Render.

// 401 (sesión vencida) y 404 son ruido normal: no se registran.
const IGNORED_STATUSES = new Set<number>([
  HttpStatus.UNAUTHORIZED,
  HttpStatus.NOT_FOUND,
]);

// Datos que nunca van al log.
const SECRET_KEY = /pass(word)?|token|secret|authorization|cookie|cvv|card/i;
const MAX_STRING = 300;
const MAX_DEPTH = 4;
const MAX_ITEMS = 30;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string')
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value))
    return value.slice(0, MAX_ITEMS).map((item) => redact(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_ITEMS))
    result[key] = SECRET_KEY.test(key) ? '[oculto]' : redact(item, depth + 1);
  return result;
}

type LoggedRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
  body?: unknown;
  user?: AuthenticatedPrincipal;
  headers?: Record<string, string | string[] | undefined>;
};

export function errorLogEntry(exception: unknown, request: LoggedRequest) {
  const status =
    exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  const response =
    exception instanceof HttpException ? exception.getResponse() : undefined;
  const payload =
    response && typeof response === 'object'
      ? (response as { message?: unknown; code?: unknown })
      : undefined;
  const user = request.user?.user;
  return {
    status,
    method: request.method,
    path: request.originalUrl ?? request.url,
    code: typeof payload?.code === 'string' ? payload.code : undefined,
    message:
      payload?.message ??
      (typeof response === 'string' ? response : undefined) ??
      (exception instanceof Error ? exception.message : String(exception)),
    user: user
      ? {
          id: user.id,
          email: user.email,
          role: user.role.code,
          organization: user.organization.code,
          branch: user.branch?.name ?? null,
        }
      : null,
    body: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method ?? '')
      ? redact(request.body)
      : undefined,
  };
}

@Catch()
export class HttpErrorLogFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('ApiError');

  override catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() === 'http') {
      try {
        const request = host.switchToHttp().getRequest<LoggedRequest>();
        const entry = errorLogEntry(exception, request);
        if (!IGNORED_STATUSES.has(entry.status)) {
          const line = `api-error ${JSON.stringify(entry)}`;
          if (entry.status >= 500)
            this.logger.error(
              line,
              exception instanceof Error ? exception.stack : undefined,
            );
          else this.logger.warn(line);
        }
      } catch {
        // El registro nunca debe romper la respuesta.
      }
    }
    super.catch(exception, host);
  }
}

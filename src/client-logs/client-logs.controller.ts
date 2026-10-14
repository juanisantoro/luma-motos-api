import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { AuditedMutation } from '../audit/decorators/audited-mutation.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { redact } from '../common/http-error-log.filter';
import { CreateClientLogDto } from './client-logs.dto';

// Registra en el log ("ui-validation") lo que el formulario no dejó enviar,
// para ver después por qué un usuario no pudo cargar algo aunque el pedido
// nunca haya llegado a la API.
@Controller('client-logs')
export class ClientLogsController {
  private readonly logger = new Logger('UiValidation');

  // No cambia datos ni pasa por AuditService: @AuditedMutation sólo habilita
  // el POST frente al guard de mutaciones.
  @Post()
  @AuditedMutation()
  @HttpCode(HttpStatus.NO_CONTENT)
  create(
    @Body() input: CreateClientLogDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    this.logger.warn(
      `ui-validation ${JSON.stringify(clientLogEntry(input, actor))}`,
    );
  }
}

export function clientLogEntry(
  input: CreateClientLogDto,
  actor: AuthenticatedUser,
) {
  return {
    kind: input.kind,
    screen: input.screen,
    messages: redact(input.messages),
    data: redact(input.data),
    user: {
      id: actor.id,
      email: actor.email,
      role: actor.role.code,
      organization: actor.organization.code,
      branch: actor.branch?.name ?? null,
    },
  };
}

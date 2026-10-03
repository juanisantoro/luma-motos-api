import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuditedMutation } from '../audit/decorators/audited-mutation.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AskAssistantDto } from './assistant.dto';
import { AssistantService } from './assistant.service';
import type { AssistantAnswer } from './assistant.service';

// Lumi, el asistente de ayuda: responde preguntas de uso con el manual del
// rol del usuario (el Administrador recibe los de todos los perfiles). No
// tiene permiso propio, igual que la pantalla Manual de uso; el manual se
// elige por el rol de la sesión, nunca por algo que mande el cliente.
@Controller('assistant')
export class AssistantController {
  constructor(private readonly service: AssistantService) {}

  // POST porque lleva cuerpo, pero no modifica nada: no escribe en la base
  // ni pasa por AuditService. @AuditedMutation sólo habilita el POST frente
  // a MutationAuditGuard, igual que el login.
  @Post('ask')
  @AuditedMutation()
  @HttpCode(200)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  ask(
    @Body() dto: AskAssistantDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AssistantAnswer> {
    return this.service.ask(actor, dto);
  }
}

import { SetMetadata } from '@nestjs/common';

export const AUDITED_MUTATION_KEY = 'auditedMutation';

export const AuditedMutation = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUDITED_MUTATION_KEY, true);

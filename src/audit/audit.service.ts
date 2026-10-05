import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, TenantScope } from '../prisma/prisma.service';

type AuditClient = Prisma.TransactionClient;

export interface AuditEvent {
  action: string;
  entity: string;
  entityId?: string;
  actorId?: string;
  metadata?: Prisma.InputJsonValue;
  previousData?: Prisma.InputJsonValue;
  ipAddress?: string;
  organizationId: string;
  targetOrganizationId?: string;
  skipRecord?: boolean;
}

export interface AuthenticatedAuditEvent extends AuditEvent, TenantScope {
  actorId: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEvent, client?: AuditClient): Promise<void> {
    if (client) {
      await this.createRecord(client, event);
      return;
    }

    await this.prisma.withTenant(
      {
        organizationId: event.organizationId,
        globalAccess: false,
      },
      (transaction) => this.createRecord(transaction, event),
    );
  }

  execute<T>(
    event: AuthenticatedAuditEvent,
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.withTenant(event, async (transaction) => {
      const result = await operation(transaction);
      if (!event.skipRecord) await this.createRecord(transaction, event);
      return result;
    });
  }

  private async createRecord(
    client: AuditClient,
    event: AuditEvent,
  ): Promise<void> {
    await client.registros_auditoria.create({
      data: {
        accion: event.action,
        entidad: event.entity,
        entidad_id: event.entityId,
        usuario_id: event.actorId,
        datos_anteriores: event.previousData,
        datos_nuevos: event.metadata,
        direccion_ip: event.ipAddress,
        organizacion_id: event.organizationId,
        organizacion_objetivo_id: event.targetOrganizationId,
      },
    });
  }
}

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

export interface AuditLogQuery {
  page: number;
  limit: number;
  action?: string;
  entity?: string;
  actorId?: string;
}

export interface AuditLogPage {
  items: Array<{
    id: string;
    action: string;
    entity: string;
    entityId: string | null;
    metadata: Prisma.JsonValue;
    createdAt: Date;
    organization: {
      id: string;
      code: string;
      name: string;
      type: string;
    };
    targetOrganization: {
      id: string;
      code: string;
      name: string;
      type: string;
    } | null;
    actor: {
      id: string;
      email: string;
      name: string | null;
    } | null;
    branch: {
      id: string;
      code: string;
      name: string;
    } | null;
  }>;
  total: number;
  page: number;
  limit: number;
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

  async findAll(
    query: AuditLogQuery,
    scope: TenantScope,
  ): Promise<AuditLogPage> {
    const where: Prisma.registros_auditoriaWhereInput = {
      accion: query.action,
      entidad: query.entity,
      OR: scope.globalAccess
        ? undefined
        : [
            { organizacion_id: scope.organizationId },
            { organizacion_objetivo_id: scope.organizationId },
          ],
      usuario_id: query.actorId,
    };
    const skip = (query.page - 1) * query.limit;
    const [total, records] = await this.prisma.withTenant(
      scope,
      (transaction) =>
        Promise.all([
          transaction.registros_auditoria.count({ where }),
          transaction.registros_auditoria.findMany({
            where,
            skip,
            take: query.limit,
            orderBy: [{ creado_en: 'desc' }, { id: 'desc' }],
            select: {
              id: true,
              accion: true,
              entidad: true,
              entidad_id: true,
              datos_nuevos: true,
              creado_en: true,
              organizacion_id: true,
              organizacion_objetivo_id: true,
              organizaciones: {
                select: {
                  codigo: true,
                  nombre: true,
                  tipo: true,
                },
              },
              organizacion_objetivo: {
                select: {
                  codigo: true,
                  nombre: true,
                  tipo: true,
                },
              },
              usuarios: {
                select: {
                  id: true,
                  correo: true,
                  personal: {
                    select: {
                      nombre_completo: true,
                    },
                  },
                  sucursales: {
                    select: {
                      id: true,
                      codigo: true,
                      nombre: true,
                    },
                  },
                },
              },
            },
          }),
        ]),
    );
    const items = records.map((record) => ({
      id: record.id,
      action: record.accion,
      entity: record.entidad,
      entityId: record.entidad_id,
      metadata: record.datos_nuevos,
      createdAt: record.creado_en,
      organization: {
        id: record.organizacion_id,
        code: record.organizaciones.codigo,
        name: record.organizaciones.nombre,
        type: record.organizaciones.tipo,
      },
      targetOrganization:
        record.organizacion_objetivo && record.organizacion_objetivo_id
          ? {
              id: record.organizacion_objetivo_id,
              code: record.organizacion_objetivo.codigo,
              name: record.organizacion_objetivo.nombre,
              type: record.organizacion_objetivo.tipo,
            }
          : null,
      actor: record.usuarios
        ? {
            id: record.usuarios.id,
            email: record.usuarios.correo,
            name: record.usuarios.personal?.nombre_completo ?? null,
          }
        : null,
      branch: record.usuarios?.sucursales
        ? {
            id: record.usuarios.sucursales.id,
            code: record.usuarios.sucursales.codigo,
            name: record.usuarios.sucursales.nombre,
          }
        : null,
    }));

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
    };
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

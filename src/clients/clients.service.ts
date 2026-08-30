import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditService,
  type AuthenticatedAuditEvent,
} from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService, type TenantScope } from '../prisma/prisma.service';
import { CLIENT_AUDIT_ACTIONS } from './clients.constants';
import {
  normalizeClientDocument,
  normalizeClientName,
} from './client-normalization';
import { ClientListQueryDto } from './dto/client-list-query.dto';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientStatusDto } from './dto/update-client-status.dto';
import { UpdateClientDto } from './dto/update-client.dto';

const clientSelect = {
  id: true,
  tipo_documento: true,
  numero_documento: true,
  nombre_completo: true,
  telefono: true,
  correo: true,
  direccion: true,
  notas: true,
  activo: true,
  creado_en: true,
  actualizado_en: true,
  organizacion_id: true,
  organizaciones: {
    select: {
      id: true,
      codigo: true,
      nombre: true,
      tipo: true,
    },
  },
} satisfies Prisma.clientesSelect;

type Client = Prisma.clientesGetPayload<{ select: typeof clientSelect }>;

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: ClientListQueryDto, actor: AuthenticatedUser) {
    this.assertOrganizationFilter(actor, query.organizationId);
    const normalizedSearch = query.search
      ? normalizeClientName(query.search)
      : undefined;
    const normalizedDocument = query.search
      ? normalizeClientDocument(query.search)
      : undefined;
    const organizationId = actor.globalAccess
      ? query.organizationId
      : actor.organization.id;
    const where: Prisma.clientesWhereInput = {
      organizacion_id: organizationId,
      activo: query.active,
      OR: normalizedSearch
        ? [
            {
              nombre_normalizado: {
                contains: normalizedSearch,
                mode: 'insensitive',
              },
            },
            {
              documento_normalizado: normalizedDocument
                ? { contains: normalizedDocument, mode: 'insensitive' }
                : undefined,
            },
            {
              correo: {
                contains: normalizedSearch,
                mode: 'insensitive',
              },
            },
          ]
        : undefined,
    };
    const skip = (query.page - 1) * query.limit;
    const [total, clients] = await this.prisma.withTenant(
      this.scope(actor),
      (transaction) =>
        Promise.all([
          transaction.clientes.count({ where }),
          transaction.clientes.findMany({
            where,
            select: clientSelect,
            orderBy: [{ creado_en: 'desc' }, { id: 'desc' }],
            skip,
            take: query.limit,
          }),
        ]),
    );

    return {
      items: clients.map((client) => this.toResponse(client)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const client = await this.prisma.withTenant(
      this.scope(actor),
      (transaction) => this.findClient(transaction, id, actor),
    );
    return this.toResponse(client);
  }

  async create(input: CreateClientDto, actor: AuthenticatedUser) {
    const organizationId = input.organizationId ?? actor.organization.id;
    this.assertOrganizationSelection(actor, input.organizationId);
    this.assertDocumentPair(input.documentType, input.documentNumber, false);
    const auditEvent: AuthenticatedAuditEvent = {
      action: CLIENT_AUDIT_ACTIONS.CREATED,
      entity: 'clientes',
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId: this.targetOrganization(actor, organizationId),
      metadata: {
        organizationId,
        hasDocument: input.documentType !== undefined,
        hasEmail: input.email !== undefined,
        hasPhone: input.phone !== undefined,
      },
    };

    try {
      const client = await this.auditService.execute(
        auditEvent,
        async (transaction) => {
          await this.requireOrganization(transaction, organizationId);
          if (input.documentType && input.documentNumber) {
            await transaction.$executeRaw`
              SELECT pg_advisory_xact_lock(
                hashtextextended(
                  ${`${organizationId}:${input.documentType}:${normalizeClientDocument(input.documentNumber)}`},
                  0
                )
              )
            `;
          }
          const created = await transaction.clientes.create({
            data: {
              nombre_completo: input.fullName,
              nombre_normalizado: normalizeClientName(input.fullName),
              tipo_documento: input.documentType,
              numero_documento: input.documentNumber,
              documento_normalizado: input.documentNumber
                ? normalizeClientDocument(input.documentNumber)
                : undefined,
              telefono: input.phone,
              correo: input.email,
              direccion: input.address,
              notas: input.notes,
              organizacion_id: organizationId,
            },
            select: clientSelect,
          });
          auditEvent.entityId = created.id;
          return created;
        },
      );
      return this.toResponse(client);
    } catch (error: unknown) {
      this.rethrowDocumentConflict(error);
    }
  }

  async update(id: string, input: UpdateClientDto, actor: AuthenticatedUser) {
    const changedFields = this.changedFields(input);
    if (changedFields.length === 0) {
      throw new BadRequestException('At least one editable field is required');
    }
    this.assertDocumentUpdatePair(input);
    const auditEvent: AuthenticatedAuditEvent = {
      action: CLIENT_AUDIT_ACTIONS.UPDATED,
      entity: 'clientes',
      entityId: id,
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
    };

    try {
      const client = await this.auditService.execute(
        auditEvent,
        async (transaction) => {
          const current = await this.findClient(transaction, id, actor, true);
          if (!this.hasChanges(current, input)) {
            throw new BadRequestException(
              'The request does not change client data',
            );
          }
          auditEvent.targetOrganizationId = this.targetOrganization(
            actor,
            current.organizacion_id,
          );
          auditEvent.previousData = this.auditSnapshot(current, changedFields);

          const updated = await transaction.clientes.update({
            where: {
              id_organizacion_id: {
                id,
                organizacion_id: current.organizacion_id,
              },
            },
            data: this.updateData(input),
            select: clientSelect,
          });
          auditEvent.metadata = this.auditSnapshot(updated, changedFields);
          return updated;
        },
      );
      return this.toResponse(client);
    } catch (error: unknown) {
      this.rethrowDocumentConflict(error);
    }
  }

  async updateStatus(
    id: string,
    input: UpdateClientStatusDto,
    actor: AuthenticatedUser,
  ) {
    const auditEvent: AuthenticatedAuditEvent = {
      action: CLIENT_AUDIT_ACTIONS.STATUS_UPDATED,
      entity: 'clientes',
      entityId: id,
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
    };

    const client = await this.auditService.execute(
      auditEvent,
      async (transaction) => {
        const current = await this.findClient(transaction, id, actor, true);
        if (current.activo === input.active) {
          throw new BadRequestException('The client already has that status');
        }
        auditEvent.targetOrganizationId = this.targetOrganization(
          actor,
          current.organizacion_id,
        );
        auditEvent.previousData = { active: current.activo };
        auditEvent.metadata = { active: input.active };

        return transaction.clientes.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: current.organizacion_id,
            },
          },
          data: { activo: input.active },
          select: clientSelect,
        });
      },
    );
    return this.toResponse(client);
  }

  private scope(actor: AuthenticatedUser): TenantScope {
    return {
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
    };
  }

  private assertOrganizationFilter(
    actor: AuthenticatedUser,
    organizationId?: string,
  ): void {
    if (organizationId && !actor.globalAccess) {
      throw new ForbiddenException(
        'Only users with global access can filter clients by organization',
      );
    }
  }

  private assertOrganizationSelection(
    actor: AuthenticatedUser,
    organizationId?: string,
  ): void {
    if (organizationId && !actor.globalAccess) {
      throw new ForbiddenException(
        'Only users with global access can select a client organization',
      );
    }
  }

  private targetOrganization(
    actor: AuthenticatedUser,
    organizationId: string,
  ): string | undefined {
    return organizationId === actor.organization.id
      ? undefined
      : organizationId;
  }

  private async requireOrganization(
    transaction: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<void> {
    const organization = await transaction.organizaciones.findFirst({
      where: { id: organizationId, activa: true },
      select: { id: true },
    });
    if (!organization) {
      throw new BadRequestException('Organization is invalid or inactive');
    }
  }

  private async findClient(
    transaction: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
    lockForUpdate = false,
  ): Promise<Client> {
    if (lockForUpdate) {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "public"."clientes"
        WHERE "id" = CAST(${id} AS uuid)
          AND (
            ${actor.globalAccess}
            OR "organizacion_id" = CAST(${actor.organization.id} AS uuid)
          )
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException('Client not found');
      }
    }
    const client = await transaction.clientes.findFirst({
      where: {
        id,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
      },
      select: clientSelect,
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    return client;
  }

  private assertDocumentPair(
    documentType: unknown,
    documentNumber: unknown,
    allowNull: boolean,
  ): void {
    const bothUndefined =
      documentType === undefined && documentNumber === undefined;
    const bothNull = documentType === null && documentNumber === null;
    if (bothUndefined || (allowNull && bothNull)) {
      return;
    }
    if (
      typeof documentType !== 'string' ||
      typeof documentNumber !== 'string' ||
      normalizeClientDocument(documentNumber).length === 0
    ) {
      throw new BadRequestException(
        'Document type and number must be provided together',
      );
    }
  }

  private assertDocumentUpdatePair(input: UpdateClientDto): void {
    const hasType = Object.prototype.hasOwnProperty.call(input, 'documentType');
    const hasNumber = Object.prototype.hasOwnProperty.call(
      input,
      'documentNumber',
    );
    if (hasType !== hasNumber) {
      throw new BadRequestException(
        'Document type and number must be updated together',
      );
    }
    if (hasType) {
      this.assertDocumentPair(input.documentType, input.documentNumber, true);
    }
  }

  private changedFields(input: UpdateClientDto): string[] {
    return [
      'fullName',
      'documentType',
      'documentNumber',
      'phone',
      'email',
      'address',
      'notes',
    ].filter((field) => Object.prototype.hasOwnProperty.call(input, field));
  }

  private updateData(input: UpdateClientDto): Prisma.clientesUpdateInput {
    const data: Prisma.clientesUpdateInput = {};
    if (input.fullName !== undefined) {
      data.nombre_completo = input.fullName;
      data.nombre_normalizado = normalizeClientName(input.fullName);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'documentType')) {
      data.tipo_documento = input.documentType;
      data.numero_documento = input.documentNumber;
      data.documento_normalizado = input.documentNumber
        ? normalizeClientDocument(input.documentNumber)
        : null;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'phone')) {
      data.telefono = input.phone;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'email')) {
      data.correo = input.email;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'address')) {
      data.direccion = input.address;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'notes')) {
      data.notas = input.notes;
    }
    return data;
  }

  private hasChanges(client: Client, input: UpdateClientDto): boolean {
    if (
      input.fullName !== undefined &&
      client.nombre_completo !== input.fullName
    ) {
      return true;
    }
    if (
      Object.prototype.hasOwnProperty.call(input, 'documentType') &&
      (client.tipo_documento !== input.documentType ||
        client.numero_documento !== input.documentNumber)
    ) {
      return true;
    }
    if (
      Object.prototype.hasOwnProperty.call(input, 'phone') &&
      client.telefono !== input.phone
    ) {
      return true;
    }
    if (
      Object.prototype.hasOwnProperty.call(input, 'email') &&
      client.correo !== input.email
    ) {
      return true;
    }
    if (
      Object.prototype.hasOwnProperty.call(input, 'address') &&
      client.direccion !== input.address
    ) {
      return true;
    }
    return (
      Object.prototype.hasOwnProperty.call(input, 'notes') &&
      client.notas !== input.notes
    );
  }

  private auditSnapshot(
    client: Client,
    changedFields: string[],
  ): Prisma.InputJsonObject {
    return {
      changedFields,
      hasDocument: client.tipo_documento !== null,
      hasEmail: client.correo !== null,
      hasPhone: client.telefono !== null,
      hasAddress: client.direccion !== null,
      hasNotes: client.notas !== null,
    };
  }

  private rethrowDocumentConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'A client with that document already exists in the organization',
      );
    }
    throw error;
  }

  private toResponse(client: Client) {
    return {
      id: client.id,
      documentType: client.tipo_documento,
      documentNumber: client.numero_documento,
      fullName: client.nombre_completo,
      phone: client.telefono,
      email: client.correo,
      address: client.direccion,
      notes: client.notas,
      active: client.activo,
      createdAt: client.creado_en,
      updatedAt: client.actualizado_en,
      organization: {
        id: client.organizaciones.id,
        code: client.organizaciones.codigo,
        name: client.organizaciones.nombre,
        type: client.organizaciones.tipo,
      },
    };
  }
}

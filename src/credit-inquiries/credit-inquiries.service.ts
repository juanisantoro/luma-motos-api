import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  luma_personal_estado,
  Prisma,
  resultado_crediticio_luma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  AuditService,
  type AuthenticatedAuditEvent,
} from '../audit/audit.service';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  normalizeClientDocument,
  normalizeClientName,
} from '../clients/client-normalization';
import { PrismaService, type TenantScope } from '../prisma/prisma.service';
import {
  CREDIT_INQUIRY_AUDIT_ACTIONS,
  IDEMPOTENCY_KEY_PATTERN,
} from './credit-inquiries.constants';
import {
  CreateCreditInquiryDto,
  CreateFinancialInstitutionDto,
  CreditHistoryQueryDto,
  FinancialInstitutionListQueryDto,
  ReferenceListQueryDto,
  RejectedInquiryQueryDto,
  VerifyDocumentQueryDto,
} from './credit-inquiries.dto';

const inquirySelect = {
  id: true,
  cliente_id: true,
  financiera_id: true,
  operacion_id: true,
  sucursal_id: true,
  consultado_en: true,
  resultado: true,
  motivo: true,
  consultado_por_personal_id: true,
  referencia_externa: true,
  clave_idempotencia: true,
  huella_idempotencia: true,
  creado_en: true,
  clientes: {
    select: {
      id: true,
      tipo_documento: true,
      numero_documento: true,
      nombre_completo: true,
    },
  },
  financieras_consultas_crediticias_financiera_id_organizacion_idTofinancieras:
    {
      select: {
        id: true,
        razon_social: true,
      },
    },
  personal: {
    select: {
      id: true,
      nombre_completo: true,
    },
  },
  sucursales_consultas_crediticias_sucursal_id_organizacion_idTosucursales: {
    select: {
      id: true,
      codigo: true,
      nombre: true,
    },
  },
  operaciones: {
    select: {
      id: true,
      numero_operacion: true,
    },
  },
} satisfies Prisma.consultas_crediticiasSelect;

type InquiryRecord = Prisma.consultas_crediticiasGetPayload<{
  select: typeof inquirySelect;
}>;

export interface HistorySummary {
  totalAttempts: number;
  rejectedAttempts: number;
  approvedAttempts: number;
  pendingAttempts: number;
  firstConsultedAt: Date | null;
  lastConsultedAt: Date | null;
}

@Injectable()
export class CreditInquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findRejected(query: RejectedInquiryQueryDto, actor: AuthenticatedUser) {
    const normalizedSearch = query.search
      ? normalizeClientName(query.search)
      : undefined;
    const normalizedSearchDocument = query.search
      ? normalizeClientDocument(query.search)
      : undefined;
    const normalizedDocument = query.document
      ? normalizeClientDocument(query.document)
      : undefined;
    const dateRange = this.dateRange(query.dateFrom, query.dateTo);
    const where: Prisma.consultas_crediticiasWhereInput = {
      organizacion_id: actor.organization.id,
      resultado: resultado_crediticio_luma.RECHAZADA,
      financiera_id: query.financialEntityId,
      sucursal_id: query.branchId,
      consultado_por_personal_id: query.registeredById,
      consultado_en: dateRange,
      clientes: {
        documento_normalizado: normalizedDocument
          ? { contains: normalizedDocument }
          : undefined,
        OR: normalizedSearch
          ? [
              {
                nombre_normalizado: {
                  contains: normalizedSearch,
                  mode: 'insensitive',
                },
              },
              {
                documento_normalizado: normalizedSearchDocument
                  ? { contains: normalizedSearchDocument }
                  : undefined,
              },
            ]
          : undefined,
      },
    };

    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const [total, records] = await Promise.all([
        tx.consultas_crediticias.count({ where }),
        tx.consultas_crediticias.findMany({
          where,
          select: inquirySelect,
          orderBy: [{ consultado_en: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ]);
      const attempts = await this.attemptCounts(
        tx,
        records.map((record) => record.cliente_id),
        actor.organization.id,
      );

      return {
        items: records.map((record) =>
          this.inquiry(record, attempts.get(record.cliente_id) ?? 0),
        ),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async verifyDocument(
    input: VerifyDocumentQueryDto,
    actor: AuthenticatedUser,
  ) {
    const document = normalizeClientDocument(input.documentNumber);
    this.assertNormalizedDocument(document);

    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const client = await tx.clientes.findFirst({
        where: {
          organizacion_id: actor.organization.id,
          tipo_documento: input.documentType,
          documento_normalizado: document,
        },
        select: { id: true },
      });
      if (!client) {
        return {
          found: false,
          clientId: null,
          isFlagged: false,
          blocksSale: false,
          lastRejection: null,
          summary: this.emptySummary(),
          checkedAt: new Date(),
        };
      }

      const [summary, lastRejection] = await Promise.all([
        this.historySummary(tx, client.id, actor.organization.id),
        tx.consultas_crediticias.findFirst({
          where: {
            cliente_id: client.id,
            organizacion_id: actor.organization.id,
            resultado: resultado_crediticio_luma.RECHAZADA,
          },
          select: inquirySelect,
          orderBy: [{ consultado_en: 'desc' }, { id: 'desc' }],
        }),
      ]);

      return {
        found: true,
        clientId: client.id,
        isFlagged: summary.rejectedAttempts > 0,
        blocksSale: false,
        lastRejection: lastRejection ? this.rejection(lastRejection) : null,
        summary,
        checkedAt: new Date(),
      };
    });
  }

  async findClientHistory(
    clientId: string,
    query: CreditHistoryQueryDto,
    actor: AuthenticatedUser,
  ) {
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const client = await tx.clientes.findFirst({
        where: {
          id: clientId,
          organizacion_id: actor.organization.id,
        },
        select: {
          id: true,
          tipo_documento: true,
          numero_documento: true,
          nombre_completo: true,
        },
      });
      if (!client) {
        throw new NotFoundException('Client not found');
      }
      const where: Prisma.consultas_crediticiasWhereInput = {
        cliente_id: clientId,
        organizacion_id: actor.organization.id,
        resultado: query.outcome,
      };
      const [total, records, summary] = await Promise.all([
        tx.consultas_crediticias.count({ where }),
        tx.consultas_crediticias.findMany({
          where,
          select: inquirySelect,
          orderBy: [{ consultado_en: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.historySummary(tx, clientId, actor.organization.id),
      ]);

      return {
        client: {
          id: client.id,
          documentType: client.tipo_documento,
          documentNumber: client.numero_documento,
          fullName: client.nombre_completo,
        },
        items: records.map((record) =>
          this.inquiry(record, summary.totalAttempts),
        ),
        summary,
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async create(
    input: CreateCreditInquiryDto,
    idempotencyKey: string | undefined,
    actor: AuthenticatedUser,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    const document = normalizeClientDocument(input.documentNumber);
    this.assertNormalizedDocument(document);
    this.assertReason(input);
    const consultedAt = this.consultedAt(input.consultedAt);
    const fingerprint = this.fingerprint(input, document, consultedAt);
    const existing = await this.findByIdempotencyKey(idempotencyKey, actor);
    if (existing) {
      return this.replay(existing, fingerprint, actor);
    }

    const auditEvent: AuthenticatedAuditEvent = {
      action: CREDIT_INQUIRY_AUDIT_ACTIONS.CREATED,
      entity: 'consultas_crediticias',
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: false,
      metadata: {
        outcome: input.outcome,
        hasReason: input.reason !== undefined,
        hasOperation: input.operationId !== undefined,
        hasExternalReference: input.externalReference !== undefined,
      },
    };

    try {
      const result = await this.audit.execute(auditEvent, async (tx) => {
        await this.requireFinancialInstitution(
          tx,
          input.financialEntityId,
          actor.organization.id,
        );
        const client = await this.findOrCreateClient(
          tx,
          input,
          document,
          actor.organization.id,
        );
        const registrant = await this.registrationPersonnel(tx, input, actor);
        const branchId = await this.registrationBranch(
          tx,
          input.branchId,
          registrant,
          actor,
        );
        await this.requireOperation(
          tx,
          input.operationId,
          client.id,
          actor.organization.id,
        );

        const created = await tx.consultas_crediticias.create({
          data: {
            cliente_id: client.id,
            financiera_id: input.financialEntityId,
            operacion_id: input.operationId,
            sucursal_id: branchId,
            consultado_en: consultedAt,
            resultado: input.outcome,
            motivo: input.reason,
            consultado_por_personal_id: registrant.id,
            referencia_externa: input.externalReference,
            clave_idempotencia: idempotencyKey,
            huella_idempotencia: fingerprint,
            organizacion_id: actor.organization.id,
          },
          select: inquirySelect,
        });
        auditEvent.entityId = created.id;
        auditEvent.metadata = {
          ...(auditEvent.metadata as Prisma.InputJsonObject),
          branchId,
          financialEntityId: input.financialEntityId,
          registeredById: registrant.id,
        };
        const attemptCount = await tx.consultas_crediticias.count({
          where: {
            cliente_id: client.id,
            organizacion_id: actor.organization.id,
          },
        });
        return { record: created, attemptCount };
      });
      return {
        ...this.inquiry(result.record, result.attemptCount),
        idempotentReplay: false,
      };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replay = await this.findByIdempotencyKey(idempotencyKey, actor);
        if (replay) {
          return this.replay(replay, fingerprint, actor);
        }
        throw new ConflictException(
          'The credit inquiry conflicts with an existing record',
        );
      }
      throw error;
    }
  }

  async findFinancialInstitutions(
    query: FinancialInstitutionListQueryDto,
    actor: AuthenticatedUser,
  ) {
    const search = query.search?.trim();
    const normalizedName = search ? normalizeClientName(search) : undefined;
    const normalizedTaxId = search
      ? normalizeClientDocument(search)
      : undefined;
    const where: Prisma.financierasWhereInput = {
      organizacion_id: actor.organization.id,
      activo: query.active,
      OR: search
        ? [
            {
              nombre_normalizado: {
                contains: normalizedName,
                mode: 'insensitive',
              },
            },
            {
              identificacion_fiscal_normalizada: normalizedTaxId
                ? { contains: normalizedTaxId }
                : undefined,
            },
          ]
        : undefined,
    };
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const [total, records] = await Promise.all([
        tx.financieras.count({ where }),
        tx.financieras.findMany({
          where,
          select: {
            id: true,
            razon_social: true,
            identificacion_fiscal: true,
            activo: true,
            creado_en: true,
          },
          orderBy: [{ razon_social: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ]);
      return {
        items: records.map((record) => ({
          id: record.id,
          name: record.razon_social,
          taxId: record.identificacion_fiscal,
          active: record.activo,
          createdAt: record.creado_en,
        })),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async createFinancialInstitution(
    input: CreateFinancialInstitutionDto,
    actor: AuthenticatedUser,
  ) {
    const normalizedName = normalizeClientName(input.name);
    const normalizedTaxId = input.taxId
      ? normalizeClientDocument(input.taxId)
      : undefined;
    if (normalizedTaxId) {
      this.assertNormalizedDocument(normalizedTaxId);
    }
    const event: AuthenticatedAuditEvent = {
      action: CREDIT_INQUIRY_AUDIT_ACTIONS.FINANCIAL_INSTITUTION_CREATED,
      entity: 'financieras',
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: false,
      metadata: {
        hasTaxId: input.taxId !== undefined,
      },
    };

    try {
      const created = await this.audit.execute(event, async (tx) => {
        const record = await tx.financieras.create({
          data: {
            razon_social: input.name,
            nombre_normalizado: normalizedName,
            identificacion_fiscal: input.taxId,
            identificacion_fiscal_normalizada: normalizedTaxId,
            organizacion_id: actor.organization.id,
          },
          select: {
            id: true,
            razon_social: true,
            identificacion_fiscal: true,
            activo: true,
            creado_en: true,
          },
        });
        event.entityId = record.id;
        return record;
      });
      return {
        id: created.id,
        name: created.razon_social,
        taxId: created.identificacion_fiscal,
        active: created.activo,
        createdAt: created.creado_en,
      };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A financial institution with that name or tax ID already exists',
        );
      }
      throw error;
    }
  }

  async findRegistrants(
    query: ReferenceListQueryDto,
    actor: AuthenticatedUser,
  ) {
    const search = query.search ? normalizeClientName(query.search) : undefined;
    const where: Prisma.personalWhereInput = {
      organizacion_id: actor.organization.id,
      estado: luma_personal_estado.ACTIVO,
      puede_iniciar_sesion: true,
      nombre_normalizado: search
        ? { contains: search, mode: 'insensitive' }
        : undefined,
      roles: {
        permisos_rol: {
          some: {
            codigo_permiso: PERMISSION_CODES.CREDIT_INQUIRIES_CREATE,
          },
        },
      },
      OR: query.branchId
        ? [
            { sucursal_principal_id: query.branchId },
            {
              acceso_personal_sucursal: {
                some: { sucursal_id: query.branchId },
              },
            },
          ]
        : undefined,
    };

    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const [total, records] = await Promise.all([
        tx.personal.count({ where }),
        tx.personal.findMany({
          where,
          select: {
            id: true,
            nombre_completo: true,
            sucursales: {
              select: { id: true, codigo: true, nombre: true },
            },
          },
          orderBy: [{ nombre_completo: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ]);
      return {
        items: records.map((record) => ({
          id: record.id,
          fullName: record.nombre_completo,
          primaryBranch: record.sucursales
            ? {
                id: record.sucursales.id,
                code: record.sucursales.codigo,
                name: record.sucursales.nombre,
              }
            : null,
        })),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async findBranches(query: ReferenceListQueryDto, actor: AuthenticatedUser) {
    const search = query.search?.trim();
    const where: Prisma.sucursalesWhereInput = {
      organizacion_id: actor.organization.id,
      activa: true,
      OR: search
        ? [
            { nombre: { contains: search, mode: 'insensitive' } },
            { codigo: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const [total, records] = await Promise.all([
        tx.sucursales.count({ where }),
        tx.sucursales.findMany({
          where,
          select: { id: true, codigo: true, nombre: true },
          orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ]);
      return {
        items: records.map((record) => ({
          id: record.id,
          code: record.codigo,
          name: record.nombre,
        })),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  private scope(actor: AuthenticatedUser): TenantScope {
    return {
      organizationId: actor.organization.id,
      globalAccess: false,
    };
  }

  private async findByIdempotencyKey(
    idempotencyKey: string,
    actor: AuthenticatedUser,
  ): Promise<InquiryRecord | null> {
    return this.prisma.withTenant(this.scope(actor), (tx) =>
      tx.consultas_crediticias.findUnique({
        where: {
          organizacion_id_clave_idempotencia: {
            organizacion_id: actor.organization.id,
            clave_idempotencia: idempotencyKey,
          },
        },
        select: inquirySelect,
      }),
    );
  }

  private async replay(
    record: InquiryRecord,
    fingerprint: string,
    actor: AuthenticatedUser,
  ) {
    if (record.huella_idempotencia !== fingerprint) {
      throw new ConflictException(
        'Idempotency-Key was already used with a different payload',
      );
    }
    const attemptCount = await this.prisma.withTenant(this.scope(actor), (tx) =>
      tx.consultas_crediticias.count({
        where: {
          cliente_id: record.cliente_id,
          organizacion_id: actor.organization.id,
        },
      }),
    );
    return { ...this.inquiry(record, attemptCount), idempotentReplay: true };
  }

  private async findOrCreateClient(
    tx: Prisma.TransactionClient,
    input: CreateCreditInquiryDto,
    normalizedDocument: string,
    organizationId: string,
  ): Promise<{ id: string }> {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`${organizationId}:${input.documentType}:${normalizedDocument}`},
          0
        )
      )
    `;
    const existing = await tx.clientes.findFirst({
      where: {
        organizacion_id: organizationId,
        tipo_documento: input.documentType,
        documento_normalizado: normalizedDocument,
      },
      select: { id: true },
    });
    if (existing) {
      return existing;
    }
    return tx.clientes.create({
      data: {
        tipo_documento: input.documentType,
        numero_documento: input.documentNumber,
        documento_normalizado: normalizedDocument,
        nombre_completo: input.fullName,
        nombre_normalizado: normalizeClientName(input.fullName),
        organizacion_id: organizationId,
      },
      select: { id: true },
    });
  }

  private async registrationPersonnel(
    tx: Prisma.TransactionClient,
    input: CreateCreditInquiryDto,
    actor: AuthenticatedUser,
  ): Promise<{
    id: string;
    usuario_id: string | null;
    sucursal_principal_id: string | null;
  }> {
    const personnel = await tx.personal.findFirst({
      where: {
        id: input.registeredById,
        usuario_id: input.registeredById ? undefined : actor.id,
        organizacion_id: actor.organization.id,
        estado: luma_personal_estado.ACTIVO,
        puede_iniciar_sesion: true,
        roles: {
          permisos_rol: {
            some: {
              codigo_permiso: PERMISSION_CODES.CREDIT_INQUIRIES_CREATE,
            },
          },
        },
      },
      select: {
        id: true,
        usuario_id: true,
        sucursal_principal_id: true,
      },
    });
    if (!personnel) {
      throw new BadRequestException(
        'The registering user is invalid or inactive for this organization',
      );
    }
    if (
      personnel.usuario_id !== actor.id &&
      !actor.role.permissions.includes(PERMISSION_CODES.CREDIT_INQUIRIES_READ)
    ) {
      throw new ForbiddenException(
        'Registering an inquiry for another user requires consolidated read permission',
      );
    }
    return personnel;
  }

  private async registrationBranch(
    tx: Prisma.TransactionClient,
    requestedBranchId: string | undefined,
    personnel: { id: string; sucursal_principal_id: string | null },
    actor: AuthenticatedUser,
  ): Promise<string> {
    const branchId =
      requestedBranchId ??
      actor.branch?.id ??
      personnel.sucursal_principal_id ??
      undefined;
    if (!branchId) {
      throw new BadRequestException(
        'branchId is required when no branch can be derived from the user',
      );
    }
    const branch = await tx.sucursales.findFirst({
      where: {
        id: branchId,
        organizacion_id: actor.organization.id,
        activa: true,
      },
      select: { id: true },
    });
    if (!branch) {
      throw new BadRequestException(
        'The branch is invalid or inactive for this organization',
      );
    }
    if (personnel.sucursal_principal_id !== branchId) {
      const access = await tx.acceso_personal_sucursal.findFirst({
        where: {
          personal_id: personnel.id,
          sucursal_id: branchId,
          organizacion_id: actor.organization.id,
        },
        select: { personal_id: true },
      });
      if (!access) {
        throw new BadRequestException(
          'The registering user does not have access to the selected branch',
        );
      }
    }
    return branchId;
  }

  private async requireFinancialInstitution(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ): Promise<void> {
    const institution = await tx.financieras.findFirst({
      where: { id, organizacion_id: organizationId, activo: true },
      select: { id: true },
    });
    if (!institution) {
      throw new BadRequestException(
        'The financial institution is invalid or inactive for this organization',
      );
    }
  }

  private async requireOperation(
    tx: Prisma.TransactionClient,
    operationId: string | undefined,
    clientId: string,
    organizationId: string,
  ): Promise<void> {
    if (!operationId) {
      return;
    }
    const operation = await tx.operaciones.findFirst({
      where: {
        id: operationId,
        cliente_id: clientId,
        organizacion_id: organizationId,
      },
      select: { id: true },
    });
    if (!operation) {
      throw new BadRequestException(
        'The operation is invalid or belongs to a different client',
      );
    }
  }

  private async attemptCounts(
    tx: Prisma.TransactionClient,
    clientIds: string[],
    organizationId: string,
  ): Promise<Map<string, number>> {
    if (clientIds.length === 0) {
      return new Map();
    }
    const counts = await tx.consultas_crediticias.groupBy({
      by: ['cliente_id'],
      where: {
        organizacion_id: organizationId,
        cliente_id: { in: [...new Set(clientIds)] },
      },
      _count: { _all: true },
    });
    return new Map(
      counts.map((count) => [count.cliente_id, count._count._all]),
    );
  }

  private async historySummary(
    tx: Prisma.TransactionClient,
    clientId: string,
    organizationId: string,
  ): Promise<HistorySummary> {
    const where: Prisma.consultas_crediticiasWhereInput = {
      cliente_id: clientId,
      organizacion_id: organizationId,
    };
    const [counts, range] = await Promise.all([
      tx.consultas_crediticias.groupBy({
        by: ['resultado'],
        where,
        _count: { _all: true },
      }),
      tx.consultas_crediticias.aggregate({
        where,
        _count: { _all: true },
        _min: { consultado_en: true },
        _max: { consultado_en: true },
      }),
    ]);
    const count = new Map(
      counts.map((entry) => [entry.resultado, entry._count._all]),
    );
    return {
      totalAttempts: range._count._all,
      rejectedAttempts: count.get(resultado_crediticio_luma.RECHAZADA) ?? 0,
      approvedAttempts: count.get(resultado_crediticio_luma.APROBADA) ?? 0,
      pendingAttempts: count.get(resultado_crediticio_luma.PENDIENTE) ?? 0,
      firstConsultedAt: range._min.consultado_en,
      lastConsultedAt: range._max.consultado_en,
    };
  }

  private emptySummary(): HistorySummary {
    return {
      totalAttempts: 0,
      rejectedAttempts: 0,
      approvedAttempts: 0,
      pendingAttempts: 0,
      firstConsultedAt: null,
      lastConsultedAt: null,
    };
  }

  private inquiry(record: InquiryRecord, attemptCount: number) {
    const institution =
      record.financieras_consultas_crediticias_financiera_id_organizacion_idTofinancieras;
    const branch =
      record.sucursales_consultas_crediticias_sucursal_id_organizacion_idTosucursales;
    return {
      id: record.id,
      client: {
        id: record.clientes.id,
        documentType: record.clientes.tipo_documento,
        documentNumber: record.clientes.numero_documento,
        fullName: record.clientes.nombre_completo,
      },
      financialEntity: {
        id: institution.id,
        name: institution.razon_social,
      },
      outcome: record.resultado,
      reason: record.motivo,
      consultedAt: record.consultado_en,
      attemptCount,
      branch: {
        id: branch.id,
        code: branch.codigo,
        name: branch.nombre,
      },
      registeredBy: {
        id: record.personal.id,
        fullName: record.personal.nombre_completo,
      },
      operation: record.operaciones
        ? {
            id: record.operaciones.id,
            number: record.operaciones.numero_operacion.toString(),
          }
        : null,
      externalReference: record.referencia_externa,
      createdAt: record.creado_en,
    };
  }

  private rejection(record: InquiryRecord) {
    const institution =
      record.financieras_consultas_crediticias_financiera_id_organizacion_idTofinancieras;
    return {
      inquiryId: record.id,
      financialEntity: {
        id: institution.id,
        name: institution.razon_social,
      },
      rejectedAt: record.consultado_en,
      reason: record.motivo,
    };
  }

  private assertIdempotencyKey(
    idempotencyKey: string | undefined,
  ): asserts idempotencyKey is string {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException(
        'Idempotency-Key header must contain 8 to 120 safe characters',
      );
    }
  }

  private assertNormalizedDocument(document: string): void {
    if (document.length < 5 || document.length > 30) {
      throw new BadRequestException(
        'Document number must contain between 5 and 30 letters or digits',
      );
    }
  }

  private assertReason(input: CreateCreditInquiryDto): void {
    if (
      input.outcome === resultado_crediticio_luma.RECHAZADA &&
      !input.reason
    ) {
      throw new BadRequestException(
        'reason is required when outcome is RECHAZADA',
      );
    }
  }

  private consultedAt(value: string): Date {
    const result = new Date(value);
    if (result.getTime() > Date.now() + 5 * 60_000) {
      throw new BadRequestException(
        'consultedAt cannot be more than five minutes in the future',
      );
    }
    if (result.getUTCFullYear() < 2000) {
      throw new BadRequestException('consultedAt is outside the allowed range');
    }
    return result;
  }

  private fingerprint(
    input: CreateCreditInquiryDto,
    normalizedDocument: string,
    consultedAt: Date,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          documentType: input.documentType,
          documentNumber: normalizedDocument,
          fullName: normalizeClientName(input.fullName),
          financialEntityId: input.financialEntityId,
          outcome: input.outcome,
          reason: input.reason ?? null,
          consultedAt: consultedAt.toISOString(),
          registeredById: input.registeredById ?? null,
          branchId: input.branchId ?? null,
          operationId: input.operationId ?? null,
          externalReference: input.externalReference ?? null,
        }),
      )
      .digest('hex');
  }

  private dateRange(
    from: string | undefined,
    to: string | undefined,
  ): Prisma.DateTimeFilter | undefined {
    if (!from && !to) {
      return undefined;
    }
    const start = from ? new Date(from) : undefined;
    let end = to ? new Date(to) : undefined;
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      end = new Date(`${to}T23:59:59.999Z`);
    }
    if (start && end && start > end) {
      throw new BadRequestException('dateFrom must not be after dateTo');
    }
    return { gte: start, lte: end };
  }
}

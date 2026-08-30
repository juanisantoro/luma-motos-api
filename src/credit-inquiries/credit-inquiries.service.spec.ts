import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  Prisma,
  resultado_crediticio_luma,
  tipo_documento_luma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { CreditInquiriesService } from './credit-inquiries.service';

describe('CreditInquiriesService', () => {
  const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
  const clientId = '7d5cc401-544e-4651-9bd6-52495887fecd';
  const financialEntityId = 'aa49c8ec-e497-495c-a11f-7d74287f942d';
  const branchId = '84e778cc-7616-4792-b6db-d89f100bb6f1';
  const personnelId = 'd256c5d6-1db3-49fa-9258-a836b7c7435e';
  const inquiryId = '1e6268bd-8d75-412e-9df4-d9ead4f08d06';
  const actor: AuthenticatedUser = {
    id: 'd16c3c21-8d15-4bc9-a282-7ba4c9a0cc31',
    email: 'admin@luma.test',
    name: 'Luma Admin',
    active: true,
    globalAccess: false,
    organization: {
      id: organizationId,
      code: 'LUMA_CENTRAL',
      name: 'Luma Motos',
      type: 'CASA_CENTRAL',
    },
    role: {
      id: '4bd1189b-2bb1-4258-889b-4500de5eeade',
      code: 'ADMINISTRADOR',
      name: 'Administrador',
      system: true,
      permissions: [
        'consultas_crediticias.consultar',
        'consultas_crediticias.registrar',
      ],
    },
    branch: { id: branchId, code: 'CENTRAL', name: 'Central' },
  };
  const input = {
    documentType: tipo_documento_luma.DNI,
    documentNumber: '12.345.678',
    fullName: 'Ana Cliente',
    financialEntityId,
    outcome: resultado_crediticio_luma.RECHAZADA,
    reason: 'Scoring insuficiente',
    consultedAt: '2026-08-29T15:00:00.000Z',
  };
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        documentType: input.documentType,
        documentNumber: '12345678',
        fullName: 'ana cliente',
        financialEntityId,
        outcome: input.outcome,
        reason: input.reason,
        consultedAt: input.consultedAt,
        registeredById: null,
        branchId: null,
        operationId: null,
        externalReference: null,
      }),
    )
    .digest('hex');
  const inquiry = {
    id: inquiryId,
    cliente_id: clientId,
    financiera_id: financialEntityId,
    operacion_id: null,
    sucursal_id: branchId,
    consultado_en: new Date(input.consultedAt),
    resultado: resultado_crediticio_luma.RECHAZADA,
    motivo: input.reason,
    consultado_por_personal_id: personnelId,
    referencia_externa: null,
    clave_idempotencia: 'credit-12345678',
    huella_idempotencia: fingerprint,
    creado_en: new Date('2026-08-29T15:00:01.000Z'),
    clientes: {
      id: clientId,
      tipo_documento: tipo_documento_luma.DNI,
      numero_documento: '12.345.678',
      nombre_completo: 'Ana Cliente',
    },
    financieras_consultas_crediticias_financiera_id_organizacion_idTofinancieras:
      {
        id: financialEntityId,
        razon_social: 'Banco Demo',
      },
    personal: {
      id: personnelId,
      nombre_completo: 'Vendedor Demo',
    },
    sucursales_consultas_crediticias_sucursal_id_organizacion_idTosucursales: {
      id: branchId,
      codigo: 'CENTRAL',
      nombre: 'Central',
    },
    operaciones: null,
  };

  const tx = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    consultas_crediticias: {
      count: jest.fn(),
      findMany: jest.fn<
        Promise<unknown[]>,
        [Prisma.consultas_crediticiasFindManyArgs]
      >(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn<
        Promise<unknown>,
        [Prisma.consultas_crediticiasCreateArgs]
      >(),
      groupBy: jest.fn(),
      aggregate: jest.fn(),
    },
    clientes: {
      findFirst: jest.fn(),
      create: jest.fn<Promise<unknown>, [Prisma.clientesCreateArgs]>(),
    },
    financieras: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn<Promise<unknown>, [Prisma.financierasCreateArgs]>(),
    },
    personal: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn<Promise<unknown>, [Prisma.personalFindFirstArgs]>(),
    },
    sucursales: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    acceso_personal_sucursal: {
      findFirst: jest.fn(),
    },
    operaciones: {
      findFirst: jest.fn(),
    },
  };
  const withTenant = jest.fn();
  const executeAudit = jest.fn();
  let auditedEvents: AuthenticatedAuditEvent[];
  let service: CreditInquiriesService;

  beforeEach(() => {
    jest.clearAllMocks();
    auditedEvents = [];
    withTenant.mockImplementation(
      (
        _scope: unknown,
        operation: (transaction: Prisma.TransactionClient) => Promise<unknown>,
      ) => operation(tx as unknown as Prisma.TransactionClient),
    );
    executeAudit.mockImplementation(
      (
        event: AuthenticatedAuditEvent,
        operation: (transaction: Prisma.TransactionClient) => Promise<unknown>,
      ) => {
        auditedEvents.push(event);
        return operation(tx as unknown as Prisma.TransactionClient);
      },
    );
    service = new CreditInquiriesService(
      { withTenant } as unknown as PrismaService,
      { execute: executeAudit } as unknown as AuditService,
    );
  });

  it('lists one row per rejected inquiry inside the authenticated tenant', async () => {
    tx.consultas_crediticias.count.mockResolvedValue(1);
    tx.consultas_crediticias.findMany.mockResolvedValue([inquiry]);
    tx.consultas_crediticias.groupBy.mockResolvedValue([
      { cliente_id: clientId, _count: { _all: 3 } },
    ]);

    const result = await service.findRejected(
      {
        page: 1,
        limit: 20,
        search: 'Ana',
        document: '12.345',
        branchId,
      },
      actor,
    );

    expect(withTenant).toHaveBeenCalledWith(
      { organizationId, globalAccess: false },
      expect.any(Function),
    );
    expect(tx.consultas_crediticias.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        organizacion_id: organizationId,
        resultado: 'RECHAZADA',
        sucursal_id: branchId,
        clientes: {
          documento_normalizado: { contains: '12345' },
        },
      },
      skip: 0,
      take: 20,
    });
    expect(result).toMatchObject({
      items: [
        {
          id: inquiryId,
          attemptCount: 3,
          client: { fullName: 'Ana Cliente' },
        },
      ],
      total: 1,
    });
  });

  it('returns a safe non-match when the document does not exist in the tenant', async () => {
    tx.clientes.findFirst.mockResolvedValue(null);

    const result = await service.verifyDocument(
      { documentType: tipo_documento_luma.DNI, documentNumber: '12.345.678' },
      actor,
    );

    expect(tx.clientes.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizacion_id: organizationId,
          tipo_documento: 'DNI',
          documento_normalizado: '12345678',
        },
      }),
    );
    expect(result).toMatchObject({
      found: false,
      clientId: null,
      isFlagged: false,
      blocksSale: false,
      lastRejection: null,
      summary: { totalAttempts: 0, rejectedAttempts: 0 },
    });
    expect(result).not.toHaveProperty('documentNumber');
  });

  it('derives flagged verification and history from all outcomes', async () => {
    tx.clientes.findFirst.mockResolvedValue({ id: clientId });
    tx.consultas_crediticias.groupBy.mockResolvedValue([
      { resultado: 'RECHAZADA', _count: { _all: 2 } },
      { resultado: 'APROBADA', _count: { _all: 1 } },
    ]);
    tx.consultas_crediticias.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _min: { consultado_en: new Date('2026-08-01T10:00:00.000Z') },
      _max: { consultado_en: inquiry.consultado_en },
    });
    tx.consultas_crediticias.findFirst.mockResolvedValue(inquiry);

    const result = await service.verifyDocument(
      { documentType: tipo_documento_luma.DNI, documentNumber: '12345678' },
      actor,
    );

    expect(result).toMatchObject({
      found: true,
      clientId,
      isFlagged: true,
      blocksSale: false,
      lastRejection: {
        inquiryId,
        financialEntity: { name: 'Banco Demo' },
        reason: input.reason,
      },
      summary: {
        totalAttempts: 3,
        rejectedAttempts: 2,
        approvedAttempts: 1,
        pendingAttempts: 0,
      },
    });
  });

  it('rejects a rejection without a reason before opening a transaction', async () => {
    await expect(
      service.create({ ...input, reason: undefined }, 'credit-12345678', actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withTenant).not.toHaveBeenCalled();
    expect(executeAudit).not.toHaveBeenCalled();
  });

  it('creates a normalized client and inquiry atomically with PII-safe audit', async () => {
    tx.consultas_crediticias.findUnique.mockResolvedValue(null);
    tx.consultas_crediticias.count.mockResolvedValue(1);
    tx.financieras.findFirst.mockResolvedValue({ id: financialEntityId });
    tx.clientes.findFirst.mockResolvedValue(null);
    tx.clientes.create.mockResolvedValue({ id: clientId });
    tx.personal.findFirst.mockResolvedValue({
      id: personnelId,
      sucursal_principal_id: branchId,
    });
    tx.sucursales.findFirst.mockResolvedValue({ id: branchId });
    tx.consultas_crediticias.create.mockResolvedValue(inquiry);

    const result = await service.create(input, 'credit-12345678', actor);

    const clientCreate = tx.clientes.create.mock.calls[0]?.[0] as
      Prisma.clientesCreateArgs | undefined;
    expect(clientCreate?.data).toMatchObject({
      documento_normalizado: '12345678',
      nombre_normalizado: 'ana cliente',
      organizacion_id: organizationId,
    });
    const inquiryCreate = tx.consultas_crediticias.create.mock.calls[0]?.[0];
    expect(inquiryCreate?.data).toMatchObject({
      cliente_id: clientId,
      organizacion_id: organizationId,
      clave_idempotencia: 'credit-12345678',
      huella_idempotencia: fingerprint,
    });
    expect(result).toMatchObject({ id: inquiryId, idempotentReplay: false });
    expect(auditedEvents[0]).toMatchObject({
      action: 'CREDIT_INQUIRY_CREATED',
      entityId: inquiryId,
      organizationId,
      metadata: {
        outcome: 'RECHAZADA',
        hasReason: true,
        financialEntityId,
      },
    });
    const audited = JSON.stringify(auditedEvents[0]);
    expect(audited).not.toContain(input.documentNumber);
    expect(audited).not.toContain(input.reason);
  });

  it('replays an identical idempotent request and rejects key reuse', async () => {
    tx.consultas_crediticias.findUnique.mockResolvedValue(inquiry);
    tx.consultas_crediticias.count.mockResolvedValue(3);

    const replay = await service.create(input, 'credit-12345678', actor);
    expect(replay).toMatchObject({
      id: inquiryId,
      attemptCount: 3,
      idempotentReplay: true,
    });
    expect(executeAudit).not.toHaveBeenCalled();

    await expect(
      service.create(
        { ...input, reason: 'Un motivo diferente' },
        'credit-12345678',
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns paginated client history with all outcome counters', async () => {
    tx.clientes.findFirst.mockResolvedValue(inquiry.clientes);
    tx.consultas_crediticias.count.mockResolvedValue(3);
    tx.consultas_crediticias.findMany.mockResolvedValue([inquiry]);
    tx.consultas_crediticias.groupBy.mockResolvedValue([
      { resultado: 'RECHAZADA', _count: { _all: 2 } },
      { resultado: 'PENDIENTE', _count: { _all: 1 } },
    ]);
    tx.consultas_crediticias.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _min: { consultado_en: new Date('2026-08-01T10:00:00.000Z') },
      _max: { consultado_en: inquiry.consultado_en },
    });

    const result = await service.findClientHistory(
      clientId,
      { page: 1, limit: 20 },
      actor,
    );

    expect(result).toMatchObject({
      client: { id: clientId },
      items: [{ id: inquiryId, attemptCount: 3 }],
      summary: {
        totalAttempts: 3,
        rejectedAttempts: 2,
        pendingAttempts: 1,
      },
      total: 3,
    });
  });

  it('prevents a registrar from attributing an inquiry to another user', async () => {
    const seller = {
      ...actor,
      role: {
        id: '10c1cc35-c472-4a99-9dce-ae4ce60ae347',
        code: 'VENDEDOR',
        name: 'Vendedor',
        system: true,
        permissions: ['consultas_crediticias.registrar'],
      },
    };
    tx.consultas_crediticias.findUnique.mockResolvedValue(null);
    tx.financieras.findFirst.mockResolvedValue({ id: financialEntityId });
    tx.clientes.findFirst.mockResolvedValue({ id: clientId });
    tx.personal.findFirst.mockResolvedValue({
      id: personnelId,
      usuario_id: 'bea943ce-3d80-4a24-a8d2-45c81e8d7604',
      sucursal_principal_id: branchId,
    });

    await expect(
      service.create(
        { ...input, registeredById: personnelId },
        'credit-other-user',
        seller,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.personal.findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        organizacion_id: organizationId,
        puede_iniciar_sesion: true,
        roles: {
          permisos_rol: {
            some: { codigo_permiso: 'consultas_crediticias.registrar' },
          },
        },
      },
    });
  });

  it('normalizes financial institutions and maps duplicate names or tax IDs', async () => {
    tx.financieras.create.mockResolvedValueOnce({
      id: financialEntityId,
      razon_social: 'Banco Demo',
      identificacion_fiscal: '30-12345678-9',
      activo: true,
      creado_en: new Date('2026-08-29T15:00:00.000Z'),
    });

    await service.createFinancialInstitution(
      { name: 'Banco Demo', taxId: '30-12345678-9' },
      actor,
    );
    expect(tx.financieras.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        nombre_normalizado: 'banco demo',
        identificacion_fiscal_normalizada: '30123456789',
        organizacion_id: organizationId,
      },
    });

    tx.financieras.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.12.0',
      }),
    );
    await expect(
      service.createFinancialInstitution({ name: 'Banco Demo' }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

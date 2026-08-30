import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditService,
  type AuthenticatedAuditEvent,
} from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { CLIENT_AUDIT_ACTIONS } from './clients.constants';
import { ClientsService } from './clients.service';

describe('ClientsService', () => {
  const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
  const otherOrganizationId = 'e34b9365-bfdc-46d2-8302-b99e2f212880';
  const clientId = '7d5cc401-544e-4651-9bd6-52495887fecd';
  const actor: AuthenticatedUser = {
    id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
    email: 'admin@luma.test',
    name: 'Luma Admin',
    active: true,
    globalAccess: false,
    organization: {
      id: organizationId,
      code: 'LUMA_CENTRAL',
      name: 'Luma Motos Casa Central',
      type: 'CASA_CENTRAL',
    },
    role: {
      id: '4bd1189b-2bb1-4258-889b-4500de5eeade',
      code: 'ADMINISTRADOR',
      name: 'Administrador',
      system: true,
      permissions: ['clientes.consultar', 'clientes.gestionar'],
    },
    branch: null,
  };
  const client = {
    id: clientId,
    tipo_documento: 'DNI' as const,
    numero_documento: '12.345.678',
    nombre_completo: 'Ana Cliente',
    telefono: '+54 11 5555-5555',
    correo: 'ana@example.com',
    direccion: 'Calle 123',
    notas: 'Prefiere contacto por email',
    activo: true,
    creado_en: new Date('2026-08-29T10:00:00.000Z'),
    actualizado_en: new Date('2026-08-29T10:00:00.000Z'),
    organizacion_id: organizationId,
    organizaciones: {
      id: organizationId,
      codigo: 'LUMA_CENTRAL',
      nombre: 'Luma Motos Casa Central',
      tipo: 'CASA_CENTRAL' as const,
    },
  };

  const countClients = jest.fn<Promise<number>, [Prisma.clientesCountArgs]>();
  const findClients = jest.fn<
    Promise<unknown[]>,
    [Prisma.clientesFindManyArgs]
  >();
  const findClient = jest.fn<
    Promise<unknown>,
    [Prisma.clientesFindFirstArgs]
  >();
  const createClient = jest.fn<Promise<unknown>, [Prisma.clientesCreateArgs]>();
  const updateClient = jest.fn<Promise<unknown>, [Prisma.clientesUpdateArgs]>();
  const findOrganization = jest.fn<
    Promise<unknown>,
    [Prisma.organizacionesFindFirstArgs]
  >();
  const lockClient = jest.fn();
  const withTenant = jest.fn();
  const executeAudit = jest.fn();
  let auditedEvents: AuthenticatedAuditEvent[];
  let transaction: Prisma.TransactionClient;
  let service: ClientsService;

  beforeEach(() => {
    jest.clearAllMocks();
    auditedEvents = [];
    transaction = {
      $queryRaw: lockClient,
      $executeRaw: lockClient,
      clientes: {
        count: countClients,
        findMany: findClients,
        findFirst: findClient,
        create: createClient,
        update: updateClient,
      },
      organizaciones: {
        findFirst: findOrganization,
      },
    } as unknown as Prisma.TransactionClient;
    lockClient.mockResolvedValue([{ id: clientId }]);
    withTenant.mockImplementation(
      (
        _scope: unknown,
        operation: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => operation(transaction),
    );
    executeAudit.mockImplementation(
      (
        event: AuthenticatedAuditEvent,
        operation: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => {
        auditedEvents.push(event);
        return operation(transaction);
      },
    );
    service = new ClientsService(
      { withTenant } as unknown as PrismaService,
      { execute: executeAudit } as unknown as AuditService,
    );
  });

  it('lists tenant clients with normalized search and stable pagination', async () => {
    countClients.mockResolvedValue(1);
    findClients.mockResolvedValue([client]);

    const result = await service.findAll(
      { page: 2, limit: 10, search: '  ANA  ', active: true },
      actor,
    );

    expect(withTenant).toHaveBeenCalledWith(
      { organizationId, globalAccess: false },
      expect.any(Function),
    );
    expect(countClients.mock.calls[0]?.[0]).toMatchObject({
      where: {
        organizacion_id: organizationId,
        activo: true,
      },
    });
    expect(countClients.mock.calls[0]?.[0].where.OR).toHaveLength(3);
    expect(findClients).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        orderBy: [{ creado_en: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(result).toMatchObject({
      total: 1,
      page: 2,
      limit: 10,
      items: [{ id: clientId, fullName: 'Ana Cliente' }],
    });
  });

  it('allows only global actors to filter another organization', async () => {
    await expect(
      service.findAll(
        {
          page: 1,
          limit: 50,
          organizationId: otherOrganizationId,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(withTenant).not.toHaveBeenCalled();

    countClients.mockResolvedValue(0);
    findClients.mockResolvedValue([]);
    const globalActor = { ...actor, globalAccess: true };
    await service.findAll(
      {
        page: 1,
        limit: 50,
        organizationId: otherOrganizationId,
      },
      globalActor,
    );
    expect(countClients.mock.calls[0]?.[0]).toMatchObject({
      where: {
        organizacion_id: otherOrganizationId,
      },
    });
  });

  it('returns only a client visible to the actor tenant', async () => {
    findClient.mockResolvedValue(client);

    const result = await service.findOne(clientId, actor);

    expect(findClient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: clientId, organizacion_id: organizationId },
      }),
    );
    expect(result).toMatchObject({
      id: clientId,
      documentType: 'DNI',
      organization: { id: organizationId },
    });
  });

  it('hides missing and cross-tenant clients behind a not-found response', async () => {
    findClient.mockResolvedValue(null);

    await expect(service.findOne(clientId, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates a normalized client atomically with a PII-safe audit event', async () => {
    findOrganization.mockResolvedValue({ id: organizationId });
    createClient.mockResolvedValue(client);

    const result = await service.create(
      {
        fullName: 'Ana Cliente',
        documentType: 'DNI',
        documentNumber: '12.345.678',
        email: 'ana@example.com',
        phone: '+54 11 5555-5555',
      },
      actor,
    );

    expect(createClient.mock.calls[0]?.[0]).toMatchObject({
      data: {
        nombre_normalizado: 'ana cliente',
        documento_normalizado: '12345678',
        organizacion_id: organizationId,
      },
    });
    expect(result.id).toBe(clientId);
    expect(auditedEvents[0]).toMatchObject({
      action: CLIENT_AUDIT_ACTIONS.CREATED,
      entity: 'clientes',
      entityId: clientId,
      actorId: actor.id,
      metadata: {
        organizationId,
        hasDocument: true,
        hasEmail: true,
        hasPhone: true,
      },
    });
    expect(JSON.stringify(auditedEvents[0])).not.toContain('12.345.678');
    expect(JSON.stringify(auditedEvents[0])).not.toContain('ana@example.com');
  });

  it('requires document type and number as a pair', async () => {
    await expect(
      service.create(
        {
          fullName: 'Ana Cliente',
          documentType: 'DNI',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(executeAudit).not.toHaveBeenCalled();
  });

  it('allows a global actor to create for another active organization', async () => {
    const globalActor = { ...actor, globalAccess: true };
    const otherClient = {
      ...client,
      organizacion_id: otherOrganizationId,
      organizaciones: {
        ...client.organizaciones,
        id: otherOrganizationId,
      },
    };
    findOrganization.mockResolvedValue({ id: otherOrganizationId });
    createClient.mockResolvedValue(otherClient);

    await service.create(
      {
        fullName: 'Cliente Franquicia',
        organizationId: otherOrganizationId,
      },
      globalActor,
    );

    expect(auditedEvents[0]).toMatchObject({
      organizationId,
      targetOrganizationId: otherOrganizationId,
    });
  });

  it('rejects organization selection for non-global actors', async () => {
    await expect(
      service.create(
        {
          fullName: 'Ana Cliente',
          organizationId,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('maps document unique violations to conflict without leaking details', async () => {
    findOrganization.mockResolvedValue({ id: organizationId });
    executeAudit.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate detail', {
        code: 'P2002',
        clientVersion: '6.12.0',
      }),
    );

    await expect(
      service.create(
        {
          fullName: 'Duplicado',
          documentType: 'DNI',
          documentNumber: '12345678',
        },
        actor,
      ),
    ).rejects.toEqual(
      new ConflictException(
        'A client with that document already exists in the organization',
      ),
    );
  });

  it('updates editable data and audits only presence metadata', async () => {
    const updated = {
      ...client,
      correo: null,
      telefono: '+54 11 4444-4444',
      actualizado_en: new Date('2026-08-29T11:00:00.000Z'),
    };
    findClient.mockResolvedValue(client);
    updateClient.mockResolvedValue(updated);

    const result = await service.update(
      clientId,
      { email: null, phone: '+54 11 4444-4444' },
      actor,
    );

    expect(lockClient).toHaveBeenCalledTimes(1);
    expect(updateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id_organizacion_id: { id: clientId, organizacion_id: organizationId },
        },
        data: {
          correo: null,
          telefono: '+54 11 4444-4444',
        },
      }),
    );
    expect(result.email).toBeNull();
    expect(auditedEvents[0]).toMatchObject({
      action: CLIENT_AUDIT_ACTIONS.UPDATED,
      previousData: {
        changedFields: ['phone', 'email'],
        hasEmail: true,
      },
      metadata: {
        changedFields: ['phone', 'email'],
        hasEmail: false,
      },
    });
    expect(JSON.stringify(auditedEvents[0])).not.toContain('+54 11 4444-4444');
  });

  it('clears documents only when both fields are explicitly null', async () => {
    findClient.mockResolvedValue(client);
    updateClient.mockResolvedValue({
      ...client,
      tipo_documento: null,
      numero_documento: null,
    });

    await service.update(
      clientId,
      { documentType: null, documentNumber: null },
      actor,
    );

    expect(updateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          tipo_documento: null,
          numero_documento: null,
          documento_normalizado: null,
        },
      }),
    );
  });

  it('rejects empty updates and partial document updates', async () => {
    await expect(service.update(clientId, {}, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.update(clientId, { documentNumber: '12345678' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(executeAudit).not.toHaveBeenCalled();
  });

  it('rejects update no-ops inside the audited transaction', async () => {
    findClient.mockResolvedValue(client);

    await expect(
      service.update(clientId, { email: client.correo }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateClient).not.toHaveBeenCalled();
  });

  it('deactivates without deleting and records previous and new status', async () => {
    const inactive = { ...client, activo: false };
    findClient.mockResolvedValue(client);
    updateClient.mockResolvedValue(inactive);

    const result = await service.updateStatus(
      clientId,
      { active: false },
      actor,
    );

    expect(updateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { activo: false },
      }),
    );
    expect(result.active).toBe(false);
    expect(auditedEvents[0]).toMatchObject({
      action: CLIENT_AUDIT_ACTIONS.STATUS_UPDATED,
      previousData: { active: true },
      metadata: { active: false },
    });
  });

  it('rejects status no-ops without creating an audit record', async () => {
    findClient.mockResolvedValue(client);

    await expect(
      service.updateStatus(clientId, { active: true }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateClient).not.toHaveBeenCalled();
  });
});

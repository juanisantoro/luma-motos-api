import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const createAuditLog = jest.fn<
    Promise<unknown>,
    [Prisma.registros_auditoriaCreateArgs]
  >();
  const countAuditLogs = jest.fn<
    Promise<number>,
    [Prisma.registros_auditoriaCountArgs]
  >();
  const findAuditLogs = jest.fn<
    Promise<never[]>,
    [Prisma.registros_auditoriaFindManyArgs]
  >();
  const updateUser = jest.fn();
  const withTenant = jest.fn();
  let service: AuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    const transactionClient = {
      registros_auditoria: {
        create: createAuditLog,
        count: countAuditLogs,
        findMany: findAuditLogs,
      },
      usuarios: { update: updateUser },
    } as unknown as Prisma.TransactionClient;
    withTenant.mockImplementation(
      (
        _scope: unknown,
        operation: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => operation(transactionClient),
    );
    service = new AuditService({
      withTenant,
    } as unknown as PrismaService);
  });

  it('writes the business mutation and actor audit in one transaction', async () => {
    updateUser.mockResolvedValue({ id: 'user-id' });
    createAuditLog.mockResolvedValue({ id: 'audit-id' });

    await service.execute(
      {
        action: 'USER_UPDATED',
        entity: 'User',
        entityId: 'user-id',
        actorId: 'actor-id',
        organizationId: 'organization-id',
        globalAccess: false,
      },
      async (client) =>
        client.usuarios.update({
          where: { id: 'user-id' },
          data: { activo: false },
        }),
    );

    expect(withTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'organization-id',
        globalAccess: false,
      }),
      expect.any(Function),
    );
    expect(updateUser).toHaveBeenCalled();
    expect(createAuditLog.mock.calls[0]?.[0].data).toMatchObject({
      accion: 'USER_UPDATED',
      entidad: 'User',
      entidad_id: 'user-id',
      usuario_id: 'actor-id',
      organizacion_id: 'organization-id',
    });
  });

  it('does not duplicate audit records for an idempotent replay', async () => {
    const event = {
      action: 'PAYMENT_RECORDED',
      entity: 'payment',
      actorId: 'actor-id',
      organizationId: 'organization-id',
      globalAccess: false,
      skipRecord: false,
    };

    await service.execute(event, () => {
      event.skipRecord = true;
      return Promise.resolve({ replayed: true });
    });

    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('restricts audit queries to the caller organization', async () => {
    countAuditLogs.mockResolvedValue(0);
    findAuditLogs.mockResolvedValue([]);

    await service.findAll(
      { page: 1, limit: 50 },
      {
        organizationId: 'franchise-id',
        globalAccess: false,
      },
    );

    const tenantScope = {
      OR: [
        { organizacion_id: 'franchise-id' },
        { organizacion_objetivo_id: 'franchise-id' },
      ],
    };
    expect(countAuditLogs.mock.calls[0]?.[0].where).toMatchObject(tenantScope);
    expect(findAuditLogs.mock.calls[0]?.[0].where).toMatchObject(tenantScope);
  });
});

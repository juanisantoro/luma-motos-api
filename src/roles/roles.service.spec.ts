import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { RolesService } from './roles.service';

describe('RolesService', () => {
  const actor: AuthenticatedUser = {
    id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
    email: 'admin@luma.test',
    name: 'Luma Admin',
    active: true,
    globalAccess: true,
    organization: {
      id: '8fa94171-13b3-40b5-8c33-1f7d8ea94c75',
      code: 'LUMA_CENTRAL',
      name: 'Luma Motos Casa Central',
      type: 'CASA_CENTRAL',
    },
    role: {
      id: '4bd1189b-2bb1-4258-889b-4500de5eeade',
      code: 'ADMINISTRADOR',
      name: 'Administrador',
      system: true,
      permissions: ['roles.consultar', 'roles.gestionar'],
    },
    branch: null,
  };
  const customRole = {
    id: '65aac728-d42b-4daf-9dc3-7af575eb328a',
    codigo: 'SUPERVISOR_VENTAS',
    nombre: 'Supervisor de ventas',
    descripcion: 'Supervisa las ventas de la organización.',
    activo: true,
    es_sistema: false,
    version: 1,
    organizacion_id: actor.organization.id,
    creado_en: new Date('2026-08-29T10:00:00.000Z'),
    actualizado_en: new Date('2026-08-29T10:00:00.000Z'),
    organizaciones: {
      id: actor.organization.id,
      codigo: actor.organization.code,
      nombre: actor.organization.name,
      tipo: actor.organization.type,
    },
    permisos_rol: [
      {
        permisos: {
          codigo: 'ventas.consultar',
          modulo: 'ventas',
          descripcion: 'Consulta operaciones.',
        },
      },
    ],
    _count: { usuarios: 0 },
  } as const;

  const findRole = jest.fn<Promise<unknown>, [Prisma.RoleFindFirstArgs]>();
  const createRole = jest.fn<Promise<unknown>, [Prisma.RoleCreateArgs]>();
  const updateRoles = jest.fn();
  const findRoleOrThrow = jest.fn();
  const findPermissions = jest.fn();
  const findOrganization = jest.fn();
  const deleteRolePermissions = jest.fn();
  const createRolePermissions = jest.fn();
  const findUsers = jest.fn();
  const updateSessions = jest.fn<
    Promise<Prisma.BatchPayload>,
    [Prisma.AuthSessionUpdateManyArgs]
  >();
  const execute = jest.fn();
  const record = jest.fn();
  let service: RolesService;

  beforeEach(() => {
    jest.clearAllMocks();
    findRole.mockResolvedValue(null);
    createRole.mockResolvedValue(customRole);
    findRoleOrThrow.mockResolvedValue(customRole);
    findPermissions.mockResolvedValue([
      { codigo: 'ventas.consultar' },
      { codigo: 'ventas.gestionar' },
    ]);
    findOrganization.mockResolvedValue({ id: actor.organization.id });
    updateRoles.mockResolvedValue({ count: 1 });
    deleteRolePermissions.mockResolvedValue({ count: 1 });
    createRolePermissions.mockResolvedValue({ count: 2 });
    findUsers.mockResolvedValue([
      { id: '62cc5cf4-301a-42fb-a0ef-932c1c180a20' },
    ]);
    updateSessions.mockResolvedValue({ count: 2 });
    const transaction = {
      role: {
        findFirst: findRole,
        create: createRole,
        updateMany: updateRoles,
        findUniqueOrThrow: findRoleOrThrow,
      },
      permisos: { findMany: findPermissions },
      permisos_rol: {
        deleteMany: deleteRolePermissions,
        createMany: createRolePermissions,
      },
      organizaciones: { findFirst: findOrganization },
      usuarios: { findMany: findUsers },
      authSession: { updateMany: updateSessions },
    } as unknown as Prisma.TransactionClient;
    execute.mockImplementation(
      (
        _event: unknown,
        operation: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => operation(transaction),
    );
    service = new RolesService(
      {
        withTenant: (
          _scope: unknown,
          operation: (client: Prisma.TransactionClient) => Promise<unknown>,
        ) => operation(transaction),
      } as unknown as PrismaService,
      { execute, record } as unknown as AuditService,
    );
  });

  it('creates a tenant role from valid catalog permissions', async () => {
    const result = await service.create(
      {
        name: customRole.nombre,
        code: customRole.codigo,
        description: customRole.descripcion,
        permissionCodes: ['ventas.consultar'],
        organizationId: actor.organization.id,
      },
      actor,
    );

    expect(createRole.mock.calls[0]?.[0].data).toMatchObject({
      codigo: customRole.codigo,
      organizacion_id: actor.organization.id,
      es_sistema: false,
    });
    expect(
      createRole.mock.calls[0]?.[0].data.permisos_rol.createMany.data,
    ).toEqual([{ codigo_permiso: 'ventas.consultar' }]);
    expect(result).toMatchObject({
      code: customRole.codigo,
      system: false,
      organization: { id: actor.organization.id },
    });
  });

  it('rejects permission codes outside the catalog', async () => {
    findPermissions.mockResolvedValue([]);

    await expect(
      service.create(
        {
          name: customRole.nombre,
          code: customRole.codigo,
          description: customRole.descripcion,
          permissionCodes: ['inventado.gestionar'],
        },
        actor,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'INVALID_PERMISSION_CODES',
        details: { invalidCodes: ['inventado.gestionar'] },
      },
    });
    expect(createRole).not.toHaveBeenCalled();
  });

  it('revokes every role session when permissions change', async () => {
    findRole.mockResolvedValue(customRole);
    findRoleOrThrow.mockResolvedValue({
      ...customRole,
      version: 2,
      permisos_rol: [
        ...customRole.permisos_rol,
        {
          permisos: {
            codigo: 'ventas.gestionar',
            modulo: 'ventas',
            descripcion: 'Gestiona operaciones.',
          },
        },
      ],
    });

    const result = await service.update(
      customRole.id,
      {
        permissionCodes: ['ventas.consultar', 'ventas.gestionar'],
        version: 1,
      },
      actor,
    );

    expect(deleteRolePermissions).toHaveBeenCalledWith({
      where: { rol_id: customRole.id },
    });
    expect(updateSessions.mock.calls[0]?.[0].where).toMatchObject({
      revokedAt: null,
    });
    expect(result.revokedSessions).toBe(2);
  });

  it('requires reassigning users before role deactivation', async () => {
    findRole.mockResolvedValue({
      ...customRole,
      _count: { usuarios: 3 },
    });

    await expect(
      service.updateStatus(customRole.id, { active: false, version: 1 }, actor),
    ).rejects.toMatchObject({
      response: {
        code: 'ROLE_HAS_ACTIVE_USERS',
        details: { userCount: 3 },
      },
    });
    expect(updateRoles).not.toHaveBeenCalled();
  });

  it('does not expose another tenant custom role', async () => {
    const tenantActor = { ...actor, globalAccess: false };
    findRole.mockResolvedValue(null);

    await expect(
      service.findOne(customRole.id, tenantActor),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(findRole.mock.calls[0]?.[0].where.OR).toContainEqual({
      es_sistema: false,
      organizacion_id: actor.organization.id,
    });
  });

  it('keeps mandatory administration permissions on the base administrator role', async () => {
    findRole.mockResolvedValue({
      ...customRole,
      codigo: 'ADMINISTRADOR',
      nombre: 'Administrador',
      es_sistema: true,
      organizacion_id: null,
      organizaciones: null,
      permisos_rol: [
        {
          permisos: {
            codigo: 'usuarios.consultar',
            modulo: 'usuarios',
            descripcion: 'Consulta usuarios.',
          },
        },
        {
          permisos: {
            codigo: 'usuarios.gestionar',
            modulo: 'usuarios',
            descripcion: 'Gestiona usuarios.',
          },
        },
        {
          permisos: {
            codigo: 'roles.consultar',
            modulo: 'roles',
            descripcion: 'Consulta roles.',
          },
        },
        {
          permisos: {
            codigo: 'roles.gestionar',
            modulo: 'roles',
            descripcion: 'Gestiona roles.',
          },
        },
      ],
    });

    await expect(
      service.update(
        customRole.id,
        {
          permissionCodes: ['usuarios.consultar'],
          version: 1,
        },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'SYSTEM_ROLE_PROTECTED' },
    });
    expect(updateRoles).not.toHaveBeenCalled();
  });
});

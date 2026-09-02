import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  AuditService,
  type AuditEvent,
  type AuthenticatedAuditEvent,
} from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { hashPassword } from '../auth/password-hashing';
import { EnvironmentVariables } from '../config/environment';
import { MailService, type TemporaryPasswordEmail } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { USER_AUDIT_ACTIONS } from './users.constants';
import { UsersService } from './users.service';

jest.mock('../auth/password-hashing', () => ({
  hashPassword: jest.fn(),
}));

describe('UsersService', () => {
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
      permissions: ['usuarios.consultar', 'usuarios.gestionar'],
    },
    branch: null,
  };
  const targetUser = {
    id: '7d5cc401-544e-4651-9bd6-52495887fecd',
    correo: 'seller@luma.test',
    activo: true,
    acceso_global: false,
    creado_en: new Date('2026-08-29T00:00:00.000Z'),
    actualizado_en: new Date('2026-08-29T00:00:00.000Z'),
    ultimo_inicio_sesion_en: null,
    contrasena_configurada_en: null,
    contrasena_temporal_vence_en: new Date('2026-08-30T00:00:00.000Z'),
    estado_invitacion: 'DELIVERED',
    invitacion_ultimo_intento_en: new Date('2026-08-29T00:00:00.000Z'),
    invitacion_enviada_en: new Date('2026-08-29T00:00:00.000Z'),
    invitacion_aceptada_en: null,
    invitacion_error: null,
    invitacion_version: 1,
    organizacion_id: actor.organization.id,
    organizaciones: {
      id: actor.organization.id,
      codigo: actor.organization.code,
      nombre: actor.organization.name,
      tipo: actor.organization.type,
      activa: true,
    },
    roles: {
      id: '4bd1189b-2bb1-4258-889b-4500de5eeade',
      codigo: 'VENDEDOR',
      nombre: 'Vendedor',
      activo: true,
      es_sistema: true,
      version: 1,
      permisos_rol: [{ codigo_permiso: 'stock.consultar' }],
    },
    sucursales: {
      id: 'bb5a44e1-7da1-4fc7-acd2-e7c78be98785',
      codigo: 'SAN_MIGUEL',
      nombre: 'San Miguel',
      activa: true,
    },
    personal: {
      id: '4a2501a4-b00c-4559-9d27-ac78c2018d91',
      codigo_empleado: null,
      nombre_completo: 'Luma Seller',
      telefono: null,
      puede_iniciar_sesion: true,
      estado: 'ACTIVO',
    },
  } as const;

  const createUser = jest.fn<Promise<unknown>, [Prisma.usuariosCreateArgs]>();
  const createPersonnel = jest.fn();
  const createBranchAccess = jest.fn();
  const findUser = jest.fn();
  const countUsers = jest.fn();
  const findUserOrThrow = jest.fn();
  const updateUser = jest.fn<Promise<unknown>, [Prisma.usuariosUpdateArgs]>();
  const updateUsers = jest.fn<
    Promise<Prisma.BatchPayload>,
    [Prisma.usuariosUpdateManyArgs]
  >();
  const updatePersonnel = jest.fn();
  const deleteBranchAccess = jest.fn();
  const updateSessions = jest.fn<
    Promise<Prisma.BatchPayload>,
    [Prisma.AuthSessionUpdateManyArgs]
  >();
  const findOrganization = jest.fn();
  const findRole = jest.fn<Promise<unknown>, [Prisma.RoleFindFirstArgs]>();
  const findBranch = jest.fn();
  const executeAudit = jest.fn();
  const recordAudit = jest.fn();
  const sendTemporaryPassword = jest.fn<
    Promise<void>,
    [TemporaryPasswordEmail]
  >();
  const withTenant = jest.fn();
  const advisoryLock = jest.fn();
  const mockedHash = jest.mocked(hashPassword);
  let auditedEvents: AuditEvent[];
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    auditedEvents = [];
    const transaction = {
      $queryRaw: advisoryLock,
      $executeRaw: advisoryLock,
      usuarios: {
        count: countUsers,
        create: createUser,
        findFirst: findUser,
        findUniqueOrThrow: findUserOrThrow,
        update: updateUser,
        updateMany: updateUsers,
      },
      personal: {
        create: createPersonnel,
        update: updatePersonnel,
      },
      acceso_personal_sucursal: {
        create: createBranchAccess,
        deleteMany: deleteBranchAccess,
      },
      authSession: {
        updateMany: updateSessions,
      },
      organizaciones: {
        findFirst: findOrganization,
      },
      role: {
        findFirst: findRole,
      },
      sucursales: {
        findFirst: findBranch,
      },
    } as unknown as Prisma.TransactionClient;

    executeAudit.mockImplementation(
      (
        event: AuthenticatedAuditEvent,
        operation: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => {
        auditedEvents.push(event);
        return operation(transaction);
      },
    );
    recordAudit.mockImplementation((event: AuditEvent) => {
      auditedEvents.push(event);
      return Promise.resolve();
    });
    mockedHash.mockResolvedValue('temporary-argon-hash');
    sendTemporaryPassword.mockResolvedValue();
    updateUsers.mockResolvedValue({ count: 1 });
    countUsers.mockResolvedValue(1);
    advisoryLock.mockResolvedValue([{ locked: true }]);
    withTenant.mockImplementation(
      (
        _scope: unknown,
        operation: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => operation(transaction),
    );
    service = new UsersService(
      { withTenant } as unknown as PrismaService,
      {
        execute: executeAudit,
        record: recordAudit,
      } as unknown as AuditService,
      { sendTemporaryPassword } as unknown as MailService,
      {
        get: jest.fn().mockReturnValue(86_400),
      } as unknown as ConfigService<EnvironmentVariables, true>,
    );
  });

  it('creates a user with a temporary password delivered only by email', async () => {
    createUser.mockResolvedValue({ id: targetUser.id });
    createPersonnel.mockResolvedValue({ id: targetUser.personal.id });
    createBranchAccess.mockResolvedValue({});
    findOrganization.mockResolvedValue({
      id: actor.organization.id,
      tipo: 'CASA_CENTRAL',
    });
    findRole.mockResolvedValue({
      id: targetUser.roles.id,
      codigo: targetUser.roles.codigo,
    });
    findBranch.mockResolvedValue({ id: targetUser.sucursales.id });
    findUserOrThrow.mockResolvedValue(targetUser);
    updateUsers.mockResolvedValue({ count: 1 });

    const result = await service.create(
      {
        email: targetUser.correo,
        fullName: targetUser.personal.nombre_completo,
        organizationId: actor.organization.id,
        branchId: targetUser.sucursales.id,
        roleCode: targetUser.roles.codigo,
        globalAccess: false,
      },
      actor,
    );

    expect(createUser.mock.calls[0]?.[0].data).toMatchObject({
      activo: true,
      hash_contrasena: 'temporary-argon-hash',
      organizacion_id: actor.organization.id,
    });
    const roleWhere = findRole.mock.calls[0]?.[0].where;
    expect(roleWhere).toMatchObject({
      codigo: targetUser.roles.codigo,
      activo: true,
    });
    expect(roleWhere?.OR).toContainEqual({
      es_sistema: false,
      organizacion_id: actor.organization.id,
    });
    const email = sendTemporaryPassword.mock.calls[0]?.[0];
    expect(email?.temporaryPassword).toHaveLength(24);
    expect(result.delivery.status).toBe('DELIVERED');
    expect(auditedEvents[0]).toMatchObject({
      action: USER_AUDIT_ACTIONS.CREATED,
      actorId: actor.id,
      entityId: targetUser.id,
    });
    expect(JSON.stringify(auditedEvents)).not.toContain(
      email?.temporaryPassword,
    );
  });

  it('revokes every active session when role or branch access changes', async () => {
    const activeTarget = {
      ...targetUser,
      activo: true,
      contrasena_configurada_en: new Date('2026-08-29T00:00:00.000Z'),
      personal: {
        ...targetUser.personal,
        puede_iniciar_sesion: true,
        estado: 'ACTIVO' as const,
      },
    };
    const updatedTarget = {
      ...activeTarget,
      roles: {
        ...targetUser.roles,
        codigo: 'ADMINISTRATIVA',
        nombre: 'Administrativa',
      },
      sucursales: null,
    };
    findUser.mockResolvedValue(activeTarget);
    findRole.mockResolvedValue({
      id: targetUser.roles.id,
      codigo: 'ADMINISTRATIVA',
    });

    findOrganization.mockResolvedValue({
      id: actor.organization.id,
      tipo: 'CASA_CENTRAL',
    });

    updatePersonnel.mockResolvedValue({ id: targetUser.personal.id });
    deleteBranchAccess.mockResolvedValue({ count: 1 });
    updateSessions.mockResolvedValue({ count: 2 });
    findUserOrThrow.mockResolvedValue(updatedTarget);

    const result = await service.updateAccess(
      targetUser.id,
      {
        roleCode: 'ADMINISTRATIVA',
        branchId: null,
      },
      actor,
    );

    expect(updateSessions.mock.calls[0]?.[0]).toMatchObject({
      where: {
        userId: targetUser.id,
        revokedAt: null,
      },
    });
    expect(updateSessions.mock.calls[0]?.[0].data.revokedAt).toBeInstanceOf(
      Date,
    );
    expect(result.revokedSessions).toBe(2);
    expect(auditedEvents[0]).toMatchObject({
      action: USER_AUDIT_ACTIONS.ACCESS_UPDATED,
      previousData: {
        roleCode: 'VENDEDOR',
        branchId: targetUser.sucursales.id,
        globalAccess: false,
      },
      metadata: {
        roleCode: 'ADMINISTRATIVA',
        branchId: null,
        globalAccess: false,
      },
    });
  });

  it('does not reactivate a user before password setup', async () => {
    findUser.mockResolvedValue({
      ...targetUser,
      activo: false,
      personal: {
        ...targetUser.personal,
        puede_iniciar_sesion: false,
        estado: 'INACTIVO',
      },
    });

    await expect(
      service.updateStatus(targetUser.id, { active: true }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(executeAudit).not.toHaveBeenCalled();
  });

  it('prevents non-global administrators from creating cross-tenant users', async () => {
    const franchiseActor: AuthenticatedUser = {
      ...actor,
      globalAccess: false,
      organization: {
        ...actor.organization,
        id: 'd04022ad-80a9-4a9e-bccc-227a2cc98d47',
        code: 'FRANQUICIA_NORTE',
        name: 'Franquicia Norte',
        type: 'FRANQUICIA',
      },
    };

    await expect(
      service.create(
        {
          email: targetUser.correo,
          fullName: targetUser.personal.nombre_completo,
          organizationId: actor.organization.id,
          roleCode: targetUser.roles.codigo,
          globalAccess: false,
        },
        franchiseActor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'CROSS_TENANT_ACCESS' },
    });
    expect(executeAudit).not.toHaveBeenCalled();
  });

  it('persists a failed invitation attempt and does not return success', async () => {
    createUser.mockResolvedValue({ id: targetUser.id });
    createPersonnel.mockResolvedValue({ id: targetUser.personal.id });
    findOrganization.mockResolvedValue({
      id: actor.organization.id,
      tipo: 'CASA_CENTRAL',
    });
    findRole.mockResolvedValue({
      id: targetUser.roles.id,
      codigo: targetUser.roles.codigo,
    });
    findUserOrThrow.mockResolvedValue(targetUser);
    sendTemporaryPassword.mockRejectedValue(new Error('smtp unavailable'));

    await expect(
      service.create(
        {
          email: targetUser.correo,
          fullName: targetUser.personal.nombre_completo,
          organizationId: actor.organization.id,
          roleCode: targetUser.roles.codigo,
          globalAccess: false,
        },
        actor,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'INVITATION_DELIVERY_FAILED',
        message:
          'The user was created, but the invitation email could not be delivered',
        details: {
          userId: targetUser.id,
          persisted: true,
          invitationStatus: 'FAILED',
          retryEndpoint: `/api/users/${targetUser.id}/invitation/resend`,
        },
      },
    });
    expect(updateUsers.mock.calls[0]?.[0].data).toMatchObject({
      estado_invitacion: 'FAILED',
      invitacion_error: 'SMTP_DELIVERY_FAILED: smtp unavailable',
    });
    expect(JSON.stringify(auditedEvents)).not.toContain('temporary-argon-hash');
  });

  it('regenerates an invitation, revokes sessions and returns no password', async () => {
    findUser.mockResolvedValue(targetUser);
    findUserOrThrow.mockResolvedValue(targetUser);
    updateSessions.mockResolvedValue({ count: 2 });

    const result = await service.resetTemporaryPassword(targetUser.id, actor);

    expect(updateUser.mock.calls[0]?.[0].data).toMatchObject({
      hash_contrasena: 'temporary-argon-hash',
      estado_invitacion: 'PENDING',
      invitacion_version: { increment: 1 },
    });
    expect(updateSessions).toHaveBeenCalled();
    expect(result.delivery.status).toBe('DELIVERED');
    const deliveredPassword =
      sendTemporaryPassword.mock.calls[0]?.[0].temporaryPassword;
    expect(deliveredPassword).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain(deliveredPassword);
  });

  it('does not report a stale invitation as failed', async () => {
    createUser.mockResolvedValue({ id: targetUser.id });
    createPersonnel.mockResolvedValue({ id: targetUser.personal.id });
    findOrganization.mockResolvedValue({
      id: actor.organization.id,
      tipo: 'CASA_CENTRAL',
    });
    findRole.mockResolvedValue({
      id: targetUser.roles.id,
      codigo: targetUser.roles.codigo,
    });
    findUserOrThrow.mockResolvedValue(targetUser);
    sendTemporaryPassword.mockRejectedValue(new Error('smtp unavailable'));
    updateUsers.mockResolvedValue({ count: 0 });

    await expect(
      service.create(
        {
          email: targetUser.correo,
          fullName: targetUser.personal.nombre_completo,
          organizationId: actor.organization.id,
          roleCode: targetUser.roles.codigo,
          globalAccess: false,
        },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
  });

  it('does not reset the last active administrator credentials', async () => {
    findUser.mockResolvedValue({
      ...targetUser,
      contrasena_configurada_en: new Date('2026-08-29T00:00:00.000Z'),
      roles: {
        ...targetUser.roles,
        codigo: 'ADMINISTRADOR',
        nombre: 'Administrador',
      },
    });
    countUsers.mockResolvedValue(0);

    await expect(
      service.resetTemporaryPassword(targetUser.id, actor),
    ).rejects.toMatchObject({
      response: { code: 'LAST_ACTIVE_ADMIN' },
    });
    expect(updateUser).not.toHaveBeenCalled();
    expect(sendTemporaryPassword).not.toHaveBeenCalled();
  });
});

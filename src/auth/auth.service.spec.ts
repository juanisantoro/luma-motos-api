import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import {
  AuditEvent,
  AuditService,
  AuthenticatedAuditEvent,
} from '../audit/audit.service';
import { EnvironmentVariables } from '../config/environment';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ACTIONS } from './auth.constants';
import { AuthService } from './auth.service';
import { hashPassword, verifyPassword } from './password-hashing';

jest.mock('./password-hashing', () => ({
  DUMMY_PASSWORD_HASH: '$argon2id$v=19$m=19456,p=1,t=2$dummy-salt$dummy-hash',
  hashPassword: jest.fn(),
  verifyPassword: jest.fn(),
}));

describe('AuthService', () => {
  const findOrganization = jest.fn();
  const findUser = jest.fn();
  const updateUser = jest.fn<Promise<unknown>, [Prisma.usuariosUpdateArgs]>();
  const createSession = jest.fn();
  const updateSessions = jest.fn<
    Promise<Prisma.BatchPayload>,
    [Prisma.AuthSessionUpdateManyArgs]
  >();
  const updateUsers = jest.fn<
    Promise<Prisma.BatchPayload>,
    [Prisma.usuariosUpdateManyArgs]
  >();
  const signAsync = jest.fn();
  const execute = jest.fn();
  const record = jest.fn<
    ReturnType<AuditService['record']>,
    Parameters<AuditService['record']>
  >();
  const mockedVerify = jest.mocked(verifyPassword);
  const mockedHash = jest.mocked(hashPassword);
  let recordedEvents: AuditEvent[];
  let service: AuthService;

  const databaseUser = {
    id: 'd16c3c21-8d15-4bc9-a282-7ba4c9a0cc31',
    correo: 'admin@luma.test',
    hash_contrasena: 'argon-hash',
    activo: true,
    contrasena_configurada_en: new Date('2026-08-29T00:00:00.000Z'),
    acceso_global: true,
    organizacion_id: '8fa94171-13b3-40b5-8c33-1f7d8ea94c75',
    organizaciones: {
      id: '8fa94171-13b3-40b5-8c33-1f7d8ea94c75',
      codigo: 'LUMA_CENTRAL',
      nombre: 'Luma Motos Casa Central',
      tipo: 'CASA_CENTRAL',
      activa: true,
    },
    personal: {
      nombre_completo: 'Luma Admin',
      puede_iniciar_sesion: true,
      estado: 'ACTIVO',
    },
    roles: {
      codigo: 'ADMINISTRADOR',
      nombre: 'Administrador',
      activo: true,
      permisos_rol: [
        { codigo_permiso: 'usuarios.consultar' },
        { codigo_permiso: 'usuarios.gestionar' },
      ],
    },
    sucursales: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findOrganization.mockResolvedValue({
      id: databaseUser.organizacion_id,
      activa: true,
    });
    recordedEvents = [];
    record.mockImplementation((event) => {
      recordedEvents.push(event);
      return Promise.resolve();
    });
    createSession.mockResolvedValue({
      id: '7f62fcf8-9934-4105-8765-e92b37ce9899',
    });
    updateSessions.mockResolvedValue({ count: 1 });
    const transactionClient = {
      usuarios: {
        findFirst: findUser,
        update: updateUser,
        updateMany: updateUsers,
      },
      authSession: {
        create: createSession,
        updateMany: updateSessions,
      },
    } as unknown as Prisma.TransactionClient;
    execute.mockImplementation(
      (
        event: AuthenticatedAuditEvent,
        operation: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => {
        recordedEvents.push(event);
        return operation(transactionClient);
      },
    );

    service = new AuthService(
      {
        organizaciones: { findUnique: findOrganization },
        withTenant: (
          _scope: unknown,
          operation: (client: Prisma.TransactionClient) => Promise<unknown>,
        ) => operation(transactionClient),
      } as unknown as PrismaService,
      { signAsync } as unknown as JwtService,
      { execute, record } as unknown as AuditService,
      {
        get: jest.fn().mockReturnValue(3600),
      } as unknown as ConfigService<EnvironmentVariables, true>,
    );
  });

  it('creates a sliding session token and returns a safe user projection', async () => {
    findUser.mockResolvedValue(databaseUser);
    mockedVerify.mockResolvedValue(true);
    signAsync.mockResolvedValue('signed-access-token');

    const result = await service.login({
      organizationCode: 'LUMA_CENTRAL',
      email: databaseUser.correo,
      password: 'a-valid-password',
    });

    expect(result).toEqual({
      accessToken: 'signed-access-token',
      tokenType: 'Bearer',
      idleTimeoutSeconds: 3600,
      user: {
        id: databaseUser.id,
        email: databaseUser.correo,
        name: databaseUser.personal.nombre_completo,
        active: true,
        globalAccess: true,
        organization: {
          id: databaseUser.organizaciones.id,
          code: databaseUser.organizaciones.codigo,
          name: databaseUser.organizaciones.nombre,
          type: databaseUser.organizaciones.tipo,
        },
        role: {
          code: databaseUser.roles.codigo,
          name: databaseUser.roles.nombre,
          permissions: ['usuarios.consultar', 'usuarios.gestionar'],
        },
        branch: null,
      },
    });
    expect(signAsync).toHaveBeenCalledWith({
      sub: databaseUser.id,
      sid: '7f62fcf8-9934-4105-8765-e92b37ce9899',
      oid: databaseUser.organizacion_id,
      type: 'access',
    });
    expect(recordedEvents[0]).toMatchObject({
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      actorId: databaseUser.id,
    });
  });

  it('replaces valid temporary credentials with the user password', async () => {
    findUser.mockResolvedValue({
      id: databaseUser.id,
      hash_contrasena: 'temporary-argon-hash',
    });
    mockedVerify.mockResolvedValue(true);
    mockedHash.mockResolvedValue('new-argon-hash');
    updateUsers.mockResolvedValue({ count: 1 });
    updateSessions.mockResolvedValue({ count: 0 });

    await service.changeTemporaryPassword({
      organizationCode: 'LUMA_CENTRAL',
      email: databaseUser.correo,
      temporaryPassword: 'temporary-password',
      newPassword: 'a-new-secure-password',
    });

    expect(updateUsers.mock.calls[0]?.[0].data).toMatchObject({
      hash_contrasena: 'new-argon-hash',
      contrasena_temporal_vence_en: null,
    });
    expect(recordedEvents[0]).toMatchObject({
      action: AUDIT_ACTIONS.TEMPORARY_PASSWORD_CHANGED,
      actorId: databaseUser.id,
      entityId: databaseUser.id,
    });
  });

  it('audits rejected temporary credentials without storing them', async () => {
    findUser.mockResolvedValue(null);
    mockedVerify.mockResolvedValue(false);
    const temporaryPassword = 'invalid-temporary-password';

    await expect(
      service.changeTemporaryPassword({
        organizationCode: 'LUMA_CENTRAL',
        email: databaseUser.correo,
        temporaryPassword,
        newPassword: 'a-new-secure-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(recordedEvents[0]).toMatchObject({
      action: AUDIT_ACTIONS.TEMPORARY_PASSWORD_CHANGE_FAILED,
      metadata: {
        reason: 'invalid_or_expired_temporary_credentials',
      },
    });
    expect(JSON.stringify(recordedEvents[0])).not.toContain(temporaryPassword);
  });

  it('uses the same public error for unknown credentials and audits the attempt', async () => {
    findUser.mockResolvedValue(null);
    mockedVerify.mockResolvedValue(false);

    const login = service.login({
      organizationCode: 'LUMA_CENTRAL',
      email: 'unknown@luma.test',
      password: 'incorrect-password',
    });

    await expect(login).rejects.toEqual(
      new UnauthorizedException('Invalid email or password'),
    );
    expect(mockedVerify).toHaveBeenCalledWith(
      expect.stringContaining('$argon2id$'),
      'incorrect-password',
    );
    expect(recordedEvents[0]).toMatchObject({
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      metadata: { reason: 'invalid_credentials' },
    });
    expect(recordedEvents[0]).not.toHaveProperty('actorId');
  });

  it('rejects inactive users even when their password is valid', async () => {
    findUser.mockResolvedValue({ ...databaseUser, activo: false });
    mockedVerify.mockResolvedValue(true);

    await expect(
      service.login({
        organizationCode: 'LUMA_CENTRAL',
        email: databaseUser.correo,
        password: 'a-valid-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('rejects personnel without login permission', async () => {
    findUser.mockResolvedValue({
      ...databaseUser,
      personal: {
        ...databaseUser.personal,
        puede_iniciar_sesion: false,
      },
    });
    mockedVerify.mockResolvedValue(true);

    await expect(
      service.login({
        organizationCode: 'LUMA_CENTRAL',
        email: databaseUser.correo,
        password: 'a-valid-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('does not attribute a failed password attempt to its target user', async () => {
    findUser.mockResolvedValue(databaseUser);
    mockedVerify.mockResolvedValue(false);

    await expect(
      service.login({
        organizationCode: 'LUMA_CENTRAL',
        email: databaseUser.correo,
        password: 'incorrect-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(recordedEvents[0]).toMatchObject({
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityId: databaseUser.id,
    });
    expect(recordedEvents[0]).not.toHaveProperty('actorId');
  });

  it('revokes the current session and audits logout', async () => {
    await service.logout('7f62fcf8-9934-4105-8765-e92b37ce9899', {
      id: databaseUser.id,
      email: databaseUser.correo,
      name: databaseUser.personal.nombre_completo,
      active: true,
      globalAccess: true,
      organization: {
        id: databaseUser.organizaciones.id,
        code: databaseUser.organizaciones.codigo,
        name: databaseUser.organizaciones.nombre,
        type: 'CASA_CENTRAL',
      },
      role: {
        code: databaseUser.roles.codigo,
        name: databaseUser.roles.nombre,
        permissions: ['usuarios.consultar'],
      },
      branch: null,
    });

    const logoutUpdate = updateSessions.mock.calls[0]?.[0];
    expect(logoutUpdate?.where).toEqual({
      id: '7f62fcf8-9934-4105-8765-e92b37ce9899',
      userId: databaseUser.id,
      revokedAt: null,
    });
    expect(logoutUpdate?.data.revokedAt).toBeInstanceOf(Date);
    expect(recordedEvents[0]).toMatchObject({
      action: AUDIT_ACTIONS.LOGOUT,
      actorId: databaseUser.id,
    });
  });
});

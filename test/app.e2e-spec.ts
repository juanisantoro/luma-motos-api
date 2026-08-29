import {
  Controller,
  Get,
  INestApplication,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { ROLE_CODES } from './../src/auth/auth.constants';
import { Permissions } from './../src/auth/decorators/permissions.decorator';
import { Roles } from './../src/auth/decorators/roles.decorator';
import { PrismaService } from './../src/prisma/prisma.service';
import { UsersService } from './../src/users/users.service';

@Controller('authorization-test')
class AuthorizationTestController {
  @Get('role')
  @Roles(ROLE_CODES.ADMINISTRADOR)
  role(): string {
    return 'allowed';
  }

  @Get('permission')
  @Permissions('usuarios.gestionar')
  permission(): string {
    return 'allowed';
  }

  @Post('unaudited')
  unaudited(): string {
    return 'must not run';
  }
}

describe('Application security (e2e)', () => {
  const findUnique = jest.fn();
  const updateSessions = jest.fn<
    Promise<Prisma.BatchPayload>,
    [Prisma.AuthSessionUpdateManyArgs]
  >();
  const executeRaw = jest.fn();
  const createAuditLog = jest.fn();
  const countAuditLogs = jest.fn();
  const findAuditLogs = jest.fn();
  const withTenant = jest.fn();
  const findAllUsers = jest.fn();
  const createManagedUser = jest.fn();
  let app: INestApplication<App>;
  let jwtService: JwtService;

  const authenticatedUser = {
    id: 'd16c3c21-8d15-4bc9-a282-7ba4c9a0cc31',
    email: 'seller@luma.test',
    name: 'Luma Seller',
    active: true,
    globalAccess: false,
    organization: {
      id: '8fa94171-13b3-40b5-8c33-1f7d8ea94c75',
      code: 'LUMA_CENTRAL',
      name: 'Luma Motos Casa Central',
      type: 'CASA_CENTRAL' as const,
    },
    role: {
      code: ROLE_CODES.VENDEDOR,
      name: 'Vendedor',
      permissions: ['clientes.consultar'],
    },
    branch: null,
  };
  const databaseUser = {
    id: authenticatedUser.id,
    correo: authenticatedUser.email,
    activo: true,
    contrasena_configurada_en: new Date('2026-08-29T00:00:00.000Z'),
    acceso_global: false,
    organizaciones: {
      id: authenticatedUser.organization.id,
      codigo: authenticatedUser.organization.code,
      nombre: authenticatedUser.organization.name,
      tipo: authenticatedUser.organization.type,
      activa: true,
    },
    personal: {
      nombre_completo: authenticatedUser.name,
      puede_iniciar_sesion: true,
      estado: 'ACTIVO',
    },
    roles: {
      codigo: ROLE_CODES.VENDEDOR,
      nombre: 'Vendedor',
      activo: true,
      permisos_rol: [{ codigo_permiso: 'clientes.consultar' }],
    },
    sucursales: null,
  };

  beforeEach(async () => {
    findUnique.mockReset();
    findUnique.mockResolvedValue(databaseUser);
    updateSessions.mockReset();
    updateSessions.mockResolvedValue({ count: 1 });
    executeRaw.mockReset();
    executeRaw.mockResolvedValue(1);
    createAuditLog.mockReset();
    countAuditLogs.mockReset();
    countAuditLogs.mockResolvedValue(1);
    findAuditLogs.mockReset();
    findAuditLogs.mockResolvedValue([
      {
        id: 'audit-id',
        accion: 'AUTH_LOGIN_SUCCEEDED',
        entidad: 'usuarios',
        entidad_id: authenticatedUser.id,
        datos_nuevos: null,
        creado_en: new Date('2026-08-29T02:00:00.000Z'),
        organizacion_id: authenticatedUser.organization.id,
        organizaciones: {
          codigo: authenticatedUser.organization.code,
          nombre: authenticatedUser.organization.name,
          tipo: authenticatedUser.organization.type,
        },
        usuarios: {
          id: authenticatedUser.id,
          correo: authenticatedUser.email,
          personal: {
            nombre_completo: authenticatedUser.name,
          },
          sucursales: null,
        },
      },
    ]);
    findAllUsers.mockReset();
    findAllUsers.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 50,
    });
    createManagedUser.mockReset();
    createManagedUser.mockResolvedValue({
      user: { id: 'new-user-id' },
      delivery: { sent: true },
    });
    withTenant.mockReset();
    withTenant.mockImplementation(
      (_scope: unknown, operation: (client: object) => Promise<unknown>) =>
        operation({
          $executeRaw: executeRaw,
          usuarios: { findUnique },
          authSession: { updateMany: updateSessions },
          registros_auditoria: {
            create: createAuditLog,
            count: countAuditLogs,
            findMany: findAuditLogs,
          },
        }),
    );

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AuthorizationTestController],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: jest.fn().mockResolvedValue([{ result: 1 }]),
        $executeRaw: executeRaw,
        withTenant,
        usuarios: { findUnique },
        authSession: { updateMany: updateSessions },
        registros_auditoria: {
          create: createAuditLog,
          count: countAuditLogs,
          findMany: findAuditLogs,
        },
        onApplicationShutdown: jest.fn(),
      })
      .overrideProvider(UsersService)
      .useValue({
        findAll: findAllUsers,
        findOne: jest.fn(),
        create: createManagedUser,
        updateAccess: jest.fn(),
        updateStatus: jest.fn(),
        resetTemporaryPassword: jest.fn(),
        findRoles: jest.fn(),
        findOrganizations: jest.fn(),
        findBranches: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();
    jwtService = app.get(JwtService);
  });

  afterEach(async () => {
    await app.close();
  });

  async function accessToken(): Promise<string> {
    return jwtService.signAsync({
      sub: authenticatedUser.id,
      sid: '7f62fcf8-9934-4105-8765-e92b37ce9899',
      oid: authenticatedUser.organization.id,
      type: 'access',
    });
  }

  it('keeps the database health check public', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'ok',
          checks: {
            application: 'up',
            database: 'up',
          },
        });
      });
  });

  it('protects /api/auth/me by default', () => {
    return request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('returns the current safe user for a valid token', async () => {
    const token = await accessToken();

    return request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(authenticatedUser);
  });

  it('rejects a token whose session exceeded the inactivity timeout', async () => {
    executeRaw.mockResolvedValueOnce(0);
    const token = await accessToken();

    return request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('revokes the current session on logout', async () => {
    const token = await accessToken();

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(updateSessions).toHaveBeenCalledTimes(1);
    expect(updateSessions.mock.calls[0]?.[0].data.revokedAt).toBeInstanceOf(
      Date,
    );
  });

  it('enforces roles and permissions', async () => {
    const token = await accessToken();

    await request(app.getHttpServer())
      .get('/api/authorization-test/role')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/authorization-test/permission')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('allows matching roles and permissions', async () => {
    findUnique.mockResolvedValue({
      ...databaseUser,
      roles: {
        codigo: ROLE_CODES.ADMINISTRADOR,
        nombre: 'Administrador',
        activo: true,
        permisos_rol: [{ codigo_permiso: 'usuarios.gestionar' }],
      },
    });

    const token = await accessToken();

    await request(app.getHttpServer())
      .get('/api/authorization-test/role')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/authorization-test/permission')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('enforces role permissions on user administration', async () => {
    const sellerToken = await accessToken();
    await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', 'Bearer ' + sellerToken)
      .expect(403);

    findUnique.mockResolvedValue({
      ...databaseUser,
      roles: {
        codigo: ROLE_CODES.ADMINISTRADOR,
        nombre: 'Administrador',
        activo: true,
        permisos_rol: [{ codigo_permiso: 'usuarios.consultar' }],
      },
    });
    const readToken = await accessToken();
    await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', 'Bearer ' + readToken)
      .expect(200);
    expect(findAllUsers).toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', 'Bearer ' + readToken)
      .send({
        email: 'new.user@example.com',
        fullName: 'New User',
        organizationId: authenticatedUser.organization.id,
        roleCode: ROLE_CODES.VENDEDOR,
      })
      .expect(403);
  });

  it('allows user creation only with the management permission', async () => {
    findUnique.mockResolvedValue({
      ...databaseUser,
      roles: {
        codigo: ROLE_CODES.ADMINISTRADOR,
        nombre: 'Administrador',
        activo: true,
        permisos_rol: [{ codigo_permiso: 'usuarios.gestionar' }],
      },
    });
    const token = await accessToken();

    await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', 'Bearer ' + token)
      .send({
        email: 'new.user@example.com',
        fullName: 'New User',
        organizationId: authenticatedUser.organization.id,
        roleCode: ROLE_CODES.VENDEDOR,
      })
      .expect(201);
    expect(createManagedUser).toHaveBeenCalled();
  });

  it('blocks authenticated mutation endpoints without audit declaration', async () => {
    const token = await accessToken();

    return request(app.getHttpServer())
      .post('/api/authorization-test/unaudited')
      .set('Authorization', `Bearer ${token}`)
      .expect(500);
  });

  it('restricts audit history to users with audit permission', async () => {
    const sellerToken = await accessToken();
    await request(app.getHttpServer())
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(403);

    findUnique.mockResolvedValue({
      ...databaseUser,
      roles: {
        codigo: ROLE_CODES.ADMINISTRADOR,
        nombre: 'Administrador',
        activo: true,
        permisos_rol: [{ codigo_permiso: 'auditoria.consultar' }],
      },
    });
    const administratorToken = await accessToken();
    await request(app.getHttpServer())
      .get('/api/audit-logs?page=1&limit=50')
      .set('Authorization', `Bearer ${administratorToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          total: 1,
          page: 1,
          limit: 50,
        });
      });
  });

  it('rate limits repeated login attempts', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({})
        .expect(400);
    }

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({})
      .expect(429);
  });
});

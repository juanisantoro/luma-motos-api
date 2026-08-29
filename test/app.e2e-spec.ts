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
import { SalesService } from './../src/sales/sales.service';
import { UsersService } from './../src/users/users.service';
import { CreditInquiriesService } from './../src/credit-inquiries/credit-inquiries.service';

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
  const queryRaw = jest.fn();
  const updateSessions = jest.fn<
    Promise<Prisma.BatchPayload>,
    [Prisma.AuthSessionUpdateManyArgs]
  >();
  const executeRaw = jest.fn();
  const createAuditLog = jest.fn<
    Promise<unknown>,
    [Prisma.registros_auditoriaCreateArgs]
  >();
  const countAuditLogs = jest.fn();
  const findAuditLogs = jest.fn();
  const withTenant = jest.fn();
  const findAllUsers = jest.fn();
  const createManagedUser = jest.fn();
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
  const findSalesOperations = jest.fn();
  const createSalesOperation = jest.fn();
  const approveSalesOperation = jest.fn();
  const findRejectedInquiries = jest.fn();
  const verifyCreditDocument = jest.fn();
  const createCreditInquiry = jest.fn();
  const findFinancialInstitutions = jest.fn();
  const createFinancialInstitution = jest.fn();
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
      id: '4bd1189b-2bb1-4258-889b-4500de5eeade',
      code: ROLE_CODES.VENDEDOR,
      name: 'Vendedor',
      system: true,
      permissions: ['clientes.consultar'],
    },
    branch: null,
  };
  const databaseUser = {
    id: authenticatedUser.id,
    correo: authenticatedUser.email,
    activo: true,
    contrasena_configurada_en: new Date('2026-08-29T00:00:00.000Z'),
    estado_invitacion: 'ACCEPTED',
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
      id: authenticatedUser.role.id,
      codigo: ROLE_CODES.VENDEDOR,
      nombre: 'Vendedor',
      activo: true,
      es_sistema: true,
      permisos_rol: [{ codigo_permiso: 'clientes.consultar' }],
    },
    sucursales: null,
    sesiones_autenticacion: [{ lastActivityAt: new Date() }],
  };

  beforeEach(async () => {
    findUnique.mockReset();
    findUnique.mockResolvedValue(databaseUser);
    updateSessions.mockReset();
    updateSessions.mockResolvedValue({ count: 1 });
    executeRaw.mockReset();
    executeRaw.mockResolvedValue(1);
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([{ valid: true, locked: true }]);
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
    countClients.mockReset();
    countClients.mockResolvedValue(0);
    findClients.mockReset();
    findClients.mockResolvedValue([]);
    findClient.mockReset();
    createClient.mockReset();
    updateClient.mockReset();
    findOrganization.mockReset();
    findOrganization.mockResolvedValue({
      id: authenticatedUser.organization.id,
    });
    findSalesOperations.mockReset();
    findSalesOperations.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    createSalesOperation.mockReset();
    createSalesOperation.mockResolvedValue({ id: 'operation-id' });
    approveSalesOperation.mockReset();
    approveSalesOperation.mockResolvedValue({
      id: 'operation-id',
      status: 'APROBADA',
    });
    findRejectedInquiries.mockReset();
    findRejectedInquiries.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    verifyCreditDocument.mockReset();
    verifyCreditDocument.mockResolvedValue({
      found: false,
      clientId: null,
      isFlagged: false,
      blocksSale: false,
      lastRejection: null,
      summary: {
        totalAttempts: 0,
        rejectedAttempts: 0,
        approvedAttempts: 0,
        pendingAttempts: 0,
        firstConsultedAt: null,
        lastConsultedAt: null,
      },
      checkedAt: new Date('2026-08-29T15:00:00.000Z'),
    });
    createCreditInquiry.mockReset();
    createCreditInquiry.mockResolvedValue({
      id: 'credit-inquiry-id',
      idempotentReplay: false,
    });
    findFinancialInstitutions.mockReset();
    findFinancialInstitutions.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    createFinancialInstitution.mockReset();
    createFinancialInstitution.mockResolvedValue({
      id: 'financial-institution-id',
      name: 'Banco Demo',
      taxId: null,
      active: true,
    });
    withTenant.mockReset();
    withTenant.mockImplementation(
      (_scope: unknown, operation: (client: object) => Promise<unknown>) =>
        operation({
          $queryRaw: queryRaw,
          $executeRaw: executeRaw,
          usuarios: { findUnique },
          authSession: { updateMany: updateSessions },
          registros_auditoria: {
            create: createAuditLog,
            count: countAuditLogs,
            findMany: findAuditLogs,
          },
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
      .overrideProvider(SalesService)
      .useValue({
        findAll: findSalesOperations,
        findOne: jest.fn(),
        create: createSalesOperation,
        update: jest.fn(),
        reserve: jest.fn(),
        releaseReservation: jest.fn(),
        submit: jest.fn(),
        approve: approveSalesOperation,
        reject: jest.fn(),
        cancel: jest.fn(),
        close: jest.fn(),
      })
      .overrideProvider(CreditInquiriesService)
      .useValue({
        findRejected: findRejectedInquiries,
        verifyDocument: verifyCreditDocument,
        findClientHistory: jest.fn(),
        findRegistrants: jest.fn(),
        findBranches: jest.fn(),
        create: createCreditInquiry,
        findFinancialInstitutions,
        createFinancialInstitution,
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
    findUnique.mockResolvedValueOnce({
      ...databaseUser,
      sesiones_autenticacion: [],
    });
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

  it('lists only clients from the authenticated tenant', async () => {
    const token = await accessToken();

    await request(app.getHttpServer())
      .get('/api/clients?search=ana&active=true&page=1&limit=20')
      .set('Authorization', 'Bearer ' + token)
      .expect(200)
      .expect({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
      });

    expect(withTenant).toHaveBeenCalledWith(
      {
        organizationId: authenticatedUser.organization.id,
        globalAccess: false,
      },
      expect.any(Function),
    );
    expect(countClients.mock.calls[0]?.[0]).toMatchObject({
      where: {
        organizacion_id: authenticatedUser.organization.id,
        activo: true,
      },
    });
  });

  it('rejects organization filters without global access', async () => {
    const token = await accessToken();

    await request(app.getHttpServer())
      .get('/api/clients?organizationId=7d5cc401-544e-4651-9bd6-52495887fecd')
      .set('Authorization', 'Bearer ' + token)
      .expect(403);
    expect(countClients).not.toHaveBeenCalled();
  });

  it('enforces client management permission and payload validation', async () => {
    const readToken = await accessToken();
    await request(app.getHttpServer())
      .post('/api/clients')
      .set('Authorization', 'Bearer ' + readToken)
      .send({ fullName: 'Ana Cliente' })
      .expect(403);

    findUnique.mockResolvedValue({
      ...databaseUser,
      roles: {
        ...databaseUser.roles,
        permisos_rol: [{ codigo_permiso: 'clientes.gestionar' }],
      },
    });
    const manageToken = await accessToken();
    await request(app.getHttpServer())
      .post('/api/clients')
      .set('Authorization', 'Bearer ' + manageToken)
      .send({
        fullName: 'Ana Cliente',
        documentType: 'DNI',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/clients')
      .set('Authorization', 'Bearer ' + manageToken)
      .send({
        fullName: 'Ana Cliente',
        unexpected: 'rejected',
      })
      .expect(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('creates and audits a valid client with management permission', async () => {
    findUnique.mockResolvedValue({
      ...databaseUser,
      roles: {
        ...databaseUser.roles,
        permisos_rol: [{ codigo_permiso: 'clientes.gestionar' }],
      },
    });
    createClient.mockResolvedValue({
      id: '7d5cc401-544e-4651-9bd6-52495887fecd',
      tipo_documento: 'DNI',
      numero_documento: '12.345.678',
      nombre_completo: 'Ana Cliente',
      telefono: null,
      correo: 'ana@example.com',
      direccion: null,
      notas: null,
      activo: true,
      creado_en: new Date('2026-08-29T10:00:00.000Z'),
      actualizado_en: new Date('2026-08-29T10:00:00.000Z'),
      organizacion_id: authenticatedUser.organization.id,
      organizaciones: {
        id: authenticatedUser.organization.id,
        codigo: authenticatedUser.organization.code,
        nombre: authenticatedUser.organization.name,
        tipo: authenticatedUser.organization.type,
      },
    });
    const token = await accessToken();

    await request(app.getHttpServer())
      .post('/api/clients')
      .set('Authorization', 'Bearer ' + token)
      .send({
        fullName: 'Ana Cliente',
        documentType: 'DNI',
        documentNumber: '12.345.678',
        email: 'ANA@EXAMPLE.COM',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: '7d5cc401-544e-4651-9bd6-52495887fecd',
          fullName: 'Ana Cliente',
          active: true,
        });
      });

    expect(createClient.mock.calls[0]?.[0]).toMatchObject({
      data: {
        documento_normalizado: '12345678',
        correo: 'ana@example.com',
        organizacion_id: authenticatedUser.organization.id,
      },
    });
    expect(createAuditLog.mock.calls[0]?.[0]).toMatchObject({
      data: {
        accion: 'CLIENT_CREATED',
        entidad: 'clientes',
        usuario_id: authenticatedUser.id,
      },
    });
  });

  it('protects the sales contract with explicit read and approval permissions', async () => {
    findUnique.mockResolvedValue({
      ...databaseUser,
      roles: {
        ...databaseUser.roles,
        permisos_rol: [{ codigo_permiso: 'ventas.consultar' }],
      },
    });
    const readToken = await accessToken();
    await request(app.getHttpServer())
      .get('/api/sales/operations?vehicleType=MOTO&page=1&limit=20')
      .set('Authorization', 'Bearer ' + readToken)
      .expect(200)
      .expect({ items: [], total: 0, page: 1, limit: 20 });
    expect(findSalesOperations).toHaveBeenCalled();

    await request(app.getHttpServer())
      .post(
        '/api/sales/operations/7d5cc401-544e-4651-9bd6-52495887fecd/approve',
      )
      .set('Authorization', 'Bearer ' + readToken)
      .send({ expectedVersion: 1 })
      .expect(403);
    expect(approveSalesOperation).not.toHaveBeenCalled();
  });

  it('validates sales payloads before invoking the audited service', async () => {
    findUnique.mockResolvedValue({
      ...databaseUser,
      roles: {
        ...databaseUser.roles,
        permisos_rol: [{ codigo_permiso: 'ventas.gestionar' }],
      },
    });

    const token = await accessToken();
    await request(app.getHttpServer())
      .post('/api/sales/operations')
      .set('Authorization', 'Bearer ' + token)
      .send({
        branchId: '84e778cc-7616-4792-b6db-d89f100bb6f1',
        clientId: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
        versionId: '4de88c4c-3382-4f9b-ae60-98147159c977',
        condition: 'NUEVO',
        agreedPrice: 100,
        forcedStatus: 'CERRADA',
      })
      .expect(400);
    expect(createSalesOperation).not.toHaveBeenCalled();
  });

  it('enforces distinct credit inquiry permissions', async () => {
    const tokenWithoutCreditPermission = await accessToken();
    await request(app.getHttpServer())
      .get(
        '/api/credit-inquiries/verify?documentType=DNI&documentNumber=12345678',
      )
      .set('Authorization', 'Bearer ' + tokenWithoutCreditPermission)
      .expect(403);

    findUnique.mockResolvedValue({
      ...databaseUser,
      roles: {
        ...databaseUser.roles,
        permisos_rol: [{ codigo_permiso: 'consultas_crediticias.verificar' }],
      },
    });
    const verifyToken = await accessToken();
    await request(app.getHttpServer())
      .get(
        '/api/credit-inquiries/verify?documentType=DNI&documentNumber=12.345.678',
      )
      .set('Authorization', 'Bearer ' + verifyToken)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          found: false,
          isFlagged: false,
          blocksSale: false,
        });
      });
    expect(verifyCreditDocument).toHaveBeenCalledTimes(1);
    const verifyCall = verifyCreditDocument.mock.calls[0] as
      [unknown, { organization: { id: string } }] | undefined;
    expect(verifyCall?.[0]).toEqual({
      documentType: 'DNI',
      documentNumber: '12.345.678',
    });
    expect(verifyCall?.[1].organization.id).toBe(
      authenticatedUser.organization.id,
    );
  });

  it('validates credit inquiry payloads and idempotency headers', async () => {
    findUnique.mockResolvedValue({
      ...databaseUser,
      roles: {
        ...databaseUser.roles,
        permisos_rol: [{ codigo_permiso: 'consultas_crediticias.registrar' }],
      },
    });
    const token = await accessToken();
    const payload = {
      documentType: 'DNI',
      documentNumber: '12.345.678',
      fullName: 'Ana Cliente',
      financialEntityId: 'aa49c8ec-e497-495c-a11f-7d74287f942d',
      outcome: 'RECHAZADA',
      reason: 'Scoring insuficiente',
      consultedAt: '2026-08-29T15:00:00.000Z',
    };

    await request(app.getHttpServer())
      .post('/api/credit-inquiries')
      .set('Authorization', 'Bearer ' + token)
      .send(payload)
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/credit-inquiries')
      .set('Authorization', 'Bearer ' + token)
      .set('Idempotency-Key', 'credit-12345678')
      .send({ ...payload, unexpected: true })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/credit-inquiries')
      .set('Authorization', 'Bearer ' + token)
      .set('Idempotency-Key', 'credit-12345678')
      .send(payload)
      .expect(201)
      .expect({ id: 'credit-inquiry-id', idempotentReplay: false });
    expect(createCreditInquiry).toHaveBeenCalledWith(
      expect.objectContaining({
        documentNumber: '12.345.678',
        outcome: 'RECHAZADA',
      }),
      'credit-12345678',
      expect.any(Object),
    );
  });

  it('allows read-only users to load credit filter catalogs via OR permissions', async () => {
    findUnique.mockResolvedValue({
      ...databaseUser,
      roles: {
        ...databaseUser.roles,
        permisos_rol: [{ codigo_permiso: 'consultas_crediticias.consultar' }],
      },
    });
    const token = await accessToken();

    await request(app.getHttpServer())
      .get('/api/credit-inquiries/rejected?page=1&limit=20')
      .set('Authorization', 'Bearer ' + token)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/financial-institutions?page=1&limit=20')
      .set('Authorization', 'Bearer ' + token)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/credit-inquiries/branches?page=1&limit=20')
      .set('Authorization', 'Bearer ' + token)
      .expect(200);
    expect(findRejectedInquiries).toHaveBeenCalled();
    expect(findFinancialInstitutions).toHaveBeenCalled();
  });

  it('allows sales approval only with the dedicated permission', async () => {
    findUnique.mockResolvedValue({
      ...databaseUser,
      roles: {
        codigo: ROLE_CODES.GERENTE,
        nombre: 'Gerente',
        activo: true,
        permisos_rol: [{ codigo_permiso: 'ventas.aprobar' }],
      },
    });
    const token = await accessToken();
    await request(app.getHttpServer())
      .post(
        '/api/sales/operations/7d5cc401-544e-4651-9bd6-52495887fecd/approve',
      )
      .set('Authorization', 'Bearer ' + token)
      .send({ expectedVersion: 1 })
      .expect(201)
      .expect({ id: 'operation-id', status: 'APROBADA' });
    expect(approveSalesOperation).toHaveBeenCalled();
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

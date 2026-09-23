import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuditService } from '../src/audit/audit.service';
import type {
  AuthenticatedPrincipal,
  AuthenticatedUser,
} from '../src/auth/auth.types';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';

const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
const sanMiguelId = 'bb5a44e1-7da1-4fc7-acd2-e7c78be98785';
const delVisoId = '043c98b6-d1af-44a4-9c27-e7360dba346c';
const personnelId = '4a2501a4-b00c-4559-9d27-ac78c2018d91';
const roleId = '4bd1189b-2bb1-4258-889b-4500de5eeade';

const actor: AuthenticatedUser = {
  id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
  email: 'admin@luma.test',
  name: 'Administrator',
  active: true,
  globalAccess: true,
  organization: {
    id: organizationId,
    code: 'LUMA_CENTRAL',
    name: 'Luma',
    type: 'CASA_CENTRAL',
  },
  role: {
    id: roleId,
    code: 'ADMINISTRADOR',
    name: 'Administrador',
    system: true,
    permissions: ['usuarios.consultar', 'usuarios.gestionar'],
  },
  branch: null,
};

function managedUser(overrides: Record<string, unknown> = {}) {
  return {
    id: '7d5cc401-544e-4651-9bd6-52495887fecd',
    correo: 'ana@luma.test',
    activo: true,
    acceso_global: false,
    creado_en: new Date('2026-08-29T00:00:00.000Z'),
    actualizado_en: new Date('2026-08-29T00:00:00.000Z'),
    ultimo_inicio_sesion_en: null,
    contrasena_configurada_en: new Date('2026-08-29T00:00:00.000Z'),
    contrasena_temporal_vence_en: null,
    estado_invitacion: 'ACCEPTED',
    invitacion_ultimo_intento_en: null,
    invitacion_enviada_en: null,
    invitacion_aceptada_en: null,
    invitacion_error: null,
    invitacion_version: 1,
    organizacion_id: organizationId,
    organizaciones: {
      id: organizationId,
      codigo: 'LUMA_CENTRAL',
      nombre: 'Luma',
      tipo: 'CASA_CENTRAL',
      activa: true,
    },
    roles: {
      id: roleId,
      codigo: 'ADMINISTRATIVA',
      nombre: 'Administrativa',
      activo: true,
      es_sistema: true,
      version: 1,
      permisos_rol: [],
    },
    sucursales: {
      id: sanMiguelId,
      codigo: 'SAN_MIGUEL',
      nombre: 'San Miguel',
      activa: true,
    },
    personal: {
      id: personnelId,
      codigo_empleado: null,
      nombre_completo: 'Ana Vende',
      telefono: null,
      puede_iniciar_sesion: true,
      estado: 'ACTIVO',
    },
    ...overrides,
  };
}

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    { provide: PrismaService, useValue: {} },
    { provide: AuditService, useValue: {} },
    { provide: MailService, useValue: {} },
    {
      provide: ConfigService,
      useValue: { get: jest.fn().mockReturnValue(86_400) },
    },
  ],
})
class UsersAccessTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        (
          req: { user?: AuthenticatedPrincipal },
          _res: unknown,
          next: () => void,
        ) => {
          req.user = {
            sessionId: '12d67411-ea3e-4f20-b9cb-6442a8f6e962',
            user: actor,
          };
          next();
        },
      )
      .forRoutes('*');
  }
}

describe('PATCH /api/users/:id/access (e2e)', () => {
  let app: INestApplication<App>;
  const findUser = jest.fn();
  const findUserOrThrow = jest.fn();
  const updateUser = jest.fn<Promise<unknown>, [Prisma.usuariosUpdateArgs]>();
  const updatePersonnel = jest.fn();
  const deleteBranchAccess = jest.fn();
  const createBranchAccess = jest.fn();
  const findRole = jest.fn();
  const findBranch = jest.fn();
  const transaction = {
    usuarios: {
      findFirst: findUser,
      findUniqueOrThrow: findUserOrThrow,
      update: updateUser,
      count: jest.fn().mockResolvedValue(2),
    },
    personal: { update: updatePersonnel },
    acceso_personal_sucursal: {
      deleteMany: deleteBranchAccess,
      create: createBranchAccess,
    },
    authSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    organizaciones: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: organizationId, tipo: 'CASA_CENTRAL' }),
    },
    role: { findFirst: findRole },
    sucursales: { findFirst: findBranch },
    $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  } as unknown as Prisma.TransactionClient;
  const work = (
    _arg: unknown,
    operation: (client: Prisma.TransactionClient) => Promise<unknown>,
  ) => operation(transaction);
  const withTenant = jest.fn().mockImplementation(work);
  const executeAudit = jest.fn().mockImplementation(work);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [UsersAccessTestModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ withTenant })
      .overrideProvider(AuditService)
      .useValue({ execute: executeAudit })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    findRole.mockImplementation(({ where }: { where: { codigo: string } }) =>
      Promise.resolve({ id: roleId, codigo: where.codigo }),
    );
    findBranch.mockResolvedValue({ id: delVisoId });
    updatePersonnel.mockResolvedValue({ id: personnelId });
    deleteBranchAccess.mockResolvedValue({ count: 1 });
    createBranchAccess.mockResolvedValue({});
    updateUser.mockResolvedValue({});
  });

  afterAll(async () => {
    await app.close();
  });

  it('assigns VENDEDOR and a new branch with the full form payload', async () => {
    const current = managedUser();
    findUser.mockResolvedValue(current);
    findUserOrThrow.mockResolvedValue(
      managedUser({
        roles: { ...current.roles, codigo: 'VENDEDOR', nombre: 'Vendedor' },
        sucursales: {
          id: delVisoId,
          codigo: 'DEL_VISO',
          nombre: 'Del Viso',
          activa: true,
        },
      }),
    );

    await request(app.getHttpServer())
      .patch(`/api/users/${current.id}/access`)
      .send({ roleCode: 'VENDEDOR', branchId: delVisoId, globalAccess: false })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          user: {
            role: { code: 'VENDEDOR' },
            branch: { id: delVisoId, code: 'DEL_VISO' },
          },
          revokedSessions: 1,
        });
      });
    expect(createBranchAccess).toHaveBeenCalledWith({
      data: {
        personal_id: personnelId,
        sucursal_id: delVisoId,
        organizacion_id: organizationId,
      },
    });
  });

  it('lets the actor change only their own branch while echoing role and scope', async () => {
    const self = managedUser({
      id: actor.id,
      acceso_global: true,
      roles: { ...managedUser().roles, codigo: 'ADMINISTRADOR' },
    });
    findUser.mockResolvedValue(self);
    findUserOrThrow.mockResolvedValue(self);

    await request(app.getHttpServer())
      .patch(`/api/users/${actor.id}/access`)
      .send({
        roleCode: 'ADMINISTRADOR',
        branchId: delVisoId,
        globalAccess: true,
      })
      .expect(200);
  });

  it('answers a typed 400 when global access is sent for a seller', async () => {
    findUser.mockResolvedValue(managedUser());

    await request(app.getHttpServer())
      .patch(`/api/users/${managedUser().id}/access`)
      .send({ roleCode: 'VENDEDOR', branchId: delVisoId, globalAccess: true })
      .expect(400)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'GLOBAL_ACCESS_REQUIRES_CENTRAL_ADMIN',
        });
      });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('answers 409 USER_PERSONNEL_MISSING instead of 500', async () => {
    findUser.mockResolvedValue(managedUser({ personal: null }));

    await request(app.getHttpServer())
      .patch(`/api/users/${managedUser().id}/access`)
      .send({ branchId: delVisoId })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'USER_PERSONNEL_MISSING' });
      });
  });
});

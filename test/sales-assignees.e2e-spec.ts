import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuditService } from '../src/audit/audit.service';
import type {
  AuthenticatedPrincipal,
  AuthenticatedUser,
} from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { SalesController } from '../src/sales/sales.controller';
import { SalesService } from '../src/sales/sales.service';

const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
const foreignOrganizationId = 'a0c86b26-5943-4555-9112-bf0c65df0c21';
const branchId = '84e778cc-7616-4792-b6db-d89f100bb6f1';
const sellerId = '11b5de9b-9bc2-4777-bb78-9c7267b73aca';
const foreignPersonnelId = '21b5de9b-9bc2-4777-bb78-9c7267b73aca';

const actor: AuthenticatedUser = {
  id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
  email: 'admin@luma.test',
  name: 'Administrator',
  active: true,
  globalAccess: true,
  organization: {
    id: organizationId,
    code: 'LUMA',
    name: 'Luma',
    type: 'CASA_CENTRAL',
  },
  role: {
    id: '4bd1189b-2bb1-4258-889b-4500de5eeade',
    code: 'ADMINISTRADOR',
    name: 'Administrador',
    system: true,
    permissions: ['ventas.consultar', 'ventas.gestionar'],
  },
  branch: null,
};

@Module({
  controllers: [SalesController],
  providers: [
    SalesService,
    { provide: PrismaService, useValue: {} },
    { provide: AuditService, useValue: {} },
  ],
})
class SalesAssigneesTestModule implements NestModule {
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

describe('Sales assignee tenant isolation (e2e)', () => {
  let app: INestApplication<App>;
  const createOperation = jest.fn();
  const findPersonnel = jest.fn();
  const listPersonnel = jest
    .fn<Promise<unknown[]>, [Prisma.personalFindManyArgs]>()
    .mockResolvedValue([
      {
        id: sellerId,
        usuario_id: null,
        codigo_empleado: 'VEN-01',
        nombre_completo: 'Vendedora Demo',
        sucursales: {
          id: branchId,
          codigo: 'SAN_MIGUEL',
          nombre: 'San Miguel',
        },
        acceso_personal_sucursal: [],
      },
    ]);
  const transaction = {
    sucursales: { findFirst: jest.fn().mockResolvedValue({ id: branchId }) },
    clientes: { findFirst: jest.fn().mockResolvedValue({ id: sellerId }) },
    versiones_vehiculos: {
      findUnique: jest.fn().mockResolvedValue({
        alcance: 'GLOBAL',
        organizacion_propietaria_id: null,
        catalogo_organizaciones: [],
        modelos_vehiculos: { tipo_vehiculo: 'MOTO' },
      }),
    },
    personal: {
      count: jest.fn().mockResolvedValue(1),
      findMany: listPersonnel,
      findFirst: findPersonnel,
    },
    operaciones: { create: createOperation },
  } as unknown as Prisma.TransactionClient;
  const withTenant = jest
    .fn()
    .mockImplementation(
      (
        _scope: unknown,
        work: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => work(transaction),
    );
  const executeAudit = jest
    .fn()
    .mockImplementation(
      (
        _event: unknown,
        work: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => work(transaction),
    );

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [SalesAssigneesTestModule],
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
    createOperation.mockReset();
    findPersonnel.mockReset();
    withTenant.mockClear();
    executeAudit.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists only organization personnel without requiring branchId', async () => {
    await request(app.getHttpServer())
      .get(`/api/sales/operations/sellers?organizationId=${organizationId}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          total: 1,
          items: [
            {
              id: sellerId,
              branch: {
                id: branchId,
                code: 'SAN_MIGUEL',
                name: 'San Miguel',
              },
              branches: [
                {
                  id: branchId,
                  code: 'SAN_MIGUEL',
                  name: 'San Miguel',
                },
              ],
            },
          ],
        });
      });
    expect(listPersonnel.mock.calls[0]?.[0].where).toMatchObject({
      organizacion_id: organizationId,
    });
  });

  it('rejects a different organization before querying tenant data', async () => {
    await request(app.getHttpServer())
      .get(
        `/api/sales/operations/contacts?organizationId=${foreignOrganizationId}`,
      )
      .expect(403);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it.each([
    ['sellerId', 'INVALID_OPERATION_SELLER'],
    ['contactId', 'INVALID_OPERATION_CONTACT'],
  ] as const)(
    'rejects a cross-tenant %s without writing',
    async (field, code) => {
      findPersonnel.mockImplementation((args: Prisma.personalFindFirstArgs) =>
        args.where?.id === sellerId ? Promise.resolve({ id: sellerId }) : null,
      );

      await request(app.getHttpServer())
        .post('/api/sales/operations')
        .send({
          vehicleType: 'MOTO',
          branchId,
          clientId: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
          versionId: '4de88c4c-3382-4f9b-ae60-98147159c977',
          condition: 'NUEVO',
          unitId: 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2',
          sellerId: field === 'sellerId' ? foreignPersonnelId : sellerId,
          contactId: field === 'contactId' ? foreignPersonnelId : undefined,
          agreedPrice: 100,
          paymentPlatform: 'EFECTIVO',
          submit: false,
        })
        .expect(400)
        .expect(({ body }) => {
          expect(body).toMatchObject({ statusCode: 400, code });
        });
      expect(createOperation).not.toHaveBeenCalled();
    },
  );
});

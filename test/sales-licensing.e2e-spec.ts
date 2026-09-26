import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { MutationAuditGuard } from '../src/audit/guards/mutation-audit.guard';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import type {
  AuthenticatedPrincipal,
  AuthenticatedUser,
} from '../src/auth/auth.types';
import { SalesController } from '../src/sales/sales.controller';
import { SalesService } from '../src/sales/sales.service';

const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
const operationId = '7d5cc401-544e-4651-9bd6-52495887fecd';
const uuid = (suffix: string) => `11b5de9b-9bc2-4777-bb78-9c7267b7${suffix}`;

let permissions: string[] = [];

const actor = (): AuthenticatedUser => ({
  id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
  email: 'administrativa@luma.test',
  name: 'Administrativa',
  active: true,
  globalAccess: false,
  organization: {
    id: organizationId,
    code: 'LUMA',
    name: 'Luma',
    type: 'CASA_CENTRAL',
  },
  role: {
    id: '4bd1189b-2bb1-4258-889b-4500de5eeade',
    code: 'ADMINISTRATIVA',
    name: 'Administrativa',
    system: true,
    permissions,
  },
  branch: null,
});

type Payload = Record<string, unknown>;
const serviceMethod = (result: unknown) =>
  jest
    .fn<Promise<unknown>, [Payload, ...unknown[]]>()
    .mockResolvedValue(result);
const service = {
  create: serviceMethod({ id: operationId }),
  update: serviceMethod({ id: operationId }),
  updateLicensing: serviceMethod({ id: operationId }),
  collectLicensing: serviceMethod({ id: operationId }),
  findAll: serviceMethod({ items: [], total: 0 }),
};

@Module({
  controllers: [SalesController],
  providers: [
    { provide: SalesService, useValue: service },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: MutationAuditGuard },
  ],
})
class SalesLicensingTestModule implements NestModule {
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
            user: actor(),
          };
          next();
        },
      )
      .forRoutes('*');
  }
}

describe('Sales operation helmet and licensing (e2e)', () => {
  let app: INestApplication<App>;

  const validCreate = {
    vehicleType: 'MOTO',
    branchId: uuid('0001'),
    clientId: uuid('0002'),
    versionId: uuid('0003'),
    condition: 'NUEVO',
    unitId: uuid('0004'),
    agreedPrice: 2500000,
    paymentPlatform: 'EFECTIVO',
    includesHelmet: true,
    licensingMode: 'PAGA_CLIENTE',
    licensingAmount: 85000,
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [SalesLicensingTestModule],
    }).compile();
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
    permissions = [
      'ventas.consultar',
      'ventas.gestionar',
      'ventas.patentamiento.gestionar',
    ];
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts helmet and licensing fields on create', async () => {
    await request(app.getHttpServer())
      .post('/api/sales/operations')
      .send(validCreate)
      .expect(201);
    expect(service.create.mock.calls[0][0]).toMatchObject({
      includesHelmet: true,
      licensingMode: 'PAGA_CLIENTE',
      licensingAmount: 85000,
    });
  });

  it('requires a licensing mode on create', async () => {
    const withoutMode: Payload = { ...validCreate };
    delete withoutMode.licensingMode;
    await request(app.getHttpServer())
      .post('/api/sales/operations')
      .send(withoutMode)
      .expect(400)
      .expect(({ body }: { body: { message: unknown } }) => {
        expect(JSON.stringify(body.message)).toContain('licensingMode');
      });
    expect(service.create).not.toHaveBeenCalled();
  });

  it('rejects unknown licensing modes and non-boolean helmet values', async () => {
    await request(app.getHttpServer())
      .post('/api/sales/operations')
      .send({ ...validCreate, licensingMode: 'GRATIS' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/sales/operations')
      .send({ ...validCreate, includesHelmet: 'si' })
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('manages licensing with the dedicated permission', async () => {
    await request(app.getHttpServer())
      .patch(`/api/sales/operations/${operationId}/licensing`)
      .send({ expectedVersion: 3, mode: 'BONIFICADA' })
      .expect(200);
    expect(service.updateLicensing).toHaveBeenCalledWith(
      operationId,
      { expectedVersion: 3, mode: 'BONIFICADA' },
      expect.objectContaining({ id: actor().id }),
    );
  });

  it('forbids licensing management without ventas.patentamiento.gestionar', async () => {
    permissions = ['ventas.consultar', 'ventas.gestionar'];
    await request(app.getHttpServer())
      .patch(`/api/sales/operations/${operationId}/licensing`)
      .send({ expectedVersion: 3, mode: 'BONIFICADA' })
      .expect(403);
    expect(service.updateLicensing).not.toHaveBeenCalled();
  });

  it('validates the licensing payload and rejects unknown fields', async () => {
    const server = app.getHttpServer();
    await request(server)
      .patch(`/api/sales/operations/${operationId}/licensing`)
      .send({ mode: 'BONIFICADA' })
      .expect(400);
    await request(server)
      .patch(`/api/sales/operations/${operationId}/licensing`)
      .send({ expectedVersion: 3, mode: 'PAGA_CLIENTE', amount: 0 })
      .expect(400);
    await request(server)
      .patch(`/api/sales/operations/${operationId}/licensing`)
      .send({ expectedVersion: 3, mode: 'PAGA_CLIENTE', status: 'PAGADO' })
      .expect(400);
    expect(service.updateLicensing).not.toHaveBeenCalled();
  });

  describe('patent collection', () => {
    const path = `/api/sales/operations/${operationId}/licensing/collections`;
    const body = {
      idempotencyKey: 'c1c2d3e4-0000-4000-8000-000000000002',
      accountId: 'b1c2d3e4-0000-4000-8000-000000000001',
      amount: '85000.00',
      collectionDate: '2026-09-20',
    };

    it('registers the collection with licensing and collect permissions', async () => {
      permissions = [
        'ventas.consultar',
        'ventas.patentamiento.gestionar',
        'ingresos.cobrar',
      ];
      await request(app.getHttpServer()).post(path).send(body).expect(201);
      expect(service.collectLicensing).toHaveBeenCalledWith(
        operationId,
        body,
        expect.objectContaining({ id: actor().id }),
      );
    });

    it('requires ingresos.cobrar besides the licensing permission', async () => {
      await request(app.getHttpServer()).post(path).send(body).expect(403);
      expect(service.collectLicensing).not.toHaveBeenCalled();
    });

    it('validates amount, date and idempotency key', async () => {
      permissions = [
        'ventas.consultar',
        'ventas.patentamiento.gestionar',
        'ingresos.cobrar',
      ];
      const server = app.getHttpServer();
      await request(server)
        .post(path)
        .send({ ...body, amount: 85000 })
        .expect(400);
      await request(server)
        .post(path)
        .send({ ...body, collectionDate: '20/09/2026' })
        .expect(400);
      await request(server)
        .post(path)
        .send({ ...body, idempotencyKey: 'repetido' })
        .expect(400);
      expect(service.collectLicensing).not.toHaveBeenCalled();
    });
  });

  it('parses licensing filters on the operations list', async () => {
    await request(app.getHttpServer())
      .get(
        '/api/sales/operations?vehicleType=MOTO&licensingMode=SIN_DEFINIR&licensingOverdue=true&search=B-0001',
      )
      .expect(200);
    expect(service.findAll.mock.calls[0][0]).toMatchObject({
      licensingMode: 'SIN_DEFINIR',
      licensingOverdue: true,
      search: 'B-0001',
    });
    await request(app.getHttpServer())
      .get('/api/sales/operations?vehicleType=MOTO&licensingMode=OTRA')
      .expect(400);
  });
});

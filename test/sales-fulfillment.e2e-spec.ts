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
import { SupplyController } from '../src/supply/supply.controller';
import { SupplyService } from '../src/supply/supply.service';

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
  assignUnit: serviceMethod({ id: operationId }),
  requestSupply: serviceMethod({ id: operationId }),
  findAll: serviceMethod({ items: [], total: 0 }),
};
const supplyService = {
  receive: serviceMethod({ replayed: false }),
};

@Module({
  controllers: [SalesController, SupplyController],
  providers: [
    { provide: SalesService, useValue: service },
    { provide: SupplyService, useValue: supplyService },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: MutationAuditGuard },
  ],
})
class SalesFulfillmentTestModule implements NestModule {
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

describe('Sales fulfillment: assignment tray, stock and supplier orders (e2e)', () => {
  let app: INestApplication<App>;
  const unitId = '21b5de9b-9bc2-4777-bb78-9c7267b73aca';
  const supplierId = '0a44e64e-351e-4d9b-9150-5f20e34e4d61';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [SalesFulfillmentTestModule],
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
      'ventas.asignar_unidad',
      'abastecimiento.gestionar',
      'abastecimiento.recibir',
    ];
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a sale with version and condition only', async () => {
    await request(app.getHttpServer())
      .post('/api/sales/operations')
      .send({
        vehicleType: 'MOTO',
        branchId: uuid('0001'),
        clientId: uuid('0002'),
        versionId: uuid('0003'),
        condition: 'NUEVO',
        color: 'Rojo',
        agreedPrice: 2500000,
        paymentPlatform: 'EFECTIVO',
        licensingMode: 'BONIFICADA',
      })
      .expect(201);
    const payload = service.create.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ color: 'Rojo' });
    expect(payload?.unitId).toBeUndefined();
    expect(payload?.supplierAvailabilityId).toBeUndefined();
  });

  it('lists the assignment tray with the fulfillment filter', async () => {
    await request(app.getHttpServer())
      .get(
        '/api/sales/operations?vehicleType=MOTO&fulfillmentStatus=SIN_ASIGNAR',
      )
      .expect(200);
    expect(service.findAll.mock.calls[0]?.[0]).toMatchObject({
      fulfillmentStatus: 'SIN_ASIGNAR',
    });
    await request(app.getHttpServer())
      .get('/api/sales/operations?vehicleType=MOTO&fulfillmentStatus=OTRO')
      .expect(400);
  });

  it('assigns a stock unit with ventas.asignar_unidad', async () => {
    await request(app.getHttpServer())
      .post(`/api/sales/operations/${operationId}/assign-unit`)
      .send({ expectedVersion: 3, unitId, engineNumber: 'JC41E123' })
      .expect(201);
    expect(service.assignUnit).toHaveBeenCalledWith(
      operationId,
      { expectedVersion: 3, unitId, engineNumber: 'JC41E123' },
      expect.objectContaining({ id: actor().id }),
    );
  });

  it('forbids a seller from assigning units or ordering from suppliers', async () => {
    permissions = ['ventas.consultar', 'ventas.gestionar'];
    const server = app.getHttpServer();
    await request(server)
      .post(`/api/sales/operations/${operationId}/assign-unit`)
      .send({ expectedVersion: 3, unitId })
      .expect(403);
    await request(server)
      .post(`/api/sales/operations/${operationId}/supply-request`)
      .send({ expectedVersion: 3, supplierId })
      .expect(403);
    expect(service.assignUnit).not.toHaveBeenCalled();
    expect(service.requestSupply).not.toHaveBeenCalled();
  });

  it('orders from a supplier with ventas.asignar_unidad and abastecimiento.gestionar', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post(`/api/sales/operations/${operationId}/supply-request`)
      .send({ expectedVersion: 3, supplierId, estimatedCost: 1500000 })
      .expect(201);
    permissions = ['ventas.consultar', 'ventas.asignar_unidad'];
    await request(server)
      .post(`/api/sales/operations/${operationId}/supply-request`)
      .send({ expectedVersion: 3, supplierId })
      .expect(403);
    await request(server)
      .post(`/api/sales/operations/${operationId}/supply-request`)
      .send({ expectedVersion: 3, supplierId, supplierAvailabilityId: unitId })
      .expect(403);
    expect(service.requestSupply).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown fields on assignment and orders', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post(`/api/sales/operations/${operationId}/assign-unit`)
      .send({ expectedVersion: 3, unitId, branchId: uuid('0001') })
      .expect(400);
    await request(server)
      .post(`/api/sales/operations/${operationId}/supply-request`)
      .send({ expectedVersion: 3, supplierId, supplierAvailabilityId: unitId })
      .expect(400);
  });

  it('accepts chassis and engine number when receiving a supplier order', async () => {
    // The engine number is required for motorcycles in the service (the
    // request's vehicle type decides); the DTO keeps it optional for cars.
    const server = app.getHttpServer();
    const path = `/api/supply-requests/${operationId}/receive`;
    await request(server)
      .post(path)
      .send({
        vin: '9C2JC4110AR000123',
        engineNumber: '',
        branchId: uuid('0001'),
      })
      .expect(400);
    await request(server)
      .post(path)
      .send({
        vin: '9C2JC4110AR000123',
        engineNumber: 'JC41E-123456',
        branchId: uuid('0001'),
      })
      .expect(201);
    expect(supplyService.receive).toHaveBeenCalledTimes(1);
  });
});

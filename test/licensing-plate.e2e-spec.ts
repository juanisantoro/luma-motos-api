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
import { VehiclePaymentsController } from '../src/vehicle-payments/vehicle-payments.controller';
import { VehiclePaymentsService } from '../src/vehicle-payments/vehicle-payments.service';

// Fase 5: llegada de la patente, calendario de días hábiles, filtro de cobro
// pendiente y búsqueda por boleto en pagos de vehículo.

const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
const operationId = '7d5cc401-544e-4651-9bd6-52495887fecd';

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
const sales = {
  registerLicensePlate: serviceMethod({ id: operationId }),
  findAll: serviceMethod({ items: [], total: 0 }),
  licensingCalendar: jest.fn().mockReturnValue({
    businessDays: { from: 10, to: 15 },
    holidays: ['2026-10-12'],
  }),
};
const vehiclePayments = {
  findAll: serviceMethod({ items: [], total: 0, page: 1, limit: 50 }),
};

@Module({
  controllers: [SalesController, VehiclePaymentsController],
  providers: [
    { provide: SalesService, useValue: sales },
    { provide: VehiclePaymentsService, useValue: vehiclePayments },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: MutationAuditGuard },
  ],
})
class LicensingPlateTestModule implements NestModule {
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

describe('Licensing plate arrival (e2e)', () => {
  let app: INestApplication<App>;
  const path = `/api/sales/operations/${operationId}/licensing/plate`;
  const collection = {
    idempotencyKey: 'c1c2d3e4-0000-4000-8000-000000000002',
    accountId: 'b1c2d3e4-0000-4000-8000-000000000001',
    amount: '85000.00',
    collectionDate: '2026-09-20',
    paymentMethod: 'EFECTIVO',
    handoverToId: 'd1c2d3e4-0000-4000-8000-000000000003',
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [LicensingPlateTestModule],
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
    permissions = ['ventas.consultar', 'ventas.patentamiento.gestionar'];
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the plate with the licensing permission', async () => {
    const body = {
      expectedVersion: 4,
      licensePlate: 'A123BCD',
      receivedAt: '2026-09-20',
    };
    await request(app.getHttpServer()).post(path).send(body).expect(201);
    expect(sales.registerLicensePlate).toHaveBeenCalledWith(
      operationId,
      body,
      expect.objectContaining({ id: actor().id }),
    );
  });

  it('accepts the client collection in the same request', async () => {
    await request(app.getHttpServer())
      .post(path)
      .send({ expectedVersion: 4, licensePlate: 'A123BCD', collection })
      .expect(201);
    expect(sales.registerLicensePlate.mock.calls[0]?.[1]).toMatchObject({
      collection,
    });
  });

  it('forbids registering the plate without ventas.patentamiento.gestionar', async () => {
    permissions = ['ventas.consultar', 'ventas.gestionar'];
    await request(app.getHttpServer())
      .post(path)
      .send({ expectedVersion: 4, licensePlate: 'A123BCD' })
      .expect(403);
    expect(sales.registerLicensePlate).not.toHaveBeenCalled();
  });

  it('validates the payload, including the nested collection', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post(path)
      .send({ licensePlate: 'A123BCD' })
      .expect(400);
    await request(server)
      .post(path)
      .send({ expectedVersion: 4, licensePlate: '' })
      .expect(400);
    await request(server)
      .post(path)
      .send({
        expectedVersion: 4,
        licensePlate: 'A123BCD',
        receivedAt: '20/09/2026',
      })
      .expect(400);
    await request(server)
      .post(path)
      .send({ expectedVersion: 4, licensePlate: 'A123BCD', paid: true })
      .expect(400);
    await request(server)
      .post(path)
      .send({
        expectedVersion: 4,
        licensePlate: 'A123BCD',
        collection: { ...collection, amount: 85000 },
      })
      .expect(400);
    await request(server)
      .post(path)
      .send({
        expectedVersion: 4,
        licensePlate: 'A123BCD',
        collection: { ...collection, extra: 'x' },
      })
      .expect(400);
    expect(sales.registerLicensePlate).not.toHaveBeenCalled();
  });

  it('serves the business-day calendar before the :id route', async () => {
    await request(app.getHttpServer())
      .get('/api/sales/operations/licensing-calendar')
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toEqual({
          businessDays: { from: 10, to: 15 },
          holidays: ['2026-10-12'],
        });
      });
  });

  it('parses the pending collection filter as a boolean', async () => {
    await request(app.getHttpServer())
      .get('/api/sales/operations')
      .query({ vehicleType: 'MOTO', licensingCollectionPending: 'true' })
      .expect(200);
    expect(sales.findAll.mock.calls[0]?.[0]).toMatchObject({
      licensingCollectionPending: true,
    });
    await request(app.getHttpServer())
      .get('/api/sales/operations')
      .query({ vehicleType: 'MOTO', licensingCollectionPending: 'quizas' })
      .expect(400);
  });

  it('searches vehicle payments by ticket number', async () => {
    permissions = ['pagos_vehiculo.consultar'];
    await request(app.getHttpServer())
      .get('/api/vehicle-payments')
      .query({ vehicleType: 'MOTO', search: 'B-0001' })
      .expect(200);
    expect(vehiclePayments.findAll.mock.calls[0]?.[0]).toMatchObject({
      search: 'B-0001',
    });
  });
});

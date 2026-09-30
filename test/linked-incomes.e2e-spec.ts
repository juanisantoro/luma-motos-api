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
import { IncomesController } from '../src/incomes/incomes.controller';
import { IncomesService } from '../src/incomes/incomes.service';
import { CreditPlansController } from '../src/credit-plans/credit-plans.controller';
import { CreditPlansService } from '../src/credit-plans/credit-plans.service';
import { SalesController } from '../src/sales/sales.controller';
import { SalesService } from '../src/sales/sales.service';

const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
const operationId = '7d5cc401-544e-4651-9bd6-52495887fecd';
const incomeId = '0e0e0e0e-0000-4000-8000-000000000001';
const componentId = 'd0c0a0b0-0000-4000-8000-00000000c001';
const uuid = (suffix: string) => `11b5de9b-9bc2-4777-bb78-9c7267b7${suffix}`;

let permissions: string[] = [];

const actor = (): AuthenticatedUser => ({
  id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
  email: 'admin@luma.test',
  name: 'Admin',
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
    code: 'ADMINISTRADOR',
    name: 'Administrador',
    system: true,
    permissions,
  },
  branch: null,
});

type Payload = Record<string, unknown>;
const method = (result: unknown) =>
  jest
    .fn<Promise<unknown>, [unknown, ...unknown[]]>()
    .mockResolvedValue(result);
const sales = {
  tracking: method({ items: [], total: 0, page: 1, limit: 50 }),
  collectPaymentComponent: method({ id: operationId }),
  markFinancingPayment: method({ id: operationId }),
  revertFinancingPayment: method({ id: operationId }),
};
const credits = { payInstallment: method({ id: 'installment' }) };
const incomes = {
  handoverRecipients: method([]),
  confirmHandover: method({ id: incomeId }),
  create: method({ id: incomeId }),
};

@Module({
  controllers: [SalesController, IncomesController, CreditPlansController],
  providers: [
    { provide: SalesService, useValue: sales },
    { provide: CreditPlansService, useValue: credits },
    { provide: IncomesService, useValue: incomes },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: MutationAuditGuard },
  ],
})
class LinkedIncomesTestModule implements NestModule {
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

describe('Linked incomes, cash handover and operation tracking (e2e)', () => {
  let app: INestApplication<App>;

  const collection = {
    idempotencyKey: uuid('0001'),
    accountId: uuid('0002'),
    amount: '150000.00',
    collectionDate: '2026-09-29',
    paymentMethod: 'EFECTIVO',
    handoverToId: uuid('0003'),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [LinkedIncomesTestModule],
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
      'ingresos.consultar',
      'ingresos.cobrar',
      'caja.recibir_rendicion',
    ];
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /sales/operations/tracking', () => {
    it('parses the computed filters', async () => {
      await request(app.getHttpServer())
        .get('/api/sales/operations/tracking')
        .query({
          vehicleType: 'MOTO',
          withBalance: 'true',
          withPendingCash: 'false',
          branchId: uuid('0004'),
          from: '2026-09-01',
          to: '2026-09-30',
        })
        .expect(200);
      expect(sales.tracking.mock.calls[0]?.[0]).toMatchObject({
        vehicleType: 'MOTO',
        withBalance: true,
        withPendingCash: false,
        branchId: uuid('0004'),
      });
    });

    it('requires ingresos.consultar besides ventas.consultar', async () => {
      permissions = ['ventas.consultar'];
      await request(app.getHttpServer())
        .get('/api/sales/operations/tracking')
        .query({ vehicleType: 'MOTO' })
        .expect(403);
      expect(sales.tracking).not.toHaveBeenCalled();
    });
  });

  describe('POST /sales/operations/:id/payment-components/:componentId/collections', () => {
    it('registers the collection of a component', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/sales/operations/${operationId}/payment-components/${componentId}/collections`,
        )
        .send(collection)
        .expect(201);
      expect(sales.collectPaymentComponent).toHaveBeenCalledWith(
        operationId,
        componentId,
        expect.objectContaining({
          paymentMethod: 'EFECTIVO',
          handoverToId: uuid('0003'),
        }),
        expect.anything(),
      );
    });

    it('requires ingresos.cobrar', async () => {
      permissions = ['ventas.consultar', 'ingresos.consultar'];
      await request(app.getHttpServer())
        .post(
          `/api/sales/operations/${operationId}/payment-components/${componentId}/collections`,
        )
        .send(collection)
        .expect(403);
    });

    it('rejects unknown fields and invalid methods', async () => {
      const withUnknown: Payload = { ...collection, clientId: uuid('0009') };
      await request(app.getHttpServer())
        .post(
          `/api/sales/operations/${operationId}/payment-components/${componentId}/collections`,
        )
        .send(withUnknown)
        .expect(400);
      await request(app.getHttpServer())
        .post(
          `/api/sales/operations/${operationId}/payment-components/${componentId}/collections`,
        )
        .send({ ...collection, paymentMethod: 'CHEQUE' })
        .expect(400);
      expect(sales.collectPaymentComponent).not.toHaveBeenCalled();
    });
  });

  describe('financiera pagó (sin monto)', () => {
    const path = `/api/sales/operations/${operationId}/payment-components/${componentId}/financing-payment`;

    it('marca con observación opcional y exige ingresos.cobrar', async () => {
      await request(app.getHttpServer())
        .post(path)
        .send({ notes: 'Liquidación 12' })
        .expect(201);
      expect(sales.markFinancingPayment).toHaveBeenCalledWith(
        operationId,
        componentId,
        { notes: 'Liquidación 12' },
        expect.anything(),
      );

      permissions = ['ventas.consultar', 'ingresos.consultar'];
      await request(app.getHttpServer()).post(path).send({}).expect(403);
    });

    it('no acepta un monto: la marca es sin importe', async () => {
      await request(app.getHttpServer())
        .post(path)
        .send({ amount: '1000.00' })
        .expect(400);
      expect(sales.markFinancingPayment).not.toHaveBeenCalled();
    });

    it('desmarcar exige motivo', async () => {
      await request(app.getHttpServer())
        .post(`${path}/revert`)
        .send({})
        .expect(400);
      await request(app.getHttpServer())
        .post(`${path}/revert`)
        .send({ reason: 'Operación equivocada' })
        .expect(201);
      expect(sales.revertFinancingPayment).toHaveBeenCalled();
    });

    it('filtra la grilla por financiera pendiente de pago', async () => {
      await request(app.getHttpServer())
        .get('/api/sales/operations/tracking')
        .query({ vehicleType: 'MOTO', withFinancingPending: 'true' })
        .expect(200);
      expect(sales.tracking.mock.calls[0]?.[0]).toMatchObject({
        withFinancingPending: true,
      });
    });
  });

  describe('cobro de cuota del crédito propio', () => {
    const path = `/api/credit-plans/installments/${uuid('0010')}/pay`;
    const valid = {
      amount: 55000,
      paymentDate: '2026-09-29',
      idempotencyKey: uuid('0011'),
      accountId: uuid('0002'),
      paymentMethod: 'EFECTIVO',
      handoverToId: uuid('0003'),
    };

    it('pide cuenta, medio e idempotencia', async () => {
      permissions = ['creditos.consultar', 'creditos.cobrar'];
      await request(app.getHttpServer()).post(path).send(valid).expect(201);
      expect(credits.payInstallment).toHaveBeenCalledWith(
        uuid('0010'),
        expect.objectContaining({
          accountId: uuid('0002'),
          paymentMethod: 'EFECTIVO',
          handoverToId: uuid('0003'),
        }),
        expect.anything(),
      );

      const withoutAccount: Payload = { ...valid };
      delete withoutAccount.accountId;
      await request(app.getHttpServer())
        .post(path)
        .send(withoutAccount)
        .expect(400);
    });
  });

  describe('cash handover', () => {
    it('lists the recipients with ingresos.consultar', async () => {
      permissions = ['ingresos.consultar'];
      await request(app.getHttpServer())
        .get('/api/incomes/cash-handover/recipients')
        .expect(200);
      expect(incomes.handoverRecipients).toHaveBeenCalled();
    });

    it('confirms only with caja.recibir_rendicion', async () => {
      await request(app.getHttpServer())
        .post(`/api/incomes/${incomeId}/cash-handover/confirm`)
        .send({ expectedVersion: 3 })
        .expect(201);
      expect(incomes.confirmHandover).toHaveBeenCalledWith(
        incomeId,
        { expectedVersion: 3 },
        expect.anything(),
      );

      permissions = ['ingresos.consultar', 'ingresos.cobrar'];
      await request(app.getHttpServer())
        .post(`/api/incomes/${incomeId}/cash-handover/confirm`)
        .send({ expectedVersion: 3 })
        .expect(403);
    });

    it('requires expectedVersion to confirm', async () => {
      await request(app.getHttpServer())
        .post(`/api/incomes/${incomeId}/cash-handover/confirm`)
        .send({})
        .expect(400);
    });

    it('accepts the cash fields when creating an income', async () => {
      permissions = ['ingresos.consultar', 'ingresos.gestionar'];
      await request(app.getHttpServer())
        .post('/api/incomes')
        .send({
          branchId: uuid('0004'),
          incomeDate: '2026-09-29',
          type: 'Seña',
          description: 'Seña de la operación',
          totalAmount: '50000.00',
          operationId,
          paymentMethod: 'EFECTIVO',
          collectedById: uuid('0005'),
          handoverToId: uuid('0003'),
        })
        .expect(201);
      expect(incomes.create.mock.calls[0]?.[0]).toMatchObject({
        paymentMethod: 'EFECTIVO',
        collectedById: uuid('0005'),
        handoverToId: uuid('0003'),
      });
    });
  });
});

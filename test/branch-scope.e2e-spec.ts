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
import { CashController } from '../src/cash/cash.controller';
import { CashService } from '../src/cash/cash.service';
import { ExpensesController } from '../src/expenses/expenses.controller';
import { ExpensesService } from '../src/expenses/expenses.service';
import { IncomesController } from '../src/incomes/incomes.controller';
import { IncomesService } from '../src/incomes/incomes.service';
import {
  InventoryBranchesController,
  InventoryController,
} from '../src/inventory/inventory.controller';
import { InventoryService } from '../src/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SalesController } from '../src/sales/sales.controller';
import { SalesService } from '../src/sales/sales.service';
import { SupplierPurchasesController } from '../src/supplier-purchases/supplier-purchases.controller';
import { SupplierPurchasesService } from '../src/supplier-purchases/supplier-purchases.service';
import { SupplyController } from '../src/supply/supply.controller';
import { SupplyService } from '../src/supply/supply.service';

const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
const sanMiguel = {
  id: '84e778cc-7616-4792-b6db-d89f100bb6f1',
  code: 'SAN_MIGUEL',
  name: 'San Miguel',
};
const delViso = {
  id: '94e778cc-7616-4792-b6db-d89f100bb6f2',
  code: 'DEL_VISO',
  name: 'Del Viso',
};
const delVisoOperationId = '7d5cc401-544e-4651-9bd6-52495887fecd';

function actor(
  roleCode: string,
  permissions: string[],
  branchScope: AuthenticatedUser['branchScope'],
): AuthenticatedUser {
  return {
    id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
    email: `${roleCode.toLowerCase()}@luma.test`,
    name: roleCode,
    active: true,
    globalAccess: false,
    organization: {
      id: organizationId,
      code: 'LUMA_CENTRAL',
      name: 'Luma',
      type: 'CASA_CENTRAL',
    },
    role: {
      id: '4bd1189b-2bb1-4258-889b-4500de5eeade',
      code: roleCode,
      name: roleCode,
      system: true,
      permissions,
    },
    branch: branchScope?.allBranches ? null : sanMiguel,
    branchScope,
  };
}

const sanMiguelOnly = { allBranches: false, branches: [sanMiguel] };
const administrativaSanMiguel = actor(
  'ADMINISTRATIVA',
  ['ventas.consultar', 'ventas.gestionar', 'ingresos.gestionar'],
  sanMiguelOnly,
);
const vendedorSanMiguel = actor(
  'VENDEDOR',
  ['ventas.consultar', 'ventas.gestionar'],
  sanMiguelOnly,
);
const administrador = actor(
  'ADMINISTRADOR',
  ['ventas.consultar', 'ventas.gestionar', 'sucursales.todas'],
  { allBranches: true, branches: [] },
);

let currentActor: AuthenticatedUser = administrativaSanMiguel;

@Module({
  controllers: [
    SalesController,
    IncomesController,
    ExpensesController,
    CashController,
    InventoryController,
    InventoryBranchesController,
    SupplyController,
    SupplierPurchasesController,
  ],
  providers: [
    SalesService,
    IncomesService,
    ExpensesService,
    CashService,
    InventoryService,
    SupplyService,
    SupplierPurchasesService,
    { provide: PrismaService, useValue: {} },
    { provide: AuditService, useValue: {} },
  ],
})
class BranchScopeTestModule implements NestModule {
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
            user: currentActor,
          };
          next();
        },
      )
      .forRoutes('*');
  }
}

type PrismaCall = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

function firstArg(mock: jest.Mock): PrismaCall {
  return (mock.mock.calls as PrismaCall[][])[0]?.[0] ?? { where: {}, data: {} };
}

describe('Branch scope (e2e)', () => {
  let app: INestApplication<App>;
  const operationsFindMany = jest.fn();
  const operationsFindFirst = jest.fn();
  const operationsCreate = jest.fn();
  const incomesFindMany = jest.fn();
  const incomesCreate = jest.fn();
  const expensesCreate = jest.fn();
  const branchesFindMany = jest.fn();
  const unitsCreate = jest.fn();
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ exists: true }]),
    operaciones: {
      count: jest.fn().mockResolvedValue(0),
      findMany: operationsFindMany,
      findFirst: operationsFindFirst,
      create: operationsCreate,
    },
    ingresos: {
      count: jest.fn().mockResolvedValue(0),
      findMany: incomesFindMany,
      create: incomesCreate,
    },
    gastos: { create: expensesCreate },
    sucursales: {
      findFirst: jest.fn().mockResolvedValue({ id: sanMiguel.id }),
      findMany: branchesFindMany,
    },
    unidades_vehiculos: { create: unitsCreate },
    personal: {
      findFirst: jest.fn().mockResolvedValue({ id: 'personal' }),
    },
  } as unknown as Prisma.TransactionClient;
  const withTenant = jest
    .fn()
    .mockImplementation(
      (
        _scope: unknown,
        work: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => work(transaction),
    );
  const execute = jest
    .fn()
    .mockImplementation(
      (
        _event: unknown,
        work: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => work(transaction),
    );

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [BranchScopeTestModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ withTenant })
      .overrideProvider(AuditService)
      .useValue({ execute })
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
    currentActor = administrativaSanMiguel;
    jest.clearAllMocks();
    operationsFindMany.mockResolvedValue([]);
    incomesFindMany.mockResolvedValue([]);
    branchesFindMany.mockResolvedValue([]);
    // The database would not match a Del Viso operation once the San Miguel
    // filter is part of the query: the test asserts that filter below.
    operationsFindFirst.mockResolvedValue(null);
  });

  afterAll(async () => {
    await app.close();
  });

  const expectOutOfScope = (body: unknown) =>
    expect(body).toMatchObject({
      statusCode: 403,
      code: 'BRANCH_OUT_OF_SCOPE',
      details: { branchId: delViso.id },
    });

  describe('administrativa de San Miguel', () => {
    it('lists sales operations filtered to San Miguel in SQL', async () => {
      await request(app.getHttpServer())
        .get('/api/sales/operations?vehicleType=MOTO')
        .expect(200);
      expect(firstArg(operationsFindMany).where.sucursal_id).toEqual({
        in: [sanMiguel.id],
      });
    });

    it('cannot list Del Viso operations', async () => {
      await request(app.getHttpServer())
        .get(`/api/sales/operations?vehicleType=MOTO&branchId=${delViso.id}`)
        .expect(403)
        .expect(({ body }) => expectOutOfScope(body));
      expect(withTenant).not.toHaveBeenCalled();
    });

    it('cannot list Del Viso incomes', async () => {
      await request(app.getHttpServer())
        .get(`/api/incomes?branchId=${delViso.id}`)
        .expect(403)
        .expect(({ body }) => expectOutOfScope(body));
      expect(withTenant).not.toHaveBeenCalled();
    });

    it('lists incomes of San Miguel only by default', async () => {
      await request(app.getHttpServer()).get('/api/incomes').expect(200);
      expect(firstArg(incomesFindMany).where.sucursal_id).toEqual({
        in: [sanMiguel.id],
      });
    });

    it('only receives San Miguel in the branch selector lookup', async () => {
      branchesFindMany.mockResolvedValue([
        {
          id: sanMiguel.id,
          codigo: sanMiguel.code,
          nombre: sanMiguel.name,
          organizacion_id: organizationId,
        },
      ]);
      await request(app.getHttpServer())
        .get('/api/inventory/branches')
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual([
            {
              id: sanMiguel.id,
              code: sanMiguel.code,
              name: sanMiguel.name,
              organizationId,
              inScope: true,
            },
          ]);
        });
      expect(firstArg(branchesFindMany).where.id).toEqual({
        in: [sanMiguel.id],
      });
    });

    it.each([
      [
        'a sales operation',
        '/api/sales/operations',
        {
          vehicleType: 'MOTO',
          branchId: delViso.id,
          clientId: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
          versionId: '4de88c4c-3382-4f9b-ae60-98147159c977',
          condition: 'NUEVO',
          unitId: 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2',
          agreedPrice: 100,
          paymentPlatform: 'EFECTIVO',
          licensingMode: 'BONIFICADA',
        },
      ],
      [
        'an income',
        '/api/incomes',
        {
          branchId: delViso.id,
          incomeDate: '2026-09-01',
          type: 'OTRO',
          description: 'Casco',
          totalAmount: '100.00',
        },
      ],
      [
        'an expense',
        '/api/expenses',
        {
          branchId: delViso.id,
          expenseDate: '2026-09-01',
          category: 'GESTORIA',
          reference: 'TT-1',
          description: 'Informe',
          totalAmount: '100.00',
          paidBy: 'Caja',
          status: 'PENDIENTE',
          recovered: false,
          month: 9,
          year: 2026,
        },
      ],
      [
        'a cash account',
        '/api/cash/accounts',
        {
          branchId: delViso.id,
          code: 'CAJA_DV',
          name: 'Caja Del Viso',
          type: 'CAJA',
        },
      ],
      [
        'an inventory unit',
        '/api/inventory/units',
        {
          branchId: delViso.id,
          versionId: '4de88c4c-3382-4f9b-ae60-98147159c977',
          vin: '9C2JC4110CR000001',
          condition: 'NUEVO',
          acquisitionOrigin: 'PROVEEDOR',
        },
      ],
      [
        'a supply request',
        '/api/supply-requests',
        {
          arrivalBranchId: delViso.id,
          supplierId: '5de88c4c-3382-4f9b-ae60-98147159c977',
          supplierAvailabilityId: '6de88c4c-3382-4f9b-ae60-98147159c977',
          versionId: '4de88c4c-3382-4f9b-ae60-98147159c977',
          condition: 'NUEVO',
        },
      ],
      [
        'a supplier purchase',
        '/api/supplier-purchases',
        {
          branchId: delViso.id,
          purchaseDate: '2026-09-01',
          supplierId: '5de88c4c-3382-4f9b-ae60-98147159c977',
          versionId: '4de88c4c-3382-4f9b-ae60-98147159c977',
          baseAmount: '100.00',
        },
      ],
    ])('cannot create %s for Del Viso', async (_label, path, payload) => {
      await request(app.getHttpServer())
        .post(path)
        .send(payload)
        .expect(403)
        .expect(({ body }) => expectOutOfScope(body));
      expect(execute).not.toHaveBeenCalled();
      expect(withTenant).not.toHaveBeenCalled();
    });

    it('assumes San Miguel when an expense omits the branch', async () => {
      expensesCreate.mockRejectedValue(new Error('stop after capture'));
      await request(app.getHttpServer()).post('/api/expenses').send({
        expenseDate: '2026-09-01',
        category: 'GESTORIA',
        reference: 'TT-1',
        description: 'Informe',
        totalAmount: '100.00',
        paidBy: 'Caja',
        status: 'PENDIENTE',
        recovered: false,
        month: 9,
        year: 2026,
      });
      expect(firstArg(expensesCreate).data.sucursal_id).toBe(sanMiguel.id);
    });

    it('assumes San Miguel when an income omits the branch', async () => {
      incomesCreate.mockRejectedValue(new Error('stop after capture'));
      await request(app.getHttpServer()).post('/api/incomes').send({
        incomeDate: '2026-09-01',
        type: 'OTRO',
        description: 'Casco',
        totalAmount: '100.00',
      });
      expect(firstArg(incomesCreate).data.sucursal_id).toBe(sanMiguel.id);
    });
  });

  describe('vendedor de San Miguel', () => {
    beforeEach(() => {
      currentActor = vendedorSanMiguel;
    });

    it('does not see an operation of another branch', async () => {
      await request(app.getHttpServer())
        .get(`/api/sales/operations/${delVisoOperationId}`)
        .expect(404);
      expect(firstArg(operationsFindFirst).where).toMatchObject({
        id: delVisoOperationId,
        sucursal_id: { in: [sanMiguel.id] },
      });
    });

    it('lists only operations of San Miguel', async () => {
      await request(app.getHttpServer())
        .get('/api/sales/operations?vehicleType=MOTO')
        .expect(200);
      expect(firstArg(operationsFindMany).where.sucursal_id).toEqual({
        in: [sanMiguel.id],
      });
    });

    it('cannot filter by Del Viso', async () => {
      await request(app.getHttpServer())
        .get(`/api/sales/operations?vehicleType=MOTO&branchId=${delViso.id}`)
        .expect(403)
        .expect(({ body }) => expectOutOfScope(body));
    });
  });

  describe('administrador with sucursales.todas', () => {
    beforeEach(() => {
      currentActor = administrador;
    });

    it('lists every branch without a branch filter', async () => {
      await request(app.getHttpServer())
        .get('/api/sales/operations?vehicleType=MOTO')
        .expect(200);
      expect(firstArg(operationsFindMany).where.sucursal_id).toBeUndefined();
    });

    it('may filter by Del Viso', async () => {
      await request(app.getHttpServer())
        .get(`/api/sales/operations?vehicleType=MOTO&branchId=${delViso.id}`)
        .expect(200);
      expect(firstArg(operationsFindMany).where.sucursal_id).toBe(delViso.id);
    });

    it('must choose a branch when creating (no single-branch default)', async () => {
      await request(app.getHttpServer())
        .post('/api/incomes')
        .send({
          incomeDate: '2026-09-01',
          type: 'OTRO',
          description: 'Casco',
          totalAmount: '100.00',
        })
        .expect(400)
        .expect(({ body }) => {
          expect(body).toMatchObject({ code: 'BRANCH_REQUIRED' });
        });
    });
  });
});

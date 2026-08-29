import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CashController } from '../src/cash/cash.controller';
import { CashService } from '../src/cash/cash.service';
import { ExpensesController } from '../src/expenses/expenses.controller';
import { ExpensesService } from '../src/expenses/expenses.service';
import { IncomesController } from '../src/incomes/incomes.controller';
import { IncomesService } from '../src/incomes/incomes.service';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { SupplierPurchasesController } from '../src/supplier-purchases/supplier-purchases.controller';
import { SupplierPurchasesService } from '../src/supplier-purchases/supplier-purchases.service';

@Injectable()
class HeaderPrincipalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: object;
    }>();
    const permissions = (request.headers['x-permissions'] ?? '')
      .split(',')
      .filter(Boolean);
    request.user = {
      user: {
        id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
        role: { permissions },
      },
    };
    return true;
  }
}

describe('Financial API permissions and DTOs (e2e)', () => {
  let app: INestApplication<App>;
  const page = { items: [], total: 0, page: 1, limit: 50 };
  const purchases = {
    findAll: jest.fn().mockResolvedValue(page),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    pay: jest.fn().mockResolvedValue({ id: 'purchase' }),
    reverse: jest.fn(),
  };
  const incomes = {
    findAll: jest.fn().mockResolvedValue(page),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    collect: jest.fn().mockResolvedValue({ id: 'income' }),
    reverse: jest.fn(),
  };
  const expenses = {
    findAll: jest.fn().mockResolvedValue(page),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    pay: jest.fn(),
    recover: jest.fn(),
    reverse: jest.fn(),
  };
  const cash = {
    findAccounts: jest.fn().mockResolvedValue(page),
    findAccount: jest.fn(),
    createAccount: jest.fn(),
    updateAccount: jest.fn(),
    findMovements: jest.fn().mockResolvedValue(page),
    findTransfers: jest.fn().mockResolvedValue(page),
    findTransfer: jest.fn(),
    createTransfer: jest.fn(),
    reverseTransfer: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        SupplierPurchasesController,
        IncomesController,
        ExpensesController,
        CashController,
      ],
      providers: [
        { provide: SupplierPurchasesService, useValue: purchases },
        { provide: IncomesService, useValue: incomes },
        { provide: ExpensesService, useValue: expenses },
        { provide: CashService, useValue: cash },
        Reflector,
        { provide: APP_GUARD, useClass: HeaderPrincipalGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => app.close());

  it('denies finance reads without their granular permission', async () => {
    await request(app.getHttpServer())
      .get('/api/supplier-purchases')
      .expect(403);
    await request(app.getHttpServer()).get('/api/incomes').expect(403);
    await request(app.getHttpServer()).get('/api/expenses').expect(403);
  });

  it('allows tenant-scoped lists with the matching read permission', async () => {
    await request(app.getHttpServer())
      .get('/api/supplier-purchases?page=1&limit=20')
      .set('x-permissions', 'compras.consultar')
      .expect(200);
    expect(purchases.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 }),
      expect.objectContaining({
        id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
      }),
    );
  });

  it('requires settlement permission and validates Decimal strings', async () => {
    const path =
      '/api/incomes/7d5cc401-544e-4651-9bd6-52495887fecd/collections';
    await request(app.getHttpServer())
      .post(path)
      .set('x-permissions', 'ingresos.consultar')
      .send({
        idempotencyKey: '3020ed1d-6a91-497b-b227-e5398974e6e4',
        accountId: 'ed533c59-526d-45e8-aed4-f909aaaf09f4',
        amount: '10.00',
      })
      .expect(403);
    await request(app.getHttpServer())
      .post(path)
      .set('x-permissions', 'ingresos.cobrar')
      .send({
        idempotencyKey: '3020ed1d-6a91-497b-b227-e5398974e6e4',
        accountId: 'ed533c59-526d-45e8-aed4-f909aaaf09f4',
        amount: 10,
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(path)
      .set('x-permissions', 'ingresos.cobrar')
      .send({
        idempotencyKey: '3020ed1d-6a91-497b-b227-e5398974e6e4',
        accountId: 'ed533c59-526d-45e8-aed4-f909aaaf09f4',
        amount: '10.00',
      })
      .expect(201);
  });

  it('reserves reversal endpoints for caja.reversar', async () => {
    const path =
      '/api/expenses/7d5cc401-544e-4651-9bd6-52495887fecd/movements/14b19aa6-08ae-4740-a954-79fa9e27c8a9/reverse';
    const body = {
      idempotencyKey: 'cb8d945e-b9ba-471a-a7a8-faa9b68202ca',
      reason: 'Corrección',
    };
    await request(app.getHttpServer())
      .post(path)
      .set('x-permissions', 'gastos.pagar')
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post(path)
      .set('x-permissions', 'caja.reversar')
      .send(body)
      .expect(201);
  });
});

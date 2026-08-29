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
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { CommissionsController } from '../src/commissions/commissions.controller';
import { CommissionsService } from '../src/commissions/commissions.service';

@Injectable()
class HeaderPrincipalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const httpRequest = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: object;
    }>();
    httpRequest.user = {
      user: {
        id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
        role: {
          permissions: (httpRequest.headers['x-permissions'] ?? '')
            .split(',')
            .filter(Boolean),
        },
      },
    };
    return true;
  }
}

describe('Commissions API permissions and DTOs (e2e)', () => {
  let app: INestApplication<App>;
  const page = { items: [], total: 0, page: 1, limit: 50 };
  const service = {
    suggestions: jest.fn().mockResolvedValue(page),
    suggestion: jest.fn(),
    agree: jest.fn().mockResolvedValue({ id: 'settlement' }),
    settlements: jest.fn().mockResolvedValue(page),
    pay: jest.fn().mockResolvedValue({ id: 'paid' }),
    history: jest.fn().mockResolvedValue(page),
    policies: jest.fn().mockResolvedValue(page),
    policy: jest.fn(),
    createPolicy: jest.fn(),
    updatePolicy: jest.fn(),
    activatePolicy: jest.fn(),
    deactivatePolicy: jest.fn(),
    me: jest.fn().mockResolvedValue({ progress: {}, paidHistory: page }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CommissionsController],
      providers: [
        { provide: CommissionsService, useValue: service },
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

  it('requires commission read permission and a single vehicle type', async () => {
    await request(app.getHttpServer())
      .get('/api/commissions/suggestions?period=2026-08&vehicleType=MOTO')
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/commissions/suggestions?period=2026-08')
      .set('x-permissions', 'comisiones.consultar')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/commissions/suggestions?period=2026-08&vehicleType=AUTO')
      .set('x-permissions', 'comisiones.consultar')
      .expect(200);
    expect(service.suggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        period: '2026-08',
        vehicleType: 'AUTO',
        page: 1,
        limit: 50,
      }),
      expect.any(Object),
    );
  });

  it('accepts suggestions for all branches or one UUID branch', async () => {
    const branchId = '84e778cc-7616-4792-b6db-d89f100bb6f1';
    await request(app.getHttpServer())
      .get('/api/commissions/suggestions?period=2026-08&vehicleType=MOTO')
      .set('x-permissions', 'comisiones.consultar')
      .expect(200);
    expect(service.suggestions).toHaveBeenLastCalledWith(
      expect.objectContaining({ branchId: undefined }),
      expect.any(Object),
    );
    await request(app.getHttpServer())
      .get(
        `/api/commissions/suggestions?period=2026-08&vehicleType=MOTO&branchId=${branchId}`,
      )
      .set('x-permissions', 'comisiones.consultar')
      .expect(200);
    expect(service.suggestions).toHaveBeenLastCalledWith(
      expect.objectContaining({ branchId }),
      expect.any(Object),
    );
  });

  it('does not accept seller scope input on the own commissions endpoint', async () => {
    await request(app.getHttpServer())
      .get(
        '/api/commissions/me?period=2026-08&vehicleType=MOTO&sellerId=7d5cc401-544e-4651-9bd6-52495887fecd',
      )
      .set('x-permissions', 'comisiones.propias')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/commissions/me?period=2026-08&vehicleType=MOTO')
      .set('x-permissions', 'comisiones.propias')
      .expect(200);
  });

  it('separates agreement and payment permissions', async () => {
    const agreementPath = '/api/commissions/suggestions/snapshot/agreement';
    await request(app.getHttpServer())
      .put(agreementPath)
      .set('x-permissions', 'comisiones.consultar')
      .send({
        agreedAmount: '45000.00',
        meetingDate: '2026-08-29',
      })
      .expect(403);
    await request(app.getHttpServer())
      .put(agreementPath)
      .set('x-permissions', 'comisiones.acordar')
      .send({
        agreedAmount: '45000.00',
        meetingDate: '2026-08-29',
      })
      .expect(200);

    const paymentPath =
      '/api/commissions/settlements/7d5cc401-544e-4651-9bd6-52495887fecd/payments';
    const payment = {
      idempotencyKey: '3020ed1d-6a91-497b-b227-e5398974e6e4',
      expectedVersion: 0,
      accountId: 'ed533c59-526d-45e8-aed4-f909aaaf09f4',
      paidAt: '2026-08-29T15:00:00.000Z',
      reference: 'TRX-123',
    };
    await request(app.getHttpServer())
      .post(paymentPath)
      .set('x-permissions', 'comisiones.acordar')
      .send(payment)
      .expect(403);
    await request(app.getHttpServer())
      .post(paymentPath)
      .set('x-permissions', 'comisiones.pagar')
      .send({ ...payment, amount: '1.00' })
      .expect(400);
    await request(app.getHttpServer())
      .post(paymentPath)
      .set('x-permissions', 'comisiones.pagar')
      .send(payment)
      .expect(201);
  });
});

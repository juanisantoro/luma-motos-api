import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const queryRaw = jest.fn();
  let service: HealthService;

  beforeEach(async () => {
    queryRaw.mockReset();

    const module = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: { $queryRaw: queryRaw },
        },
      ],
    }).compile();

    service = module.get(HealthService);
  });

  it('reports the application and database as available', async () => {
    queryRaw.mockResolvedValue([{ result: 1 }]);

    await expect(service.check()).resolves.toMatchObject({
      status: 'ok',
      checks: {
        application: 'up',
        database: 'up',
      },
    });
  });

  it('returns a sanitized unavailable response when the database is down', async () => {
    queryRaw.mockRejectedValue(
      new Error('postgresql://user:secret@private-host/database'),
    );
    const healthCheck = service.check();

    await expect(healthCheck).rejects.toMatchObject({
      response: {
        status: 'error',
        checks: {
          application: 'up',
          database: 'down',
        },
      },
    });
    await expect(healthCheck).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

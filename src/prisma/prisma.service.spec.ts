import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { EnvironmentVariables } from '../config/environment';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('keeps tenant transactions alive beyond Prisma default for Neon cold starts', async () => {
    jest.useFakeTimers();
    const values = {
      PRISMA_TRANSACTION_MAX_WAIT_MS: 10_000,
      PRISMA_TRANSACTION_TIMEOUT_MS: 30_000,
    };
    const config = {
      get: jest.fn((key: keyof typeof values): number => values[key]),
    } as unknown as ConfigService<EnvironmentVariables, true>;
    const service = new PrismaService(config);
    const transactionClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ configured: true }]),
    } as unknown as Prisma.TransactionClient;
    const transaction = jest.fn(
      async (
        operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ): Promise<unknown> => operation(transactionClient),
    );
    service.$transaction = transaction as typeof service.$transaction;

    const result = service.withTenant(
      {
        organizationId: '8fa94171-13b3-40b5-8c33-1f7d8ea94c75',
        globalAccess: false,
      },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5_100));
        return 'completed';
      },
    );

    await jest.advanceTimersByTimeAsync(5_100);
    await expect(result).resolves.toBe('completed');
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 30_000,
    });
    jest.useRealTimers();
  });
});

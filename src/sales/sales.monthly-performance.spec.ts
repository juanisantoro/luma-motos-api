import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CashService } from '../cash/cash.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SalesService } from './sales.service';

// "Ventas del mes": el mes pedido contra el anterior a ese.
describe('SalesService monthlyPerformance', () => {
  const service = new SalesService(
    {} as PrismaService,
    {} as AuditService,
    {} as CashService,
  );
  const periodPerformance = jest.fn();
  const actor = {} as AuthenticatedUser;

  beforeEach(() => {
    periodPerformance.mockReset();
    periodPerformance.mockImplementation((_actor: unknown, period: string) =>
      Promise.resolve({ units: period === '2026-09' ? 3 : 1, amount: 0 }),
    );
    (service as unknown as { periodPerformance: jest.Mock }).periodPerformance =
      periodPerformance;
  });

  it('compares the requested month with the one before it', async () => {
    const result = await service.monthlyPerformance(actor, {
      branchId: 'b1',
      period: '2026-09',
    });

    expect(result).toEqual({
      period: '2026-09',
      currentMonth: { units: 3, amount: 0 },
      previousMonth: { units: 1, amount: 0 },
    });
    expect(periodPerformance).toHaveBeenCalledWith(actor, '2026-09', {
      branchId: 'b1',
    });
    expect(periodPerformance).toHaveBeenCalledWith(actor, '2026-08', {
      branchId: 'b1',
    });
  });

  it('crosses the year boundary', async () => {
    await service.monthlyPerformance(actor, { period: '2026-01' });

    expect(periodPerformance).toHaveBeenCalledWith(actor, '2025-12', {});
  });

  it('uses the current month when no period is given', async () => {
    const now = new Date();
    const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    const result = await service.monthlyPerformance(actor);

    expect(result.period).toBe(current);
  });
});

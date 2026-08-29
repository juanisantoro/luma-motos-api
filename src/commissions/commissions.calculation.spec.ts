/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import { luma_estado_operacion, Prisma } from '@prisma/client';
import {
  calculateFixedCommission,
  commissionOperationEligibility,
  commissionPriceComparison,
  CommissionTierValue,
  validateCommissionTiers,
} from './commissions.calculation';

describe('Commission calculation', () => {
  const tiers: CommissionTierValue[] = [
    {
      id: 'tier-1',
      minUnits: 1,
      maxUnits: 5,
      fixedAmount: '35000.00',
      validFrom: '2000-01-01',
      validTo: null,
    },
    {
      id: 'tier-2',
      minUnits: 6,
      maxUnits: 10,
      fixedAmount: '40000.00',
      validFrom: '2000-01-01',
      validTo: null,
    },
    {
      id: 'tier-3',
      minUnits: 11,
      maxUnits: 15,
      fixedAmount: '45000.00',
      validFrom: '2000-01-01',
      validTo: null,
    },
    {
      id: 'tier-4',
      minUnits: 16,
      maxUnits: null,
      fixedAmount: '50000.00',
      validFrom: '2000-01-01',
      validTo: null,
    },
  ];

  it.each([
    [1, '35000.00'],
    [5, '35000.00'],
    [6, '40000.00'],
    [10, '40000.00'],
    [11, '45000.00'],
    [15, '45000.00'],
    [16, '50000.00'],
  ])('applies the inclusive tier boundary for %i sales', (count, amount) => {
    expect(calculateFixedCommission(tiers, count).suggestedAmount).toBe(amount);
  });

  it('returns one fixed total and never multiplies it by sales', () => {
    const result = calculateFixedCommission(tiers, 13);
    expect(result.suggestedAmount).toBe('45000.00');
    expect(result.suggestedAmount).not.toBe('585000.00');
  });

  it('reports the next tier and missing sales', () => {
    expect(calculateFixedCommission(tiers, 5)).toMatchObject({
      nextScale: { minUnits: 6 },
      unitsToNextScale: 1,
    });
    expect(calculateFixedCommission(tiers, 16)).toMatchObject({
      nextScale: null,
      unitsToNextScale: null,
    });
  });

  it.each([
    [
      [
        { minUnits: 2, maxUnits: 5, fixedAmount: '1' },
        { minUnits: 6, maxUnits: null, fixedAmount: '2' },
      ],
    ],
    [
      [
        { minUnits: 1, maxUnits: 5, fixedAmount: '1' },
        { minUnits: 7, maxUnits: null, fixedAmount: '2' },
      ],
    ],
    [
      [
        { minUnits: 1, maxUnits: null, fixedAmount: '1' },
        { minUnits: 2, maxUnits: null, fixedAmount: '2' },
      ],
    ],
    [[{ minUnits: 1, maxUnits: null, fixedAmount: '-1' }]],
  ])('rejects invalid tier ranges', (invalid) => {
    expect(() => validateCommissionTiers(invalid)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'INVALID_COMMISSION_TIERS',
        }),
      }),
    );
  });

  it('counts only approved or closed operations', () => {
    expect(
      commissionOperationEligibility(luma_estado_operacion.APROBADA),
    ).toEqual({ computable: true, reason: 'ELIGIBLE_APPROVED' });
    expect(
      commissionOperationEligibility(luma_estado_operacion.CERRADA),
    ).toEqual({ computable: true, reason: 'ELIGIBLE_CLOSED' });
    for (const status of [
      luma_estado_operacion.BORRADOR,
      luma_estado_operacion.PENDIENTE_APROBACION,
      luma_estado_operacion.RECHAZADA,
      luma_estado_operacion.CANCELADA,
    ])
      expect(commissionOperationEligibility(status).computable).toBe(false);
  });

  it('keeps an approved below-list operation computable and highlights it', () => {
    expect(
      commissionPriceComparison(
        new Prisma.Decimal('100000'),
        new Prisma.Decimal('90000'),
      ),
    ).toEqual({ belowList: true, difference: '-10000.00' });
    expect(
      commissionOperationEligibility(luma_estado_operacion.APROBADA).computable,
    ).toBe(true);
  });
});

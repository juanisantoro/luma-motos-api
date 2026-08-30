import { Prisma } from '@prisma/client';
import {
  findEffectivePricePolicy,
  selectEffectivePricePolicy,
  toDateOnly,
} from './price-policy';

describe('price policy resolution', () => {
  it('keeps ISO date-only values on the same UTC calendar day', () => {
    expect(toDateOnly('2026-08-29').toISOString()).toBe(
      '2026-08-29T00:00:00.000Z',
    );
  });

  it('prefers a branch override and falls back to organization scope', () => {
    const organizationPolicy = { id: 'organization', sucursal_id: null };
    const branchPolicy = { id: 'branch', sucursal_id: 'branch-id' };

    expect(
      selectEffectivePricePolicy(
        [organizationPolicy, branchPolicy],
        'branch-id',
      ),
    ).toBe(branchPolicy);
    expect(
      selectEffectivePricePolicy(
        [organizationPolicy, branchPolicy],
        'other-branch',
      ),
    ).toBe(organizationPolicy);
  });

  it('uses the same branch then organization lookup for operations', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'organization-policy' });
    const transaction = {
      politicas_precios_vehiculos: { findFirst },
    } as unknown as Prisma.TransactionClient;

    await expect(
      findEffectivePricePolicy(transaction, {
        versionId: 'version-id',
        branchId: 'branch-id',
        organizationId: 'organization-id',
        at: '2026-08-29',
      }),
    ).resolves.toEqual({ id: 'organization-policy' });
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(findFirst.mock.calls[0])).toContain('"activa":true');
    expect(JSON.stringify(findFirst.mock.calls[0])).toContain(
      '"sucursal_id":"branch-id"',
    );
    expect(JSON.stringify(findFirst.mock.calls[0])).toContain(
      '"lte":"2026-08-29T00:00:00.000Z"',
    );
    expect(JSON.stringify(findFirst.mock.calls[1])).toContain(
      '"sucursal_id":null',
    );
  });
});

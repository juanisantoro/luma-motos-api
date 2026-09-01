import { luma_estado_operacion, Prisma } from '@prisma/client';
import { commissionBadRequest } from './commissions.errors';

export interface CommissionTierInput {
  minUnits: number;
  maxUnits: number | null;
  fixedAmount: string;
}

export interface CommissionTierValue extends CommissionTierInput {
  id: string;
  validFrom: string;
  validTo: string | null;
}

export interface CommissionCalculation {
  scale: CommissionTierValue | null;
  suggestedAmount: string;
  nextScale: CommissionTierValue | null;
  unitsToNextScale: number | null;
}

export function commissionOperationEligibility(status: luma_estado_operacion): {
  computable: boolean;
  reason: 'ELIGIBLE_APPROVED' | 'ELIGIBLE_CLOSED' | 'STATUS_NOT_ELIGIBLE';
} {
  if (status === luma_estado_operacion.APROBADA)
    return { computable: true, reason: 'ELIGIBLE_APPROVED' };
  if (status === luma_estado_operacion.CERRADA)
    return { computable: true, reason: 'ELIGIBLE_CLOSED' };
  return { computable: false, reason: 'STATUS_NOT_ELIGIBLE' };
}

export function commissionPriceComparison(
  listPrice: Prisma.Decimal | null,
  closingPrice: Prisma.Decimal,
): { difference: string | null; belowList: boolean } {
  return {
    difference: listPrice ? closingPrice.minus(listPrice).toFixed(2) : null,
    belowList: listPrice ? closingPrice.lessThan(listPrice) : false,
  };
}

export function validateCommissionTiers(tiers: CommissionTierInput[]): void {
  if (!tiers.length)
    commissionBadRequest(
      'INVALID_COMMISSION_TIERS',
      'At least one commission tier is required',
    );
  let expectedMinimum = 1;
  for (const [index, tier] of tiers.entries()) {
    if (!Number.isInteger(tier.minUnits) || tier.minUnits < 1)
      invalidTiers('Tier minimums must be positive integers');
    if (
      tier.maxUnits !== null &&
      (!Number.isInteger(tier.maxUnits) || tier.maxUnits < tier.minUnits)
    )
      invalidTiers(
        'Tier maximums must be null or integers greater than the minimum',
      );
    if (tier.minUnits !== expectedMinimum)
      invalidTiers('Commission tiers must be continuous and start at 1');
    if (new Prisma.Decimal(tier.fixedAmount).isNegative())
      invalidTiers('Commission tier amounts cannot be negative');
    const isLast = index === tiers.length - 1;
    if (isLast && tier.maxUnits !== null)
      invalidTiers('The last commission tier must be open-ended');
    if (!isLast && tier.maxUnits === null)
      invalidTiers('Only the last commission tier can be open-ended');
    if (tier.maxUnits !== null) expectedMinimum = tier.maxUnits + 1;
  }
}

export function calculateFixedCommission(
  tiers: CommissionTierValue[],
  computableSales: number,
): CommissionCalculation {
  if (!Number.isInteger(computableSales) || computableSales < 0)
    commissionBadRequest(
      'INVALID_COMPUTABLE_SALES',
      'Computable sales must be a non-negative integer',
    );
  const scale =
    tiers.find(
      (tier) =>
        computableSales >= tier.minUnits &&
        (tier.maxUnits === null || computableSales <= tier.maxUnits),
    ) ?? null;
  const scaleIndex = scale
    ? tiers.findIndex((tier) => tier.id === scale.id)
    : -1;
  const nextScale = scale
    ? (tiers[scaleIndex + 1] ?? null)
    : (tiers[0] ?? null);
  return {
    scale,
    suggestedAmount: scale
      ? new Prisma.Decimal(scale.fixedAmount).toFixed(2)
      : '0.00',
    nextScale,
    unitsToNextScale: nextScale
      ? Math.max(0, nextScale.minUnits - computableSales)
      : null,
  };
}

// --- Manager (GERENTE) commission: a new, separate calculation path. It
// never touches calculateFixedCommission's vendor behavior above; in ESCALA
// mode it simply reuses it with the manager's own computable-sales count.

export type ManagerCommissionMode = 'PORCENTAJE' | 'ESCALA';

export interface ManagerCommissionOperationInput {
  agreedPrice: string;
}

export interface ManagerCommissionResult {
  mode: ManagerCommissionMode;
  computableSales: number;
  totalClosingPrice: string;
  suggestedAmount: string;
  scale: CommissionTierValue | null;
  nextScale: CommissionTierValue | null;
  unitsToNextScale: number | null;
}

export function calculateManagerCommission(
  mode: ManagerCommissionMode,
  operations: ManagerCommissionOperationInput[],
  options: { percentage?: string | null; tiers?: CommissionTierValue[] },
): ManagerCommissionResult {
  const totalClosingPrice = operations.reduce(
    (sum, operation) => sum.plus(operation.agreedPrice),
    new Prisma.Decimal(0),
  );
  const computableSales = operations.length;

  if (mode === 'PORCENTAJE') {
    if (!options.percentage)
      commissionBadRequest(
        'INVALID_MANAGER_COMMISSION_CONFIG',
        'A percentage is required for PORCENTAJE mode',
      );
    const suggestedAmount = totalClosingPrice
      .times(new Prisma.Decimal(options.percentage))
      .dividedBy(100)
      .toFixed(2);
    return {
      mode,
      computableSales,
      totalClosingPrice: totalClosingPrice.toFixed(2),
      suggestedAmount,
      scale: null,
      nextScale: null,
      unitsToNextScale: null,
    };
  }

  if (!options.tiers)
    commissionBadRequest(
      'INVALID_MANAGER_COMMISSION_CONFIG',
      'Commission tiers are required for ESCALA mode',
    );
  const scaleResult = calculateFixedCommission(options.tiers, computableSales);
  return {
    mode,
    computableSales,
    totalClosingPrice: totalClosingPrice.toFixed(2),
    suggestedAmount: scaleResult.suggestedAmount,
    scale: scaleResult.scale,
    nextScale: scaleResult.nextScale,
    unitsToNextScale: scaleResult.unitsToNextScale,
  };
}

export function commissionPeriod(period: string): {
  period: string;
  from: Date;
  to: Date;
} {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
    commissionBadRequest(
      'INVALID_COMMISSION_PERIOD',
      'Commission period must use YYYY-MM',
    );
  const [year, month] = period.split('-').map(Number);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { period, from, to };
}

function invalidTiers(message: string): never {
  return commissionBadRequest('INVALID_COMMISSION_TIERS', message);
}

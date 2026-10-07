import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { FinancialPaymentStatus } from './finance.dto';
import { financialBadRequest } from './finance.errors';

export const COMPUTED_FILTER_SCAN_LIMIT = 10_000;

export function assertComputedFilterScanLimit(rowCount: number): void {
  if (rowCount > COMPUTED_FILTER_SCAN_LIMIT)
    financialBadRequest(
      'FILTER_RESULT_TOO_LARGE',
      'Computed financial filters require a narrower date or organization range',
    );
}

export function decimal(value: string): Prisma.Decimal {
  const result = new Prisma.Decimal(value);
  if (!result.isPositive()) {
    financialBadRequest('INVALID_AMOUNT', 'Amount must be greater than zero');
  }
  return result;
}

export function nonNegativeDecimal(value: string): Prisma.Decimal {
  const result = new Prisma.Decimal(value);
  if (result.isNegative()) {
    financialBadRequest('INVALID_AMOUNT', 'Amount cannot be negative');
  }
  return result;
}

export function businessDate(value: string): Date {
  const result = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(result.getTime()) ||
    result.toISOString().slice(0, 10) !== value
  ) {
    financialBadRequest('INVALID_BUSINESS_DATE', 'Business date is invalid');
  }
  return result;
}

export function paymentStatus(
  settled: Prisma.Decimal,
  total: Prisma.Decimal,
): FinancialPaymentStatus {
  if (settled.isZero()) return FinancialPaymentStatus.PENDIENTE;
  if (settled.greaterThanOrEqualTo(total)) return FinancialPaymentStatus.PAGADO;
  return FinancialPaymentStatus.PARCIAL;
}

export function databasePaymentStatus(status: FinancialPaymentStatus) {
  return status === FinancialPaymentStatus.PARCIAL ? 'PAGO_PARCIAL' : status;
}

export function stableHash(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function assertOrganization(
  actor: AuthenticatedUser,
  organizationId?: string,
): void {
  if (organizationId && !actor.globalAccess) {
    throw new ForbiddenException(
      'Only users with global access can select an organization',
    );
  }
}

export function scope(actor: AuthenticatedUser) {
  return {
    organizationId: actor.organization.id,
    globalAccess: actor.globalAccess,
  };
}

export function targetOrganization(
  actor: AuthenticatedUser,
  organizationId?: string,
) {
  return organizationId && organizationId !== actor.organization.id
    ? organizationId
    : undefined;
}

export interface CurrencyTotal {
  currency: string;
  amount: string;
}

// Suma de los importes de un listado, una entrada por moneda: pesos y
// dólares no se suman entre sí. Es el total de todo lo que trae el filtro,
// no sólo el de la página que se devuelve.
export function currencyTotals(
  rows: Array<{ moneda: string; importe: Prisma.Decimal | null }>,
): CurrencyTotal[] {
  const totals = new Map<string, Prisma.Decimal>();
  for (const row of rows)
    totals.set(
      row.moneda,
      (totals.get(row.moneda) ?? new Prisma.Decimal(0)).plus(row.importe ?? 0),
    );
  return [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) }));
}

export function groupedCurrencyTotals(
  groups: Array<{ moneda: string; _sum: { importe: Prisma.Decimal | null } }>,
): CurrencyTotal[] {
  return currencyTotals(
    groups.map((group) => ({
      moneda: group.moneda,
      importe: group._sum.importe,
    })),
  );
}

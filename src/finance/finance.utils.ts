import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { FinancialPaymentStatus } from './finance.dto';
import { financialBadRequest } from './finance.errors';

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

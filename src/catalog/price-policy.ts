import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function toDateOnly(value: Date | string): Date {
  if (typeof value === 'string') {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (dateOnly) {
      return new Date(
        Date.UTC(
          Number(dateOnly[1]),
          Number(dateOnly[2]) - 1,
          Number(dateOnly[3]),
        ),
      );
    }
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function previousDate(value: Date): Date {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() - 1);
  return date;
}

export function activePricePolicyWhere(
  versionId: string,
  organizationId: string,
  at: Date | string,
): Prisma.politicas_precios_vehiculosWhereInput {
  const day = toDateOnly(at);
  return {
    version_id: versionId,
    organizacion_id: organizationId,
    activa: true,
    vigente_desde: { lte: day },
    OR: [{ vigente_hasta: null }, { vigente_hasta: { gte: day } }],
  };
}

export async function findEffectivePricePolicy(
  tx: Prisma.TransactionClient,
  input: {
    versionId: string;
    branchId: string;
    organizationId: string;
    at: Date | string;
  },
) {
  const valid = activePricePolicyWhere(
    input.versionId,
    input.organizationId,
    input.at,
  );
  const branchPolicy = await tx.politicas_precios_vehiculos.findFirst({
    where: { ...valid, sucursal_id: input.branchId },
    orderBy: [{ vigente_desde: 'desc' }, { creado_en: 'desc' }],
  });
  return (
    branchPolicy ??
    tx.politicas_precios_vehiculos.findFirst({
      where: { ...valid, sucursal_id: null },
      orderBy: [{ vigente_desde: 'desc' }, { creado_en: 'desc' }],
    })
  );
}

export function selectEffectivePricePolicy<
  T extends { sucursal_id: string | null },
>(policies: T[], branchId?: string): T | undefined {
  if (branchId) {
    const branchPolicy = policies.find(
      (policy) => policy.sucursal_id === branchId,
    );
    if (branchPolicy) return branchPolicy;
  }
  return policies.find((policy) => policy.sucursal_id === null);
}

export function activePricePolicyRequired(
  versionId: string,
  branchId: string,
): BadRequestException {
  return new BadRequestException({
    code: 'ACTIVE_PRICE_POLICY_REQUIRED',
    message:
      'La versión seleccionada no tiene una política de precio activa para la sucursal. Configure precio de lista y mínimo antes de crear la operación.',
    versionId,
    branchId,
  });
}

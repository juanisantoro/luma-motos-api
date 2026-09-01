import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Shared by InventoryService (unidades_vehiculos.color), SupplyService
// (solicitudes_abastecimiento.color / receive-time color) and SalesService
// (the color requested when a sale creates a supply request) so the
// "is this a real color?" check against the colores_unidad lookup table
// lives in exactly one place instead of being copy-pasted per module.
export function normalizeUnitColorName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-AR');
}

export async function assertValidUnitColor(
  tx: Prisma.TransactionClient,
  color: string,
): Promise<void> {
  const normalized = normalizeUnitColorName(color);
  const rows = await tx.$queryRaw<Array<{ exists: boolean }>>(
    Prisma.sql`SELECT EXISTS(
      SELECT 1 FROM colores_unidad
      WHERE nombre_normalizado = ${normalized} AND activo = true
    ) AS "exists"`,
  );
  if (!rows[0]?.exists)
    throw new BadRequestException(
      `Color inválido: "${color}". Elegí uno de los colores disponibles.`,
    );
}

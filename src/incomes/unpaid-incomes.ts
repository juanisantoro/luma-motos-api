import { Prisma } from '@prisma/client';

/**
 * Ingresos sin cobrar del todo: lo cobrado (movimientos de ingreso vigentes,
 * sin revertir) no llega al importe. Sin transferencias entre cajas ni
 * importados que esperan conciliación. Es el mismo criterio de la lista,
 * así el inicio y la pantalla muestran lo mismo.
 */
export async function unpaidIncomeIds(
  tx: Prisma.TransactionClient,
  organizationId: string | undefined,
  branchSql: Prisma.Sql,
  branchId?: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT i."id"
    FROM "public"."ingresos" AS i
    WHERE (${organizationId ?? null}::uuid IS NULL OR i."organizacion_id" = ${organizationId ?? null}::uuid)
      AND ${branchSql}
      AND (${branchId ?? null}::uuid IS NULL OR i."sucursal_id" = ${branchId ?? null}::uuid)
      AND i."es_transferencia" = FALSE
      AND i."requiere_conciliacion" = FALSE
      AND i."importe" > COALESCE((
        SELECT SUM(m."importe")
        FROM "public"."movimientos_caja" AS m
        WHERE m."ingreso_id" = i."id"
          AND m."tipo_movimiento" = 'INGRESO'
          AND m."revierte_a_id" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "public"."movimientos_caja" AS r
            WHERE r."revierte_a_id" = m."id"
          )
      ), 0)
  `);
  return rows.map((row) => row.id);
}

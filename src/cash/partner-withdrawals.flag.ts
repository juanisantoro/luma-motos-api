import { Prisma } from '@prisma/client';

// Retiros de socios: el código está subido, pero la tabla `retiros_socio`
// (migración 20261005000000_partner_withdrawals) se aplica a mano. Hasta que
// exista, nada fuera del módulo de retiros la consulta, así las pantallas que
// ya estaban (Auditoría → Movimientos de dinero) siguen funcionando.
//
// No hay variable de entorno: se mira si la tabla existe. Una vez que está,
// no se vuelve a preguntar; mientras falta, se vuelve a mirar cada minuto,
// así alcanza con aplicar la migración (sin redesplegar).
const RECHECK_MS = 60_000;

let ready = false;
let checkedAt = 0;

export async function partnerWithdrawalsReady(
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  if (ready) return true;
  if (Date.now() - checkedAt < RECHECK_MS) return false;
  checkedAt = Date.now();
  try {
    // to_regclass devuelve NULL si la tabla no existe: no da error, así que
    // no corta la transacción en curso.
    const rows = await tx.$queryRaw<Array<{ exists: boolean }>>(
      Prisma.sql`SELECT to_regclass('retiros_socio') IS NOT NULL AS "exists"`,
    );
    ready = rows[0]?.exists === true;
  } catch {
    ready = false;
  }
  return ready;
}

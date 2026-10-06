import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { collectionDate, pickTarget } from './reassign-historic-collections';

/**
 * Pasa a una caja activa los pagos de egresos (gastos) que se cargaron en el
 * sistema sobre una cuenta histórica importada del Excel. Es el mismo arreglo
 * que `reassign-historic-collections.ts` hace con los cobros de ingresos.
 *
 * Los movimientos de caja son inmutables, así que cada pago se corrige como
 * lo haría una persona desde la pantalla: una reversa en la cuenta histórica
 * y el mismo movimiento, por el mismo importe, en la caja activa del mismo
 * socio, de la sucursal y la moneda del gasto. También mueve las
 * recuperaciones de gastos que hayan quedado en una cuenta histórica. Queda
 * registrado en la auditoría del gasto (EXPENSE_PAYMENT_REASSIGNED).
 *
 * Un gasto general (sin sucursal) sólo puede ir a una caja compartida (sin
 * sucursal) de ese socio; si no existe, queda en "NO SE MUEVEN".
 *
 * Un pago registrado al cargar el gasto pasa a tener la fecha del gasto.
 *
 * Por defecto NO cambia nada: lista qué movería y a dónde.
 *
 *   npm run caja:reasignar-egresos-historicos -- --actor-email admin@luma.com
 *   npm run caja:reasignar-egresos-historicos -- --actor-email admin@luma.com --apply
 *
 * Opciones (con sus valores por defecto):
 *   --user "Rosa"            quién registró el pago (parte del nombre)
 *   --branch "San Miguel"    sucursal del gasto (nombre o código); los gastos
 *                            generales de ese usuario se incluyen siempre
 *   --from 2026-10-01        desde, inclusive (día de Argentina)
 *   --to 2026-11-01          hasta, exclusive
 */

const prisma = new PrismaClient();

type Candidate = {
  movement_id: string;
  movement_type: 'INGRESO' | 'EGRESO';
  direction: 'CREDITO' | 'DEBITO';
  created_at: Date;
  occurred_at: Date;
  amount: Prisma.Decimal;
  reference: string | null;
  notes: string | null;
  registered_by_id: string;
  registered_by: string;
  historic_account_id: string;
  historic_name: string;
  historic_owner: string | null;
  expense_id: string;
  expense_category: string;
  expense_detail: string;
  expense_date: Date;
  expense_created_at: Date;
  branch_id: string | null;
  branch_name: string | null;
  currency: string;
};

type ActiveAccount = Parameters<typeof pickTarget>[1][number];

function day(value: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value);
}

function option(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function money(value: Prisma.Decimal, currency: string) {
  return `${currency} ${value.toFixed(2)}`;
}

/** Fecha con la que queda en caja el movimiento reasignado. */
export function paymentDate(candidate: Candidate): Date {
  return collectionDate({
    created_at: candidate.created_at,
    occurred_at: candidate.occurred_at,
    income_date: candidate.expense_date,
    income_created_at: candidate.expense_created_at,
  });
}

function kind(candidate: Candidate): string {
  return candidate.direction === 'DEBITO' ? 'PAGO' : 'RECUPERACIÓN';
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const actorEmail = option('actor-email');
  if (!actorEmail)
    throw new Error(
      'Falta --actor-email: el correo del usuario que hace la corrección.',
    );
  const user = option('user', 'Rosa') as string;
  const branch = option('branch', 'San Miguel') as string;
  const from = new Date(`${option('from', '2026-10-01')}T00:00:00.000-03:00`);
  const to = new Date(`${option('to', '2026-11-01')}T00:00:00.000-03:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    throw new Error('Las fechas --from / --to van como AAAA-MM-DD.');

  await prisma.$transaction(
    async (tx) => {
      // El usuario se busca con acceso global (todavía no se sabe su
      // organización); el resto corre acotado a esa organización.
      await tx.$queryRaw`
        SELECT
          set_config('app.organizacion_id', '00000000-0000-0000-0000-000000000000', true),
          set_config('app.acceso_global', 'true', true)
      `;
      const actor = await tx.usuarios.findFirst({
        where: {
          correo_normalizado: actorEmail.trim().toLowerCase(),
          activo: true,
        },
        select: {
          id: true,
          organizacion_id: true,
          personal: { select: { id: true, nombre_completo: true } },
        },
      });
      if (!actor?.personal)
        throw new Error(
          `No hay un usuario activo con personal asociado para ${actorEmail}.`,
        );
      const actorPersonnelId = actor.personal.id;
      const actorName = actor.personal.nombre_completo;
      const organizationId = actor.organizacion_id;
      await tx.$queryRaw`
        SELECT
          set_config('app.organizacion_id', ${organizationId}, true),
          set_config('app.acceso_global', 'false', true)
      `;

      const candidates = await tx.$queryRaw<Candidate[]>`
        SELECT
          m.id AS movement_id, m.tipo_movimiento::text AS movement_type,
          m.direccion::text AS direction, m.creado_en AS created_at,
          m.contabilizado_en AS occurred_at, m.importe AS amount,
          m.referencia AS reference, m.notas AS notes,
          p.id AS registered_by_id, p.nombre_completo AS registered_by,
          c.id AS historic_account_id, c.nombre AS historic_name,
          c.datos_inferidos ->> 'responsable_original' AS historic_owner,
          g.id AS expense_id, g.categoria AS expense_category,
          g.detalle AS expense_detail, g.fecha_generacion AS expense_date,
          g.creado_en AS expense_created_at,
          s.id AS branch_id, s.nombre AS branch_name, g.moneda AS currency
        FROM movimientos_caja m
        JOIN cuentas_caja c ON c.id = m.cuenta_caja_id
        JOIN gastos g ON g.id = m.gasto_id
        LEFT JOIN sucursales s ON s.id = g.sucursal_id
        JOIN personal p ON p.id = m.registrado_por_personal_id
        WHERE m.organizacion_id = CAST(${organizationId} AS uuid)
          AND c.es_importada
          AND NOT m.es_importado
          AND m.tipo_movimiento IN ('INGRESO', 'EGRESO')
          AND m.revierte_a_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM movimientos_caja r WHERE r.revierte_a_id = m.id
          )
          AND m.creado_en >= ${from} AND m.creado_en < ${to}
          AND p.nombre_completo ILIKE ${`%${user}%`}
          AND (
            s.id IS NULL
            OR s.nombre ILIKE ${`%${branch}%`}
            OR s.codigo ILIKE ${branch}
          )
        ORDER BY m.creado_en, m.id
        FOR UPDATE OF m
      `;

      const accounts = await tx.$queryRaw<ActiveAccount[]>`
        SELECT c.id, c.nombre AS name, c.tipo_cuenta::text AS type,
               c.sucursal_id AS branch_id, c.moneda AS currency,
               c.personal_responsable_id AS responsible_id,
               p.nombre_completo AS responsible_name
        FROM cuentas_caja c
        LEFT JOIN personal p ON p.id = c.personal_responsable_id
        WHERE c.organizacion_id = CAST(${organizationId} AS uuid)
          AND c.activo AND NOT c.es_importada
      `;

      console.log(
        `\nPagos de egresos de "${user}" en ${branch} (y generales), cargados entre ${from.toISOString()} y ${to.toISOString()}, que están en cuentas históricas: ${candidates.length}\n`,
      );

      const plan: Array<{ candidate: Candidate; target: ActiveAccount }> = [];
      const unresolved: Array<{ candidate: Candidate; reason: string }> = [];
      for (const candidate of candidates) {
        // Un gasto no guarda el medio de pago ni a quién se rinde: la caja
        // sale del socio dueño de la cuenta histórica.
        const result = pickTarget(
          {
            // Sin sucursal (gasto general) sólo sirve una caja compartida.
            branch_id: candidate.branch_id as string,
            currency: candidate.currency,
            payment_method: null,
            handover_to_id: null,
            historic_owner: candidate.historic_owner,
            historic_name: candidate.historic_name,
          },
          accounts,
        );
        if ('account' in result)
          plan.push({ candidate, target: result.account });
        else unresolved.push({ candidate, reason: result.reason });
      }

      const describe = (candidate: Candidate) =>
        `${candidate.expense_category} · ${candidate.expense_detail}`;
      for (const { candidate, target } of plan)
        console.log(
          [
            `cargado ${candidate.created_at.toISOString()}`,
            `FECHA EN CAJA: ${day(candidate.occurred_at)} -> ${day(paymentDate(candidate))}`,
            kind(candidate),
            money(candidate.amount, candidate.currency),
            candidate.branch_name ?? 'General',
            describe(candidate),
            `DE: ${candidate.historic_owner ?? candidate.historic_name}`,
            `A: ${target.name} (${target.type}, ${target.responsible_name})`,
          ].join(' | '),
        );
      if (unresolved.length) {
        console.log('\nNO SE MUEVEN (hay que resolverlos a mano):');
        for (const { candidate, reason } of unresolved)
          console.log(
            [
              candidate.created_at.toISOString(),
              kind(candidate),
              money(candidate.amount, candidate.currency),
              candidate.branch_name ?? 'General',
              describe(candidate),
              `en: ${candidate.historic_owner ?? candidate.historic_name}`,
              `motivo: ${reason}`,
            ].join(' | '),
          );
      }

      const totals = new Map<string, Prisma.Decimal>();
      for (const { candidate } of plan) {
        const key = `${kind(candidate)} ${candidate.currency}`;
        totals.set(
          key,
          (totals.get(key) ?? new Prisma.Decimal(0)).plus(candidate.amount),
        );
      }
      console.log(
        `\nA mover: ${plan.length} movimientos (${
          [...totals.entries()]
            .map(([key, total]) => `${key} ${total.toFixed(2)}`)
            .join(', ') || 'nada'
        }). Sin resolver: ${unresolved.length}.`,
      );

      if (!apply) {
        console.log(
          '\nSimulación: no se cambió nada. Revisá la lista y repetí con --apply.\n',
        );
        return;
      }

      for (const { candidate, target } of plan) {
        const origin = candidate.historic_owner ?? candidate.historic_name;
        const reason = `Reasignado a ${target.name}: se había cargado en la cuenta histórica de ${origin}`;
        const outflow = candidate.direction === 'DEBITO';
        // 1) Reversa en la cuenta histórica, igual que el botón "Reversar".
        await tx.movimientos_caja.create({
          data: {
            cuenta_caja_id: candidate.historic_account_id,
            tipo_movimiento: outflow ? 'INGRESO' : 'EGRESO',
            direccion: outflow ? 'CREDITO' : 'DEBITO',
            importe: candidate.amount,
            contabilizado_en: new Date(),
            revierte_a_id: candidate.movement_id,
            referencia: candidate.reference,
            notas: reason,
            registrado_por_personal_id: actorPersonnelId,
            organizacion_id: organizationId,
          },
        });
        // 2) El mismo movimiento en la caja activa, a nombre de quien lo
        //    registró y con la fecha del gasto si se pagó al cargarlo.
        await tx.movimientos_caja.create({
          data: {
            cuenta_caja_id: target.id,
            tipo_movimiento: candidate.movement_type,
            direccion: candidate.direction,
            importe: candidate.amount,
            contabilizado_en: paymentDate(candidate),
            gasto_id: candidate.expense_id,
            referencia: candidate.reference,
            notas: [
              candidate.notes,
              `Reasignado desde la cuenta histórica de ${origin}`,
            ]
              .filter(Boolean)
              .join(' · '),
            registrado_por_personal_id: candidate.registered_by_id,
            organizacion_id: organizationId,
          },
        });
        await tx.registros_auditoria.create({
          data: {
            accion: 'EXPENSE_PAYMENT_REASSIGNED',
            entidad: 'gastos',
            entidad_id: candidate.expense_id,
            usuario_id: actor.id,
            organizacion_id: organizationId,
            datos_anteriores: { account: `Histórica: ${origin}` },
            datos_nuevos: {
              account: target.name,
              amount: candidate.amount.toString(),
              reason,
            },
          },
        });
      }
      console.log(
        `\nListo: ${plan.length} movimientos reasignados por ${actorName}.\n`,
      );
    },
    { timeout: 120_000 },
  );
}

if (require.main === module)
  void main()
    .catch((error: unknown) => {
      console.error(
        error instanceof Error
          ? error.message
          : 'Error reasignando pagos de egresos',
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });

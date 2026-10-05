import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Pasa a una caja activa los cobros que se cargaron en el sistema sobre una
 * cuenta histórica importada del Excel.
 *
 * Los movimientos de caja son inmutables, así que cada cobro se corrige como
 * lo haría una persona desde la pantalla: una reversa en la cuenta histórica
 * y un cobro nuevo, por el mismo importe y la misma fecha, en la caja activa
 * del mismo socio, de la sucursal y la moneda del ingreso. Queda registrado
 * en la auditoría del ingreso (INCOME_COLLECTION_REASSIGNED).
 *
 * Por defecto NO cambia nada: lista qué movería y a dónde.
 *
 *   npm run caja:reasignar-historicas -- --actor-email admin@luma.com
 *   npm run caja:reasignar-historicas -- --actor-email admin@luma.com --apply
 *
 * Opciones (con sus valores por defecto):
 *   --user "Rosa"            quién registró el cobro (parte del nombre)
 *   --branch "San Miguel"    sucursal del ingreso (nombre o código)
 *   --from 2026-10-01        desde, inclusive (día de Argentina)
 *   --to 2026-11-01          hasta, exclusive
 */

const prisma = new PrismaClient();

type Candidate = {
  movement_id: string;
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
  income_id: string;
  income_type: string;
  income_description: string;
  income_account_id: string | null;
  branch_id: string;
  branch_name: string;
  currency: string;
  payment_method: string | null;
  handover_to_id: string | null;
};

type ActiveAccount = {
  id: string;
  name: string;
  type: string;
  branch_id: string | null;
  currency: string;
  responsible_id: string | null;
  responsible_name: string | null;
};

export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cuántas palabras del nombre histórico coinciden con el de la persona.
 * Dos palabras coinciden si una empieza como la otra, mirando hasta 5 letras:
 * tolera diferencias de escritura ("Capdevilla" / "Capdevila") y apodos
 * cortos ("Nico" / "Nicolás").
 */
export function nameScore(historic: string, person: string): number {
  const stems = (value: string) =>
    normalizeName(value)
      .split(' ')
      .filter((token) => token.length >= 3)
      .map((token) => token.slice(0, 5));
  const personStems = stems(person);
  return new Set(
    stems(historic).filter((stem) =>
      personStems.some(
        (other) => other.startsWith(stem) || stem.startsWith(other),
      ),
    ),
  ).size;
}

/** Tipos de cuenta preferidos según cómo entró la plata. */
function typePreference(paymentMethod: string | null): string[] {
  return paymentMethod === 'EFECTIVO' || paymentMethod === null
    ? ['SOCIO', 'CAJA']
    : ['BANCO', 'SOCIO', 'CAJA', 'PROCESADORA_TARJETA', 'FINANCIERA', 'OTRO'];
}

export function pickTarget(
  candidate: Pick<
    Candidate,
    | 'branch_id'
    | 'currency'
    | 'payment_method'
    | 'handover_to_id'
    | 'historic_owner'
    | 'historic_name'
  >,
  accounts: ActiveAccount[],
): { account: ActiveAccount } | { reason: string } {
  const usable = accounts.filter(
    (account) =>
      account.branch_id === candidate.branch_id &&
      account.currency === candidate.currency &&
      account.responsible_id !== null,
  );
  if (usable.length === 0)
    return {
      reason: 'no hay cajas activas con responsable en esa sucursal y moneda',
    };

  let responsibleId = candidate.handover_to_id;
  if (
    !responsibleId ||
    !usable.some((a) => a.responsible_id === responsibleId)
  ) {
    const owner =
      candidate.historic_owner?.trim() ||
      candidate.historic_name.replace(/^Cuenta historica importada:?\s*/i, '');
    const scores = new Map<string, number>();
    for (const account of usable) {
      const score = nameScore(owner, account.responsible_name ?? '');
      if (score > 0)
        scores.set(
          account.responsible_id as string,
          Math.max(score, scores.get(account.responsible_id as string) ?? 0),
        );
    }
    const best = Math.max(0, ...scores.values());
    const winners = [...scores.entries()].filter(([, score]) => score === best);
    if (best === 0) return { reason: `ninguna caja activa es de "${owner}"` };
    if (winners.length > 1)
      return { reason: `"${owner}" coincide con más de un responsable` };
    responsibleId = winners[0][0];
  }

  const own = usable.filter((a) => a.responsible_id === responsibleId);
  for (const type of typePreference(candidate.payment_method)) {
    const matches = own.filter((account) => account.type === type);
    if (matches.length === 1) return { account: matches[0] };
    if (matches.length > 1)
      return {
        reason: `hay ${matches.length} cuentas ${type} de ese responsable: ${matches
          .map((account) => account.name)
          .join(', ')}`,
      };
  }
  return { reason: 'el responsable no tiene una cuenta del tipo esperado' };
}

function option(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function money(value: Prisma.Decimal, currency: string) {
  return `${currency} ${value.toFixed(2)}`;
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
          m.id AS movement_id, m.creado_en AS created_at,
          m.contabilizado_en AS occurred_at, m.importe AS amount,
          m.referencia AS reference, m.notas AS notes,
          p.id AS registered_by_id, p.nombre_completo AS registered_by,
          c.id AS historic_account_id, c.nombre AS historic_name,
          c.datos_inferidos ->> 'responsable_original' AS historic_owner,
          i.id AS income_id, i.tipo_original AS income_type,
          i.descripcion AS income_description,
          i.cuenta_caja_id AS income_account_id,
          s.id AS branch_id, s.nombre AS branch_name, i.moneda AS currency,
          i.medio_pago::text AS payment_method,
          i.rendido_a_personal_id AS handover_to_id
        FROM movimientos_caja m
        JOIN cuentas_caja c ON c.id = m.cuenta_caja_id
        JOIN ingresos i ON i.id = m.ingreso_id
        JOIN sucursales s ON s.id = i.sucursal_id
        JOIN personal p ON p.id = m.registrado_por_personal_id
        WHERE m.organizacion_id = CAST(${organizationId} AS uuid)
          AND c.es_importada
          AND NOT m.es_importado
          AND m.revierte_a_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM movimientos_caja r WHERE r.revierte_a_id = m.id
          )
          AND m.creado_en >= ${from} AND m.creado_en < ${to}
          AND p.nombre_completo ILIKE ${`%${user}%`}
          AND (s.nombre ILIKE ${`%${branch}%`} OR s.codigo ILIKE ${branch})
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
        `\nCobros de "${user}" en ${branch}, cargados entre ${from.toISOString()} y ${to.toISOString()}, que están en cuentas históricas: ${candidates.length}\n`,
      );

      const plan: Array<{ candidate: Candidate; target: ActiveAccount }> = [];
      const unresolved: Array<{ candidate: Candidate; reason: string }> = [];
      for (const candidate of candidates) {
        const result = pickTarget(candidate, accounts);
        if ('account' in result)
          plan.push({ candidate, target: result.account });
        else unresolved.push({ candidate, reason: result.reason });
      }

      for (const { candidate, target } of plan)
        console.log(
          [
            candidate.created_at.toISOString(),
            money(candidate.amount, candidate.currency),
            candidate.payment_method ?? 'sin medio',
            `${candidate.income_type} · ${candidate.income_description}`,
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
              money(candidate.amount, candidate.currency),
              `${candidate.income_type} · ${candidate.income_description}`,
              `en: ${candidate.historic_owner ?? candidate.historic_name}`,
              `motivo: ${reason}`,
            ].join(' | '),
          );
      }

      const totals = new Map<string, Prisma.Decimal>();
      for (const { candidate } of plan)
        totals.set(
          candidate.currency,
          (totals.get(candidate.currency) ?? new Prisma.Decimal(0)).plus(
            candidate.amount,
          ),
        );
      console.log(
        `\nA mover: ${plan.length} cobros (${
          [...totals.entries()]
            .map(([currency, total]) => money(total, currency))
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
        // 1) Reversa en la cuenta histórica, igual que el botón "Reversar".
        await tx.movimientos_caja.create({
          data: {
            cuenta_caja_id: candidate.historic_account_id,
            tipo_movimiento: 'EGRESO',
            direccion: 'DEBITO',
            importe: candidate.amount,
            contabilizado_en: new Date(),
            revierte_a_id: candidate.movement_id,
            referencia: candidate.reference,
            notas: reason,
            registrado_por_personal_id: actorPersonnelId,
            organizacion_id: organizationId,
          },
        });
        // 2) El mismo cobro en la caja activa: misma fecha y quien cobró.
        await tx.movimientos_caja.create({
          data: {
            cuenta_caja_id: target.id,
            tipo_movimiento: 'INGRESO',
            direccion: 'CREDITO',
            importe: candidate.amount,
            contabilizado_en: candidate.occurred_at,
            ingreso_id: candidate.income_id,
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
        if (candidate.income_account_id === candidate.historic_account_id)
          await tx.ingresos.update({
            where: { id: candidate.income_id },
            data: { cuenta_caja_id: target.id },
          });
        await tx.registros_auditoria.create({
          data: {
            accion: 'INCOME_COLLECTION_REASSIGNED',
            entidad: 'ingresos',
            entidad_id: candidate.income_id,
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
        `\nListo: ${plan.length} cobros reasignados por ${actorName}.\n`,
      );
    },
    { timeout: 120_000 },
  );
}

if (require.main === module)
  void main()
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.message : 'Error reasignando cobros',
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });

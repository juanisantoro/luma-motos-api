import { Prisma } from '@prisma/client';
import { argentinaToday } from '../sales/licensing';

// Meses de trabajo: cada mes ("AAAA-MM") puede tener un corte, la fecha en
// que la organización lo da por terminado. El mes va del día siguiente al
// corte del mes anterior hasta su propio corte. Un mes sin corte termina el
// último día del almanaque, y uno cuyo anterior no tiene corte empieza el 1.
// Sin ningún corte cargado, todo queda igual que el mes de almanaque.
//
// El corte de un mes tiene que caer entre el 15 de ese mes y el 14 del
// siguiente: así los meses nunca se pisan ni dejan huecos y de cualquier
// rango se puede saber de qué mes es. Además, al mover un corte ningún mes
// puede quedar con menos de MIN_WORK_MONTH_DAYS días (un error de tipeo).

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_WORK_MONTH_DAYS = 20;

export function rangeDays(range: { from: Date; to: Date }): number {
  return Math.round((range.to.getTime() - range.from.getTime()) / DAY_MS) + 1;
}

export type WorkMonthRange = { period: string; from: Date; to: Date };

export function isPeriodKey(value: unknown): value is string {
  return typeof value === 'string' && PERIOD_PATTERN.test(value);
}

export function periodKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shiftPeriod(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  return periodKeyOf(new Date(Date.UTC(year, month - 1 + months, 1)));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function calendarMonthRange(period: string): WorkMonthRange {
  const [year, month] = period.split('-').map(Number);
  return {
    period,
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 0)),
  };
}

/** Primer y último día en que puede caer el corte de un mes. */
export function cutBounds(period: string): { min: Date; max: Date } {
  const [year, month] = period.split('-').map(Number);
  return {
    min: new Date(Date.UTC(year, month - 1, 15)),
    max: new Date(Date.UTC(year, month, 14)),
  };
}

/** De qué mes es un rango ya guardado (por ejemplo, una liquidación). */
export function periodOfRange(to: Date): string {
  // El corte cae entre el 15 del mes y el 14 del siguiente: 14 días antes
  // siempre es un día del mes. También vale para un fin de mes de almanaque.
  return periodKeyOf(addDays(to, -14));
}

export class WorkCalendar {
  constructor(private readonly cuts: ReadonlyMap<string, Date> = new Map()) {}

  /** Corte cargado para un mes, si lo tiene. */
  cutOf(period: string): Date | null {
    return this.cuts.get(period) ?? null;
  }

  /** El mes más viejo que tiene corte, o null si no hay cortes. */
  earliestCut(): string | null {
    const periods = [...this.cuts.keys()].sort();
    return periods[0] ?? null;
  }

  /** Último día del mes: su corte o el fin del almanaque. */
  endOf(period: string): Date {
    return this.cuts.get(period) ?? calendarMonthRange(period).to;
  }

  range(period: string): WorkMonthRange {
    return {
      period,
      from: addDays(this.endOf(shiftPeriod(period, -1)), 1),
      to: this.endOf(period),
    };
  }

  /** Mes de trabajo al que pertenece un día. */
  periodOf(date: Date): string {
    const day = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    const period = periodKeyOf(day);
    const { from, to } = this.range(period);
    if (day < from) return shiftPeriod(period, -1);
    if (day > to) return shiftPeriod(period, 1);
    return period;
  }

  /** El mes de trabajo en curso (según el día de Argentina). */
  current(now = new Date()): string {
    return this.periodOf(argentinaToday(now));
  }

  /** El mismo calendario con un corte puesto (o sacado, con null). */
  withCut(period: string, cut: Date | null): WorkCalendar {
    const next = new Map(this.cuts);
    if (cut) next.set(period, cut);
    else next.delete(period);
    return new WorkCalendar(next);
  }
}

/** Valida un corte; devuelve el motivo si no se puede, o null. */
export function cutProblem(period: string, cut: Date): string | null {
  const { min, max } = cutBounds(period);
  if (cut < min || cut > max)
    return `El corte de ${period} tiene que caer entre el ${formatDay(min)} y el ${formatDay(max)}.`;
  return null;
}

export function formatDay(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Calendario de una organización. Sin organización (un usuario con acceso a
 * todas que no eligió una) se usa el almanaque.
 */
export async function loadWorkCalendar(
  tx: Prisma.TransactionClient,
  organizationId: string | null | undefined,
): Promise<WorkCalendar> {
  if (!organizationId) return new WorkCalendar();
  const rows = await tx.$queryRaw<
    Array<{ periodo: string; fecha_corte: Date }>
  >(
    Prisma.sql`
      SELECT periodo, fecha_corte
      FROM meses_trabajo
      WHERE organizacion_id = ${organizationId}::uuid
    `,
  );
  return new WorkCalendar(
    new Map(rows.map((row) => [row.periodo.trim(), row.fecha_corte])),
  );
}

/**
 * Bloqueo de los cortes de una organización durante la transacción: el que
 * mueve un corte lo toma exclusivo y el que liquida comisiones, compartido.
 * Así no se puede mover un corte mientras se liquida ese mismo mes.
 */
export async function lockWorkCalendar(
  tx: Prisma.TransactionClient,
  organizationId: string,
  mode: 'shared' | 'exclusive',
): Promise<void> {
  const key = `meses_trabajo:${organizationId}`;
  if (mode === 'exclusive')
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`,
    );
  else
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtext(${key}))`,
    );
}

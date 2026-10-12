import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  MIN_WORK_MONTH_DAYS,
  WorkCalendar,
  cutBounds,
  cutProblem,
  formatDay,
  rangeDays,
  loadWorkCalendar,
  lockWorkCalendar,
  shiftPeriod,
  toDateOnly,
} from './work-months.calendar';

// Meses que muestra la pantalla: los 12 anteriores al actual, el actual y
// el siguiente (para dejar cargado de antemano un corte que ya se sabe).
const MONTHS_BACK = 12;
const MONTHS_AHEAD = 1;

export type WorkMonthView = {
  period: string;
  from: string;
  to: string;
  cutDate: string | null;
  cutMin: string;
  cutMax: string;
  current: boolean;
  // Hay comisiones liquidadas que toman este mes o el siguiente: el corte
  // no se puede mover sin desarmarlas.
  locked: boolean;
};

@Injectable()
export class WorkMonthsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Calendario de la organización del actor, en su propia transacción. */
  calendar(actor: AuthenticatedUser): Promise<WorkCalendar> {
    return this.prisma.withTenant(this.scope(actor), (tx) =>
      loadWorkCalendar(tx, actor.organization.id),
    );
  }

  async list(actor: AuthenticatedUser, organizationId?: string) {
    const target = this.targetOrganization(actor, organizationId);
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const calendar = await loadWorkCalendar(tx, target);
      const current = calendar.current();
      // Los 12 anteriores, o desde el mes siguiente al primer corte si es
      // más viejo: antes de eso todos son meses de almanaque, así quien
      // filtre un mes viejo sin estar en la lista usa el almanaque y acierta.
      const earliestCut = calendar.earliestCut();
      let back = MONTHS_BACK;
      while (
        earliestCut &&
        shiftPeriod(current, -back) > shiftPeriod(earliestCut, 1)
      )
        back += 1;
      const periods = Array.from(
        { length: back + 1 + MONTHS_AHEAD },
        (_, index) => shiftPeriod(current, MONTHS_AHEAD - index),
      );
      const settled = await this.settledWindows(tx, target, calendar, periods);
      return {
        current,
        months: periods.map((period) =>
          this.view(calendar, period, current, settled.has(period)),
        ),
      };
    });
  }

  async setCut(
    actor: AuthenticatedUser,
    period: string,
    cutDate: string,
    organizationId?: string,
  ) {
    const target = this.targetOrganization(actor, organizationId);
    const cut = new Date(`${cutDate}T00:00:00.000Z`);
    if (Number.isNaN(cut.getTime()))
      throw new BadRequestException('La fecha de corte va como AAAA-MM-DD.');
    const problem = cutProblem(period, cut);
    if (problem) throw new BadRequestException(problem);
    return this.change(actor, target, period, cut);
  }

  async removeCut(
    actor: AuthenticatedUser,
    period: string,
    organizationId?: string,
  ) {
    const target = this.targetOrganization(actor, organizationId);
    return this.change(actor, target, period, null);
  }

  private async change(
    actor: AuthenticatedUser,
    organizationId: string,
    period: string,
    cut: Date | null,
  ) {
    const event: AuthenticatedAuditEvent = {
      action: cut ? 'WORK_MONTH_CUT_SET' : 'WORK_MONTH_CUT_REMOVED',
      entity: 'meses_trabajo',
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId: organizationId,
    };
    return this.audit.execute(event, async (tx) => {
      await lockWorkCalendar(tx, organizationId, 'exclusive');
      const calendar = await loadWorkCalendar(tx, organizationId);
      const previous = calendar.cutOf(period);
      if ((previous?.getTime() ?? null) === (cut?.getTime() ?? null)) {
        // Sin cambios: no hay nada que registrar.
        event.skipRecord = true;
        return this.view(calendar, period, calendar.current(), false);
      }
      // Mover el corte de un mes cambia ese mes y el siguiente.
      const settled = await this.settledWindows(tx, organizationId, calendar, [
        period,
      ]);
      if (settled.has(period))
        throw new ConflictException(
          `Ya hay comisiones liquidadas de ${period} o del mes siguiente: el corte no se puede mover.`,
        );

      const updated = calendar.withCut(period, cut);
      const before = calendar.range(period);
      const after = updated.range(period);
      // Mover un corte cambia ese mes y el siguiente: ninguno de los que
      // tienen corte puede quedar demasiado corto (casi siempre es una fecha
      // mal tipeada). Un mes sin corte todavía no está definido.
      for (const affected of [period, shiftPeriod(period, 1)]) {
        if (!updated.cutOf(affected)) continue;
        const range = updated.range(affected);
        if (rangeDays(range) < MIN_WORK_MONTH_DAYS)
          throw new BadRequestException(
            `Con ese corte ${affected} quedaría del ${formatDay(range.from)} al ${formatDay(range.to)}: un mes de trabajo tiene que tener al menos ${MIN_WORK_MONTH_DAYS} días.`,
          );
      }

      if (cut)
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO meses_trabajo (
            organizacion_id, periodo, fecha_corte,
            creado_por_usuario_id, actualizado_por_usuario_id
          )
          VALUES (
            ${organizationId}::uuid, ${period}, ${toDateOnly(cut)}::date,
            ${actor.id}::uuid, ${actor.id}::uuid
          )
          ON CONFLICT (organizacion_id, periodo) DO UPDATE SET
            fecha_corte = EXCLUDED.fecha_corte,
            actualizado_por_usuario_id = EXCLUDED.actualizado_por_usuario_id,
            actualizado_en = CURRENT_TIMESTAMP
        `);
      else
        await tx.$executeRaw(Prisma.sql`
          DELETE FROM meses_trabajo
          WHERE organizacion_id = ${organizationId}::uuid AND periodo = ${period}
        `);

      // Lo registra audit.execute al terminar la transacción.
      event.previousData = {
        cutDate: previous ? toDateOnly(previous) : null,
        to: toDateOnly(before.to),
      };
      event.metadata = {
        period,
        cutDate: cut ? toDateOnly(cut) : null,
        from: toDateOnly(after.from),
        to: toDateOnly(after.to),
      };
      return this.view(updated, period, updated.current(), false);
    });
  }

  // Meses (de los pedidos) cuyo corte no se puede mover porque hay
  // liquidaciones de comisiones, de vendedores o de gerentes, que se cruzan
  // con ese mes o con el siguiente.
  private async settledWindows(
    tx: Prisma.TransactionClient,
    organizationId: string,
    calendar: WorkCalendar,
    periods: string[],
  ): Promise<Set<string>> {
    const ranges = await tx.$queryRaw<Array<{ desde: Date; hasta: Date }>>(
      Prisma.sql`
        SELECT DISTINCT periodo_desde AS desde, periodo_hasta AS hasta
        FROM liquidaciones_comisiones
        WHERE organizacion_id = ${organizationId}::uuid
        UNION
        SELECT DISTINCT periodo_desde, periodo_hasta
        FROM liquidaciones_comisiones_gerente
        WHERE organizacion_id = ${organizationId}::uuid
      `,
    );
    const locked = new Set<string>();
    for (const period of periods) {
      const from = calendar.range(period).from;
      const to = calendar.range(shiftPeriod(period, 1)).to;
      if (ranges.some((range) => range.hasta >= from && range.desde <= to))
        locked.add(period);
    }
    return locked;
  }

  private view(
    calendar: WorkCalendar,
    period: string,
    current: string,
    locked: boolean,
  ): WorkMonthView {
    const range = calendar.range(period);
    const bounds = cutBounds(period);
    const cut = calendar.cutOf(period);
    return {
      period,
      from: toDateOnly(range.from),
      to: toDateOnly(range.to),
      cutDate: cut ? toDateOnly(cut) : null,
      cutMin: toDateOnly(bounds.min),
      cutMax: toDateOnly(bounds.max),
      current: period === current,
      locked,
    };
  }

  private targetOrganization(
    actor: AuthenticatedUser,
    organizationId?: string,
  ) {
    if (
      organizationId &&
      organizationId !== actor.organization.id &&
      !actor.globalAccess
    )
      throw new ForbiddenException(
        'Only users with global access can select an organization',
      );
    return organizationId ?? actor.organization.id;
  }

  private scope(actor: AuthenticatedUser) {
    return {
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
    };
  }
}

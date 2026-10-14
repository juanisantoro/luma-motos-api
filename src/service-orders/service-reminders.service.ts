import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BranchScope } from '../branch-scope/branch-scope';
import { CashService } from '../cash/cash.service';
import { apiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { argentinaToday } from '../sales/licensing';
import type {
  ResolveServiceReminderDto,
  ReminderStage,
  ServiceReminderKeyDto,
  ServiceRemindersQueryDto,
} from './service-reminders.dto';

type Tx = Prisma.TransactionClient;

// Reglas de los avisos.
export const FIRST_SERVICE_DAYS = 30; // desde la entrega de la moto
export const DAYS_AHEAD = 7; // se avisa lo que toca dentro de una semana
export const OVERDUE_DAYS = 30; // y lo vencido hace hasta un mes

const DAY_MS = 24 * 60 * 60 * 1000;
const DONE_STATES = ['TERMINADA', 'ENTREGADA'];
const OPEN_STATES = ['RECIBIDA', 'EN_TALLER'];

type SoldUnitRow = {
  unit_id: string;
  operation_id: string;
  operation_number: bigint;
  branch_id: string;
  branch_name: string;
  delivered_at: Date;
  client_id: string;
  client_name: string;
  client_phone: string | null;
  brand: string;
  model: string;
  version: string;
  vin: string;
  plate: string | null;
};

export type ServiceReminder = {
  unitId: string;
  stage: ReminderStage;
  dueDate: string;
  daysToDue: number;
  serviceName: string;
  servicesDone: number;
  lastServiceDate: string | null;
  deliveredAt: string;
  operation: { id: string; number: string };
  branch: { id: string; name: string };
  client: { id: string; name: string; phone: string | null };
  vehicle: {
    brand: string;
    model: string;
    version: string | null;
    vin: string;
    plate: string | null;
  };
  resolution: {
    status: 'CONTACTADO' | 'DESCARTADO';
    channel: string | null;
    note: string | null;
    at: string;
    by: string | null;
  } | null;
};

/** "AAAA-MM-DD" del día en Argentina (UTC-3) de un instante. */
function argentinaDay(instant: Date): string {
  return new Date(instant.getTime() - 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function addYear(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  // 29/02 + 1 año → 28/02.
  const target = new Date(Date.UTC(year + 1, month - 1, date));
  if (target.getUTCMonth() !== month - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

const PLACEHOLDER_VERSION = 'sin especificar';

function displayVersion(version: string, model: string): string | null {
  const key = version.trim().toLocaleLowerCase('es-AR');
  if (!key || key === PLACEHOLDER_VERSION) return null;
  if (key === model.trim().toLocaleLowerCase('es-AR')) return null;
  return version.trim();
}

/**
 * Avisos de service: a quién hay que contactar esta semana.
 *
 * - 1º service: a los 30 días de entregada una moto vendida por Luma, si
 *   todavía no hizo ningún service.
 * - Después, uno por año: al año del último service terminado.
 *
 * La lista se calcula con las ventas entregadas y las órdenes de service de
 * esa moto. Sale lo que vence dentro de los próximos 7 días y lo vencido hace
 * hasta 30. Una moto que está en el taller no sale. Lo que se resuelve
 * (contactado o descartado) queda en avisos_service y deja de salir.
 */
@Injectable()
export class ServiceRemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
  ) {}

  private scope(actor: AuthenticatedUser) {
    return {
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
    };
  }

  async list(actor: AuthenticatedUser, query: ServiceRemindersQueryDto) {
    const reminders = await this.prisma.withTenant(this.scope(actor), (tx) =>
      this.compute(tx, actor, query.branchId),
    );
    const wanted = query.status ?? 'PENDING';
    return {
      today: argentinaDay(new Date()),
      items: reminders.filter((item) =>
        wanted === 'PENDING' ? !item.resolution : !!item.resolution,
      ),
    };
  }

  /** Cuántos avisos sin resolver hay (inicio de la administrativa). */
  async pendingCount(actor: AuthenticatedUser, branches: BranchScope) {
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const reminders = await this.compute(tx, actor, undefined, branches);
      return reminders.filter((item) => !item.resolution).length;
    });
  }

  private async compute(
    tx: Tx,
    actor: AuthenticatedUser,
    branchId?: string,
    scope: BranchScope = BranchScope.forActor(actor),
  ): Promise<ServiceReminder[]> {
    const organizationId = actor.organization.id;
    const allowed = branchId
      ? [scope.where(branchId) as string]
      : scope.allowedBranchIds;
    const today = argentinaToday().toISOString().slice(0, 10);
    const windowStart = addDays(today, -OVERDUE_DAYS);
    const windowEnd = addDays(today, DAYS_AHEAD);

    // Motos vendidas y entregadas (la venta más nueva de cada unidad).
    const sold = await tx.$queryRaw<SoldUnitRow[]>(Prisma.sql`
      SELECT DISTINCT ON (u.id)
        u.id AS unit_id, o.id AS operation_id,
        o.numero_operacion AS operation_number,
        o.sucursal_id AS branch_id, s.nombre AS branch_name,
        o.entregado_en AS delivered_at,
        c.id AS client_id, c.nombre_completo AS client_name,
        c.telefono AS client_phone,
        ma.nombre AS brand, mo.nombre AS model, v.nombre AS version,
        u.vin_mostrado AS vin, u.patente AS plate
      FROM operaciones o
      JOIN unidades_vehiculos u ON u.id = o.unidad_vehiculo_id
      JOIN versiones_vehiculos v ON v.id = u.version_id
      JOIN modelos_vehiculos mo ON mo.id = v.modelo_id
      JOIN marcas_vehiculos ma ON ma.id = mo.marca_id
      JOIN clientes c ON c.id = o.cliente_id
      JOIN sucursales s ON s.id = o.sucursal_id
      WHERE o.organizacion_id = ${organizationId}::uuid
        AND o.estado_operacion IN ('APROBADA', 'CERRADA')
        AND o.entregado_en IS NOT NULL
        AND mo.tipo_vehiculo = 'MOTO'
        ${allowed ? Prisma.sql`AND o.sucursal_id = ANY(${allowed}::uuid[])` : Prisma.empty}
      ORDER BY u.id, o.entregado_en DESC
    `);
    if (!sold.length) return [];
    const unitIds = sold.map((row) => row.unit_id);

    const [orders, types, resolved] = await Promise.all([
      tx.ordenes_service.findMany({
        where: {
          organizacion_id: organizationId,
          unidad_vehiculo_id: { in: unitIds },
          estado: { in: [...DONE_STATES, ...OPEN_STATES] },
        },
        select: {
          unidad_vehiculo_id: true,
          estado: true,
          terminada_en: true,
          fecha_recepcion: true,
        },
      }),
      tx.tipos_service.findMany({
        where: { organizacion_id: organizationId, activo: true },
        select: { nombre: true, orden: true },
        orderBy: { orden: 'asc' },
      }),
      tx.avisos_service.findMany({
        where: {
          organizacion_id: organizationId,
          unidad_vehiculo_id: { in: unitIds },
        },
      }),
    ]);
    const people = await tx.personal.findMany({
      where: {
        organizacion_id: organizationId,
        id: {
          in: [
            ...new Set(resolved.map((row) => row.registrado_por_personal_id)),
          ],
        },
      },
      select: { id: true, nombre_completo: true },
    });
    const personName = new Map(
      people.map((row) => [row.id, row.nombre_completo]),
    );
    const typeByOrder = new Map(types.map((row) => [row.orden, row.nombre]));
    const resolution = new Map(
      resolved.map((row) => [
        `${row.unidad_vehiculo_id}|${row.etapa}|${row.vence_el.toISOString().slice(0, 10)}`,
        row,
      ]),
    );

    const byUnit = new Map<string, { done: string[]; open: boolean }>();
    for (const order of orders) {
      const entry = byUnit.get(order.unidad_vehiculo_id!) ?? {
        done: [],
        open: false,
      };
      if (OPEN_STATES.includes(order.estado)) entry.open = true;
      else
        entry.done.push(
          order.terminada_en
            ? argentinaDay(order.terminada_en)
            : order.fecha_recepcion.toISOString().slice(0, 10),
        );
      byUnit.set(order.unidad_vehiculo_id!, entry);
    }

    const result: ServiceReminder[] = [];
    for (const row of sold) {
      const services = byUnit.get(row.unit_id) ?? { done: [], open: false };
      // Ya está en el taller: no hay que llamarlo.
      if (services.open) continue;
      const deliveredAt = argentinaDay(row.delivered_at);
      const lastService = services.done.sort().at(-1) ?? null;
      const stage: ReminderStage = lastService ? 'ANUAL' : 'PRIMER_SERVICE';
      const dueDate = lastService
        ? addYear(lastService)
        : addDays(deliveredAt, FIRST_SERVICE_DAYS);
      if (dueDate < windowStart || dueDate > windowEnd) continue;
      const number = services.done.length + 1;
      const serviceName =
        typeByOrder.get(number) ??
        (stage === 'PRIMER_SERVICE' ? '1º service' : 'service anual');
      const resolvedRow = resolution.get(`${row.unit_id}|${stage}|${dueDate}`);
      result.push({
        unitId: row.unit_id,
        stage,
        dueDate,
        daysToDue: daysBetween(today, dueDate),
        serviceName,
        servicesDone: services.done.length,
        lastServiceDate: lastService,
        deliveredAt,
        operation: {
          id: row.operation_id,
          number: row.operation_number.toString(),
        },
        branch: { id: row.branch_id, name: row.branch_name },
        client: {
          id: row.client_id,
          name: row.client_name,
          phone: row.client_phone,
        },
        vehicle: {
          brand: row.brand,
          model: row.model,
          version: displayVersion(row.version, row.model),
          vin: row.vin,
          plate: row.plate,
        },
        resolution: resolvedRow
          ? {
              status: resolvedRow.estado as 'CONTACTADO' | 'DESCARTADO',
              channel: resolvedRow.canal,
              note: resolvedRow.nota,
              at: resolvedRow.registrado_en.toISOString(),
              by:
                personName.get(resolvedRow.registrado_por_personal_id) ?? null,
            }
          : null,
      });
    }
    return result.sort(
      (left, right) =>
        left.dueDate.localeCompare(right.dueDate) ||
        left.client.name.localeCompare(right.client.name, 'es'),
    );
  }

  private event(
    actor: AuthenticatedUser,
    action: string,
  ): AuthenticatedAuditEvent {
    return {
      action,
      entity: 'avisos_service',
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
    };
  }

  /** La moto tiene que ser una vendida de las sucursales del usuario. */
  private async assertUnit(tx: Tx, actor: AuthenticatedUser, unitId: string) {
    const rows = await tx.$queryRaw<Array<{ branch_id: string }>>(Prisma.sql`
      SELECT o.sucursal_id AS branch_id
      FROM operaciones o
      WHERE o.organizacion_id = ${actor.organization.id}::uuid
        AND o.unidad_vehiculo_id = ${unitId}::uuid
        AND o.estado_operacion IN ('APROBADA', 'CERRADA')
      ORDER BY o.entregado_en DESC NULLS LAST
      LIMIT 1
    `);
    if (!rows.length)
      throw apiError(
        HttpStatus.NOT_FOUND,
        'SERVICE_REMINDER_UNIT_NOT_FOUND',
        'La moto no es una venta de Luma.',
      );
    BranchScope.forActor(actor).assert(rows[0].branch_id);
  }

  /** Marca un aviso como contactado o descartado (si ya estaba, lo pisa). */
  async resolve(actor: AuthenticatedUser, input: ResolveServiceReminderDto) {
    const event = this.event(actor, 'SERVICE_REMINDER_RESOLVED');
    return this.audit.execute(event, async (tx) => {
      await this.assertUnit(tx, actor, input.unitId);
      const personnelId = await this.cash.actorPersonnelId(
        tx,
        actor,
        actor.organization.id,
      );
      const data = {
        estado: input.status,
        canal: input.channel ?? null,
        nota: input.note?.trim() || null,
        registrado_por_personal_id: personnelId,
        registrado_en: new Date(),
      };
      const row = await tx.avisos_service.upsert({
        where: {
          organizacion_id_unidad_vehiculo_id_etapa_vence_el: {
            organizacion_id: actor.organization.id,
            unidad_vehiculo_id: input.unitId,
            etapa: input.stage,
            vence_el: new Date(`${input.dueDate}T00:00:00.000Z`),
          },
        },
        create: {
          organizacion_id: actor.organization.id,
          unidad_vehiculo_id: input.unitId,
          etapa: input.stage,
          vence_el: new Date(`${input.dueDate}T00:00:00.000Z`),
          ...data,
        },
        update: data,
      });
      event.entityId = row.id;
      event.metadata = {
        unitId: input.unitId,
        stage: input.stage,
        dueDate: input.dueDate,
        status: input.status,
        channel: input.channel ?? null,
      };
      return { id: row.id, status: row.estado };
    });
  }

  /** Vuelve un aviso a pendiente. */
  async reopen(actor: AuthenticatedUser, input: ServiceReminderKeyDto) {
    const event = this.event(actor, 'SERVICE_REMINDER_REOPENED');
    return this.audit.execute(event, async (tx) => {
      await this.assertUnit(tx, actor, input.unitId);
      const removed = await tx.avisos_service.deleteMany({
        where: {
          organizacion_id: actor.organization.id,
          unidad_vehiculo_id: input.unitId,
          etapa: input.stage,
          vence_el: new Date(`${input.dueDate}T00:00:00.000Z`),
        },
      });
      event.metadata = { ...input, removed: removed.count };
      return { reopened: removed.count > 0 };
    });
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import {
  direccion_caja_luma,
  Prisma,
  tipo_movimiento_caja_luma,
  tipo_vehiculo_luma,
} from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BranchScope } from '../branch-scope/branch-scope';
import { CashService } from '../cash/cash.service';
import { apiError } from '../common/api-error';
import {
  businessDate,
  databasePaymentStatus,
  paymentStatus,
} from '../finance/finance.utils';
import { resolveCashCollection } from '../incomes/cash-handover';
import { normalizeVin } from '../inventory/vin';
import { PrismaService } from '../prisma/prisma.service';
import { argentinaToday, normalizeLicensePlate } from '../sales/licensing';
import { DEFAULT_SERVICE_TASKS } from './service-tasks';
import {
  CreateServiceOrderDto,
  DeliverServiceOrderDto,
  SaveServiceWorkDto,
  ServiceOrderQueryDto,
  ServiceOrderReasonDto,
  ServiceOrderReceptionDto,
  ServiceTypeDto,
  UpdateServiceOrderDto,
  type ServiceOrderStatus,
} from './service-orders.dto';

type Tx = Prisma.TransactionClient;
type OrderRow = Prisma.ordenes_serviceGetPayload<Record<string, never>>;
type TypeRow = Prisma.tipos_serviceGetPayload<Record<string, never>>;

/** Columnas de recepción, con valores simples (sirven para crear y editar). */
type ReceptionColumns = Partial<{
  cliente_id: string | null;
  cliente_nombre: string;
  cliente_telefono: string | null;
  cliente_correo: string | null;
  cliente_documento: string | null;
  cliente_direccion: string | null;
  cliente_localidad: string | null;
  unidad_vehiculo_id: string | null;
  moto_dominio: string | null;
  moto_chasis: string | null;
  moto_motor: string | null;
  moto_modelo: string | null;
  moto_anio: number | null;
  km_proximo_service: number | null;
  observaciones_recepcion: string | null;
  tipo_service_id: string | null;
  tipo_service_nombre: string;
  tareas: ServiceTask[];
}>;

export type ServiceTask = {
  descripcion: string;
  realizada: boolean | null;
  observacion: string | null;
};

const SERVICE_INCOME_TYPE = 'service';
const OPEN_STATES: ServiceOrderStatus[] = ['RECIBIDA', 'EN_TALLER'];

function fail(status: HttpStatus, code: string, message: string): never {
  throw apiError(status, code, message);
}

function blank(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function day(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * Service (taller): órdenes de trabajo de las motos que entran a service.
 *
 * RECIBIDA (la carga la administrativa) → EN_TALLER (el mecánico guarda su
 * avance) → TERMINADA (el mecánico la firma) → ENTREGADA (la administrativa
 * la cobra y la entrega). Se puede cancelar mientras no se entregó y reabrir
 * una terminada para que el mecánico la corrija.
 *
 * El cobro es un ingreso "Service" con su movimiento de caja, igual que
 * cualquier cobro: entra a la caja de la sucursal, a la auditoría y a los
 * cierres. Cada cambio usa `version_fila` (concurrencia optimista) y queda
 * en la auditoría.
 */
@Injectable()
export class ServiceOrdersService {
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

  private event(
    actor: AuthenticatedUser,
    action: string,
    entity = 'ordenes_service',
    entityId?: string,
  ): AuthenticatedAuditEvent {
    return {
      action,
      entity,
      ...(entityId ? { entityId } : {}),
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
    };
  }

  // --- Lectura -------------------------------------------------------------

  async findAll(query: ServiceOrderQueryDto, actor: AuthenticatedUser) {
    const branches = BranchScope.forActor(actor);
    const search = query.search?.trim();
    const number = search && /^\d{1,9}$/.test(search) ? Number(search) : null;
    const contains = search
      ? { contains: search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.ordenes_serviceWhereInput = {
      organizacion_id: actor.organization.id,
      sucursal_id: branches.where(query.branchId),
      estado: query.status?.length ? { in: query.status } : undefined,
      fecha_recepcion:
        query.from || query.to
          ? {
              gte: query.from ? businessDate(query.from) : undefined,
              lte: query.to ? businessDate(query.to) : undefined,
            }
          : undefined,
      OR: contains
        ? [
            ...(number ? [{ numero: number }] : []),
            { cliente_nombre: contains },
            { cliente_documento: contains },
            { moto_dominio: contains },
            { moto_chasis: contains },
            { moto_modelo: contains },
          ]
        : undefined,
    };
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const [total, rows] = await Promise.all([
        tx.ordenes_service.count({ where }),
        tx.ordenes_service.findMany({
          where,
          orderBy: [{ numero: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ]);
      const names = await this.names(tx, rows);
      return {
        items: rows.map((row) => this.view(row, actor, names)),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const row = await this.load(tx, actor, id);
      return this.view(row, actor, await this.names(tx, [row]));
    });
  }

  /**
   * Busca la moto por dominio o chasis: la unidad que vendió Luma (con su
   * último comprador) y el último service que se le hizo, para completar la
   * recepción y sugerir el próximo.
   */
  async lookupVehicle(q: string, actor: AuthenticatedUser) {
    const plate = normalizeLicensePlate(q).normalized;
    const vin = normalizeVin(q);
    if (!plate && !vin) return { units: [], lastOrder: null };
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const units = await tx.$queryRaw<
        Array<{
          id: string;
          plate: string | null;
          chassis: string | null;
          engine: string | null;
          year: number | null;
          model: string;
          client_id: string | null;
          client_name: string | null;
          client_phone: string | null;
          client_email: string | null;
          client_document: string | null;
          client_address: string | null;
        }>
      >(Prisma.sql`
        SELECT u.id, u.patente AS plate, u.vin_mostrado AS chassis,
               u.numero_motor AS engine, u.anio_fabricacion AS year,
               concat_ws(' ', mk.nombre, m.nombre, v.nombre) AS model,
               c.id AS client_id, c.nombre_completo AS client_name,
               c.telefono AS client_phone, c.correo AS client_email,
               c.numero_documento AS client_document,
               c.direccion AS client_address
        FROM unidades_vehiculos u
        JOIN versiones_vehiculos v ON v.id = u.version_id
        JOIN modelos_vehiculos m ON m.id = v.modelo_id
        JOIN marcas_vehiculos mk ON mk.id = m.marca_id
        LEFT JOIN LATERAL (
          SELECT o.cliente_id
          FROM operaciones o
          WHERE o.unidad_vehiculo_id = u.id
            AND o.organizacion_id = u.organizacion_id
            AND o.estado_operacion NOT IN ('BORRADOR', 'RECHAZADA', 'CANCELADA')
          ORDER BY o.creado_en DESC
          LIMIT 1
        ) op ON true
        LEFT JOIN clientes c ON c.id = op.cliente_id
        WHERE u.organizacion_id = ${actor.organization.id}::uuid
          AND (
            (${plate} <> '' AND u.patente_normalizada = ${plate})
            OR (${vin} <> '' AND u.vin_normalizado = ${vin})
          )
        LIMIT 5
      `);
      const last = await tx.ordenes_service.findFirst({
        where: {
          organizacion_id: actor.organization.id,
          estado: { not: 'CANCELADA' },
          OR: [
            ...(units.length
              ? [{ unidad_vehiculo_id: { in: units.map((unit) => unit.id) } }]
              : []),
            ...(q.trim()
              ? [
                  {
                    moto_dominio: {
                      equals: q.trim(),
                      mode: 'insensitive' as const,
                    },
                  },
                ]
              : []),
          ],
        },
        orderBy: { numero: 'desc' },
      });
      return {
        units: units.map((unit) => ({
          unitId: unit.id,
          plate: unit.plate,
          chassis: unit.chassis,
          engine: unit.engine,
          year: unit.year,
          model: unit.model,
          client: unit.client_id
            ? {
                id: unit.client_id,
                name: unit.client_name,
                phone: unit.client_phone,
                email: unit.client_email,
                document: unit.client_document,
                address: unit.client_address,
              }
            : null,
        })),
        lastOrder: last
          ? {
              id: last.id,
              number: last.numero,
              receptionDate: day(last.fecha_recepcion),
              serviceType: last.tipo_service_nombre,
              serviceTypeId: last.tipo_service_id,
              currentKm: last.km_actual,
              nextServiceKm: last.km_proximo_service,
              status: last.estado,
            }
          : null,
      };
    });
  }

  /**
   * Inicio del mecánico: las motos que esperan en el taller de sus
   * sucursales (la más vieja primero) y cuántas terminó hoy el taller.
   */
  async workshop(actor: AuthenticatedUser) {
    const branches = BranchScope.forActor(actor);
    const base = {
      organizacion_id: actor.organization.id,
      sucursal_id: branches.where(),
    };
    // Inicio del día de Argentina (UTC-3, sin horario de verano).
    const startOfDay = new Date(
      argentinaToday().getTime() + 3 * 60 * 60 * 1000,
    );
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const [waiting, inProgress, finishedToday, rows] = await Promise.all([
        tx.ordenes_service.count({ where: { ...base, estado: 'RECIBIDA' } }),
        tx.ordenes_service.count({ where: { ...base, estado: 'EN_TALLER' } }),
        tx.ordenes_service.count({
          where: {
            ...base,
            estado: { in: ['TERMINADA', 'ENTREGADA'] },
            terminada_en: { gte: startOfDay },
          },
        }),
        tx.ordenes_service.findMany({
          where: { ...base, estado: { in: OPEN_STATES } },
          orderBy: [{ numero: 'asc' }],
          take: 20,
        }),
      ]);
      const names = await this.names(tx, rows);
      return {
        waiting,
        inProgress,
        finishedToday,
        orders: rows.map((row) => this.view(row, actor, names)),
      };
    });
  }

  /** Motos con el service terminado que esperan el cobro y la entrega. */
  async readyToDeliverCount(actor: AuthenticatedUser, branches: BranchScope) {
    return this.prisma.withTenant(this.scope(actor), (tx) =>
      tx.ordenes_service.count({
        where: {
          organizacion_id: actor.organization.id,
          sucursal_id: branches.where(),
          estado: 'TERMINADA',
        },
      }),
    );
  }

  // --- Recepción (administrativa) -----------------------------------------

  async create(input: CreateServiceOrderDto, actor: AuthenticatedUser) {
    const event = this.event(actor, 'SERVICE_ORDER_CREATED');
    return this.audit.execute(event, async (tx) => {
      const organizationId = actor.organization.id;
      const personnelId = await this.cash.actorPersonnelId(
        tx,
        actor,
        organizationId,
      );
      const branchId = BranchScope.forActor(actor).resolveBranchId(
        input.branchId,
      );
      const reception = await this.receptionData(tx, actor, input, null);
      if (!reception.tipo_service_nombre)
        fail(
          HttpStatus.BAD_REQUEST,
          'SERVICE_TYPE_REQUIRED',
          'Elegí el tipo de service o escribí cuál es en "Otro".',
        );
      // Número correlativo por organización: el bloqueo evita que dos
      // recepciones simultáneas tomen el mismo.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ordenes_service:${organizationId}`}))`;
      const last = await tx.ordenes_service.aggregate({
        where: { organizacion_id: organizationId },
        _max: { numero: true },
      });
      const row = await tx.ordenes_service.create({
        data: {
          ...reception,
          tipo_service_nombre: reception.tipo_service_nombre,
          cliente_nombre: reception.cliente_nombre as string,
          km_actual: input.currentKm,
          organizacion_id: organizationId,
          sucursal_id: branchId,
          numero: (last._max.numero ?? 0) + 1,
          fecha_recepcion: businessDate(
            input.receptionDate ?? day(argentinaToday())!,
          ),
          creado_por_personal_id: personnelId,
        },
      });
      event.entityId = row.id;
      event.metadata = this.auditSnapshot(row);
      return this.view(row, actor, await this.names(tx, [row]));
    });
  }

  async update(
    id: string,
    input: UpdateServiceOrderDto,
    actor: AuthenticatedUser,
  ) {
    const event = this.event(actor, 'SERVICE_ORDER_UPDATED', undefined, id);
    return this.audit.execute(event, async (tx) => {
      const current = await this.load(tx, actor, id, input.expectedVersion);
      if (!OPEN_STATES.includes(current.estado as ServiceOrderStatus))
        fail(
          HttpStatus.CONFLICT,
          'SERVICE_ORDER_NOT_EDITABLE',
          'La orden ya está terminada, entregada o cancelada: no se puede corregir la recepción.',
        );
      if (
        current.estado !== 'RECIBIDA' &&
        (input.serviceTypeId !== undefined ||
          input.serviceTypeOther !== undefined) &&
        (input.serviceTypeId ?? null) !== current.tipo_service_id
      )
        fail(
          HttpStatus.CONFLICT,
          'SERVICE_TYPE_LOCKED',
          'El mecánico ya empezó a trabajarla: el tipo de service no se puede cambiar.',
        );
      const branchId =
        input.branchId !== undefined
          ? BranchScope.forActor(actor).resolveBranchId(input.branchId)
          : current.sucursal_id;
      const reception = await this.receptionData(tx, actor, input, current);
      const row = await this.write(tx, current, {
        ...reception,
        sucursal_id: branchId,
        ...(input.currentKm !== undefined
          ? { km_actual: input.currentKm }
          : {}),
        ...(input.receptionDate
          ? { fecha_recepcion: businessDate(input.receptionDate) }
          : {}),
      });
      event.previousData = this.auditSnapshot(current);
      event.metadata = this.auditSnapshot(row);
      return this.view(row, actor, await this.names(tx, [row]));
    });
  }

  async cancel(
    id: string,
    input: ServiceOrderReasonDto,
    actor: AuthenticatedUser,
  ) {
    const event = this.event(actor, 'SERVICE_ORDER_CANCELLED', undefined, id);
    return this.audit.execute(event, async (tx) => {
      const current = await this.load(tx, actor, id, input.expectedVersion);
      if (current.estado === 'ENTREGADA' || current.estado === 'CANCELADA')
        fail(
          HttpStatus.CONFLICT,
          'SERVICE_ORDER_CLOSED',
          'La orden ya está entregada o cancelada.',
        );
      const row = await this.write(tx, current, {
        estado: 'CANCELADA',
        cancelada_motivo: input.reason,
        cancelada_en: new Date(),
      });
      event.previousData = { status: current.estado };
      event.metadata = { status: row.estado, reason: input.reason };
      return this.view(row, actor, await this.names(tx, [row]));
    });
  }

  async reopen(
    id: string,
    input: ServiceOrderReasonDto,
    actor: AuthenticatedUser,
  ) {
    const event = this.event(actor, 'SERVICE_ORDER_REOPENED', undefined, id);
    return this.audit.execute(event, async (tx) => {
      const current = await this.load(tx, actor, id, input.expectedVersion);
      if (current.estado !== 'TERMINADA')
        fail(
          HttpStatus.CONFLICT,
          'SERVICE_ORDER_NOT_FINISHED',
          'Sólo se puede reabrir una orden terminada que todavía no se entregó.',
        );
      const row = await this.write(tx, current, {
        estado: 'EN_TALLER',
        mecanico_personal_id: null,
        terminada_en: null,
      });
      event.previousData = {
        status: current.estado,
        signedAt: current.terminada_en?.toISOString() ?? null,
      };
      event.metadata = { status: row.estado, reason: input.reason };
      return this.view(row, actor, await this.names(tx, [row]));
    });
  }

  // --- Taller (mecánico) ----------------------------------------------------

  async saveWork(
    id: string,
    input: SaveServiceWorkDto,
    actor: AuthenticatedUser,
  ) {
    return this.work(id, input, actor, false);
  }

  async finish(
    id: string,
    input: SaveServiceWorkDto,
    actor: AuthenticatedUser,
  ) {
    return this.work(id, input, actor, true);
  }

  private async work(
    id: string,
    input: SaveServiceWorkDto,
    actor: AuthenticatedUser,
    sign: boolean,
  ) {
    const event = this.event(
      actor,
      sign ? 'SERVICE_ORDER_FINISHED' : 'SERVICE_ORDER_WORK_SAVED',
      undefined,
      id,
    );
    return this.audit.execute(event, async (tx) => {
      const current = await this.load(tx, actor, id, input.expectedVersion);
      if (!OPEN_STATES.includes(current.estado as ServiceOrderStatus))
        fail(
          HttpStatus.CONFLICT,
          'SERVICE_ORDER_NOT_OPEN',
          'La orden no está en el taller: ya se terminó, se entregó o se canceló.',
        );
      const tasks: ServiceTask[] = input.tasks.map((task) => ({
        descripcion: task.description.trim(),
        realizada: task.done ?? null,
        observacion: blank(task.notes),
      }));
      if (sign) {
        const pending = tasks.filter((task) => task.realizada === null);
        if (pending.length)
          fail(
            HttpStatus.BAD_REQUEST,
            'SERVICE_TASKS_PENDING',
            `Marcá Sí o No en todas las tareas antes de firmar (faltan ${pending.length}).`,
          );
        if (tasks.length === 0)
          fail(
            HttpStatus.BAD_REQUEST,
            'SERVICE_TASKS_REQUIRED',
            'La orden no tiene tareas: agregá lo que se le hizo antes de firmar.',
          );
      }
      const oil = input.oil
        ? {
            tipo: blank(input.oil.type),
            viscosidad: blank(input.oil.viscosity),
            litros: input.oil.liters ?? null,
            filtro: input.oil.filter ?? null,
          }
        : (current.aceite as Prisma.InputJsonValue);
      const parts =
        input.parts?.map((part) => ({
          codigo: blank(part.code),
          descripcion: part.description.trim(),
          cantidad: part.quantity,
          precioUnitario: part.unitPrice ?? null,
        })) ?? (current.repuestos as Prisma.InputJsonValue);
      const personnelId = sign
        ? await this.cash.actorPersonnelId(tx, actor, current.organizacion_id)
        : null;
      const row = await this.write(tx, current, {
        estado: sign ? 'TERMINADA' : 'EN_TALLER',
        tareas: tasks,
        aceite: oil,
        repuestos: parts,
        ...(input.diagnosis !== undefined
          ? { diagnostico: blank(input.diagnosis) }
          : {}),
        ...(input.nextServiceKm !== undefined
          ? { km_proximo_service: input.nextServiceKm }
          : {}),
        ...(sign
          ? { mecanico_personal_id: personnelId, terminada_en: new Date() }
          : {}),
      });
      if (!sign && current.estado === 'EN_TALLER')
        // Guardar avance es frecuente: se registra, pero sin repetir todo el
        // checklist en cada guardado.
        event.metadata = { status: row.estado, tasks: tasks.length };
      else event.metadata = this.workSnapshot(row);
      return this.view(row, actor, await this.names(tx, [row]));
    });
  }

  // --- Cobro y entrega --------------------------------------------------------

  async deliver(
    id: string,
    input: DeliverServiceOrderDto,
    actor: AuthenticatedUser,
  ) {
    const event = this.event(actor, 'SERVICE_ORDER_DELIVERED', undefined, id);
    return this.audit.execute(event, async (tx) => {
      const current = await this.load(tx, actor, id);
      // Reintento del mismo cobro (la respuesta no llegó): se devuelve la
      // orden ya entregada sin cobrar de nuevo.
      if (current.estado === 'ENTREGADA' && current.ingreso_id) {
        const repeated = await tx.movimientos_caja.findFirst({
          where: {
            organizacion_id: current.organizacion_id,
            clave_idempotencia: input.idempotencyKey,
            ingreso_id: current.ingreso_id,
          },
          select: { id: true },
        });
        if (repeated) {
          event.skipRecord = true;
          return this.view(current, actor, await this.names(tx, [current]));
        }
      }
      if (current.version_fila !== input.expectedVersion) this.staleVersion();
      if (current.estado !== 'TERMINADA')
        fail(
          HttpStatus.CONFLICT,
          'SERVICE_ORDER_NOT_FINISHED',
          'Sólo se entrega una orden que el mecánico terminó y firmó.',
        );
      const amount = new Prisma.Decimal(input.amount);
      const today = day(argentinaToday())!;
      const date = input.deliveryDate ?? today;
      if (date > today)
        fail(
          HttpStatus.BAD_REQUEST,
          'FUTURE_DELIVERY_DATE',
          'La fecha de entrega no puede ser posterior a hoy.',
        );
      let incomeId: string | null = null;
      if (amount.greaterThan(0))
        incomeId = await this.collect(
          tx,
          actor,
          current,
          input,
          amount,
          date,
          today,
        );
      const row = await this.write(tx, current, {
        estado: 'ENTREGADA',
        importe: amount,
        ingreso_id: incomeId,
        entregada_en:
          date === today ? new Date() : new Date(`${date}T12:00:00.000-03:00`),
        entregada_por_personal_id: await this.cash.actorPersonnelId(
          tx,
          actor,
          current.organizacion_id,
        ),
        estado_entrega: input.vehicleCondition,
        observaciones_entrega: blank(input.notes),
      });
      event.metadata = {
        status: row.estado,
        amount: amount.toFixed(2),
        incomeId,
        accountId: incomeId ? (input.accountId ?? null) : null,
        paymentMethod: incomeId ? (input.paymentMethod ?? null) : null,
        vehicleCondition: input.vehicleCondition,
        deliveryDate: date,
      };
      return this.view(row, actor, await this.names(tx, [row]));
    });
  }

  /** Ingreso "Service" con su cobro en la caja elegida. */
  private async collect(
    tx: Tx,
    actor: AuthenticatedUser,
    order: OrderRow,
    input: DeliverServiceOrderDto,
    amount: Prisma.Decimal,
    date: string,
    today: string,
  ): Promise<string> {
    const used = await tx.movimientos_caja.findFirst({
      where: {
        organizacion_id: order.organizacion_id,
        clave_idempotencia: input.idempotencyKey,
      },
      select: { id: true },
    });
    if (used)
      fail(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used with a different payload',
      );
    const incomeType = await tx.tipos_ingreso.findFirst({
      where: { nombre_normalizado: SERVICE_INCOME_TYPE, activo: true },
      select: { nombre: true },
    });
    if (!incomeType)
      fail(
        HttpStatus.CONFLICT,
        'SERVICE_INCOME_TYPE_MISSING',
        'Falta el tipo de ingreso "Service": pedile a un administrador que lo active.',
      );
    const cashColumns = await resolveCashCollection(
      tx,
      order.organizacion_id,
      () => this.cash.actorPersonnelId(tx, actor, order.organizacion_id),
      {
        ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
        ...(input.collectedById ? { collectedById: input.collectedById } : {}),
        ...(input.handoverToId ? { handoverToId: input.handoverToId } : {}),
      },
    );
    const reference =
      blank(input.reference) ??
      `Orden de service ${String(order.numero).padStart(6, '0')}`;
    const income = await tx.ingresos.create({
      data: {
        organizacion_id: order.organizacion_id,
        sucursal_id: order.sucursal_id,
        cliente_id: order.cliente_id,
        ...cashColumns,
        fecha_ingreso: businessDate(date),
        tipo_original: incomeType.nombre,
        descripcion: [
          `Service · orden #${order.numero}`,
          order.tipo_service_nombre,
          order.moto_dominio ?? order.moto_modelo,
          order.cliente_nombre,
        ]
          .filter(Boolean)
          .join(' · '),
        importe: amount,
        moneda: 'ARS',
        estado_registro: 'PENDIENTE',
        referencia: reference,
        unidad_vehiculo_id: order.unidad_vehiculo_id,
        // Sin unidad ni operación, el circuito lo da el tipo: es una moto.
        ...(order.unidad_vehiculo_id
          ? {}
          : { tipo_vehiculo: tipo_vehiculo_luma.MOTO }),
        observaciones: blank(input.notes),
        es_transferencia: false,
      },
      select: { id: true },
    });
    await this.cash.registerEntityMovement(
      tx,
      actor,
      order.organizacion_id,
      'ARS',
      {
        idempotencyKey: input.idempotencyKey,
        accountId: input.accountId as string,
        amount: amount.toFixed(2),
        ...(date === today ? {} : { occurredAt: `${date}T12:00:00.000-03:00` }),
        reference,
      },
      { ingreso_id: income.id },
      tipo_movimiento_caja_luma.INGRESO,
      direccion_caja_luma.CREDITO,
    );
    const collected = await this.cash.settledAmount(
      tx,
      { ingreso_id: income.id },
      tipo_movimiento_caja_luma.INGRESO,
    );
    await tx.ingresos.update({
      where: {
        id_organizacion_id: {
          id: income.id,
          organizacion_id: order.organizacion_id,
        },
      },
      data: {
        estado_registro: databasePaymentStatus(
          paymentStatus(collected, amount),
        ),
      },
    });
    return income.id;
  }

  // --- Tipos de service ------------------------------------------------------

  async types(actor: AuthenticatedUser, includeInactive = false) {
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const rows = await tx.tipos_service.findMany({
        where: {
          organizacion_id: actor.organization.id,
          ...(includeInactive ? {} : { activo: true }),
        },
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      });
      return rows.map((row) => this.typeView(row));
    });
  }

  async createType(input: ServiceTypeDto, actor: AuthenticatedUser) {
    const event = this.event(actor, 'SERVICE_TYPE_CREATED', 'tipos_service');
    return this.audit.execute(event, async (tx) => {
      const row = await this.saveType(tx, actor, null, input);
      event.entityId = row.id;
      event.metadata = this.typeView(row);
      return this.typeView(row);
    });
  }

  async updateType(
    id: string,
    input: ServiceTypeDto,
    actor: AuthenticatedUser,
  ) {
    const event = this.event(
      actor,
      'SERVICE_TYPE_UPDATED',
      'tipos_service',
      id,
    );
    return this.audit.execute(event, async (tx) => {
      const current = await tx.tipos_service.findFirst({
        where: { id, organizacion_id: actor.organization.id },
      });
      if (!current)
        fail(
          HttpStatus.NOT_FOUND,
          'SERVICE_TYPE_NOT_FOUND',
          'No existe ese tipo de service.',
        );
      const row = await this.saveType(tx, actor, current, input);
      event.previousData = this.typeView(current);
      event.metadata = this.typeView(row);
      return this.typeView(row);
    });
  }

  private async saveType(
    tx: Tx,
    actor: AuthenticatedUser,
    current: TypeRow | null,
    input: ServiceTypeDto,
  ) {
    const tasks = [...new Set(input.tasks.map((task) => task.trim()))];
    const data = {
      nombre: input.name,
      orden: input.order ?? current?.orden ?? 0,
      tareas: tasks,
      precio_sugerido:
        input.suggestedPrice === undefined
          ? (current?.precio_sugerido ?? null)
          : input.suggestedPrice === null
            ? null
            : new Prisma.Decimal(input.suggestedPrice),
      activo: input.active ?? current?.activo ?? true,
      actualizado_en: new Date(),
    };
    try {
      return current
        ? await tx.tipos_service.update({ where: { id: current.id }, data })
        : await tx.tipos_service.create({
            data: { ...data, organizacion_id: actor.organization.id },
          });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        fail(
          HttpStatus.CONFLICT,
          'SERVICE_TYPE_DUPLICATED',
          `Ya hay un tipo de service "${input.name}".`,
        );
      throw error;
    }
  }

  // --- Ayudas ------------------------------------------------------------------

  /** Orden visible para el actor (organización y sucursal), opcionalmente con su versión. */
  private async load(
    tx: Tx,
    actor: AuthenticatedUser,
    id: string,
    expectedVersion?: number,
  ): Promise<OrderRow> {
    const row = await tx.ordenes_service.findFirst({
      where: { id, organizacion_id: actor.organization.id },
    });
    if (!row || !BranchScope.forActor(actor).includes(row.sucursal_id))
      fail(
        HttpStatus.NOT_FOUND,
        'SERVICE_ORDER_NOT_FOUND',
        'No existe esa orden de service.',
      );
    if (expectedVersion !== undefined && row.version_fila !== expectedVersion)
      this.staleVersion();
    return row;
  }

  private staleVersion(): never {
    fail(
      HttpStatus.CONFLICT,
      'STALE_VERSION',
      'Alguien modificó la orden mientras la tenías abierta: volvé a abrirla y repetí el cambio.',
    );
  }

  /** Guarda con concurrencia optimista sobre `version_fila`. */
  private async write(
    tx: Tx,
    current: OrderRow,
    data: Prisma.ordenes_serviceUncheckedUpdateManyInput,
  ): Promise<OrderRow> {
    const updated = await tx.ordenes_service.updateMany({
      where: { id: current.id, version_fila: current.version_fila },
      data: {
        ...data,
        version_fila: { increment: 1 },
        actualizado_en: new Date(),
      },
    });
    if (updated.count !== 1) this.staleVersion();
    return tx.ordenes_service.findUniqueOrThrow({ where: { id: current.id } });
  }

  /**
   * Columnas de recepción a partir de lo cargado: completa con el cliente y
   * la unidad registrados y arma el checklist del tipo de service.
   */
  private async receptionData(
    tx: Tx,
    actor: AuthenticatedUser,
    input: ServiceOrderReceptionDto,
    current: OrderRow | null,
  ) {
    const organizationId = actor.organization.id;
    const data: ReceptionColumns = {};
    const set = <K extends keyof typeof data>(
      key: K,
      value: (typeof data)[K] | undefined,
    ) => {
      if (value !== undefined) data[key] = value;
    };

    if (input.clientId) {
      const client = await tx.clientes.findFirst({
        where: { id: input.clientId, organizacion_id: organizationId },
        select: {
          id: true,
          nombre_completo: true,
          telefono: true,
          correo: true,
          numero_documento: true,
          direccion: true,
        },
      });
      if (!client)
        fail(
          HttpStatus.BAD_REQUEST,
          'CLIENT_NOT_FOUND',
          'No existe ese cliente.',
        );
      data.cliente_id = client.id;
      data.cliente_nombre = blank(input.clientName) ?? client.nombre_completo;
      data.cliente_telefono = blank(input.clientPhone) ?? client.telefono;
      data.cliente_correo = blank(input.clientEmail) ?? client.correo;
      data.cliente_documento =
        blank(input.clientDocument) ?? client.numero_documento;
      data.cliente_direccion = blank(input.clientAddress) ?? client.direccion;
    } else {
      if (input.clientId === undefined && current === null)
        data.cliente_id = null;
      set(
        'cliente_nombre',
        input.clientName === undefined
          ? undefined
          : (blank(input.clientName) ?? ''),
      );
      set(
        'cliente_telefono',
        input.clientPhone === undefined ? undefined : blank(input.clientPhone),
      );
      set(
        'cliente_correo',
        input.clientEmail === undefined ? undefined : blank(input.clientEmail),
      );
      set(
        'cliente_documento',
        input.clientDocument === undefined
          ? undefined
          : blank(input.clientDocument),
      );
      set(
        'cliente_direccion',
        input.clientAddress === undefined
          ? undefined
          : blank(input.clientAddress),
      );
    }
    set(
      'cliente_localidad',
      input.clientLocality === undefined
        ? undefined
        : blank(input.clientLocality),
    );
    const clientName = data.cliente_nombre ?? current?.cliente_nombre;
    if (!clientName)
      fail(
        HttpStatus.BAD_REQUEST,
        'CLIENT_REQUIRED',
        'Elegí un cliente registrado o escribí el nombre y apellido.',
      );

    if (input.unitId) {
      const unit = await tx.$queryRaw<
        Array<{
          id: string;
          plate: string | null;
          chassis: string | null;
          engine: string | null;
          year: number | null;
          model: string;
        }>
      >(Prisma.sql`
        SELECT u.id, u.patente AS plate, u.vin_mostrado AS chassis,
               u.numero_motor AS engine, u.anio_fabricacion AS year,
               concat_ws(' ', mk.nombre, m.nombre, v.nombre) AS model
        FROM unidades_vehiculos u
        JOIN versiones_vehiculos v ON v.id = u.version_id
        JOIN modelos_vehiculos m ON m.id = v.modelo_id
        JOIN marcas_vehiculos mk ON mk.id = m.marca_id
        WHERE u.id = ${input.unitId}::uuid
          AND u.organizacion_id = ${organizationId}::uuid
      `);
      const found = unit[0];
      if (!found)
        fail(
          HttpStatus.BAD_REQUEST,
          'UNIT_NOT_FOUND',
          'No existe esa moto en el stock de Luma.',
        );
      data.unidad_vehiculo_id = found.id;
      data.moto_dominio = blank(input.plate) ?? found.plate;
      data.moto_chasis = blank(input.chassis) ?? found.chassis;
      data.moto_motor = blank(input.engine) ?? found.engine;
      data.moto_modelo = blank(input.model) ?? found.model;
      data.moto_anio = input.year ?? found.year;
    } else {
      set(
        'moto_dominio',
        input.plate === undefined
          ? undefined
          : (blank(input.plate)?.toUpperCase() ?? null),
      );
      set(
        'moto_chasis',
        input.chassis === undefined
          ? undefined
          : (blank(input.chassis)?.toUpperCase() ?? null),
      );
      set(
        'moto_motor',
        input.engine === undefined
          ? undefined
          : (blank(input.engine)?.toUpperCase() ?? null),
      );
      set(
        'moto_modelo',
        input.model === undefined ? undefined : blank(input.model),
      );
      set('moto_anio', input.year);
    }
    const identified =
      (data.unidad_vehiculo_id ?? current?.unidad_vehiculo_id) ||
      (data.moto_dominio !== undefined
        ? data.moto_dominio
        : current?.moto_dominio) ||
      (data.moto_chasis !== undefined
        ? data.moto_chasis
        : current?.moto_chasis);
    if (!identified)
      fail(
        HttpStatus.BAD_REQUEST,
        'VEHICLE_REQUIRED',
        'Cargá el dominio o el número de chasis de la moto.',
      );
    set('km_proximo_service', input.nextServiceKm);
    set(
      'observaciones_recepcion',
      input.receptionNotes === undefined
        ? undefined
        : blank(input.receptionNotes),
    );

    if (input.serviceTypeId) {
      const type = await tx.tipos_service.findFirst({
        where: {
          id: input.serviceTypeId,
          organizacion_id: organizationId,
          activo: true,
        },
      });
      if (!type)
        fail(
          HttpStatus.BAD_REQUEST,
          'SERVICE_TYPE_NOT_FOUND',
          'Ese tipo de service no existe o está desactivado.',
        );
      if (type.id !== current?.tipo_service_id) {
        data.tipo_service_id = type.id;
        data.tipo_service_nombre = type.nombre;
        data.tareas = this.checklist(
          type.tareas.length ? type.tareas : DEFAULT_SERVICE_TASKS,
        );
      }
    } else if (input.serviceTypeOther) {
      const name = `Otro: ${input.serviceTypeOther}`;
      if (current?.tipo_service_id || current?.tipo_service_nombre !== name) {
        data.tipo_service_id = null;
        data.tipo_service_nombre = name;
        data.tareas = this.checklist(DEFAULT_SERVICE_TASKS);
      }
    }
    return data;
  }

  private checklist(tasks: readonly string[]): ServiceTask[] {
    return tasks.map((task) => ({
      descripcion: task,
      realizada: null,
      observacion: null,
    }));
  }

  /** Nombres de quien recibió, del mecánico que firmó y de quien entregó. */
  private async names(tx: Tx, rows: OrderRow[]) {
    const ids = [
      ...new Set(
        rows.flatMap((row) =>
          [
            row.creado_por_personal_id,
            row.mecanico_personal_id,
            row.entregada_por_personal_id,
          ].filter((value): value is string => Boolean(value)),
        ),
      ),
    ];
    const branchIds = [...new Set(rows.map((row) => row.sucursal_id))];
    const [people, branches] = await Promise.all([
      ids.length
        ? tx.personal.findMany({
            where: { id: { in: ids } },
            select: { id: true, nombre_completo: true },
          })
        : [],
      tx.sucursales.findMany({
        where: { id: { in: branchIds } },
        select: { id: true, codigo: true, nombre: true },
      }),
    ]);
    return {
      person: new Map(people.map((row) => [row.id, row.nombre_completo])),
      branch: new Map(branches.map((row) => [row.id, row])),
    };
  }

  private view(
    row: OrderRow,
    actor: AuthenticatedUser,
    names: Awaited<ReturnType<ServiceOrdersService['names']>>,
  ) {
    const permissions = actor.role.permissions;
    // El mecánico no ve el cobro: sólo quien recibe, entrega o cobra.
    const seesMoney =
      permissions.includes(PERMISSION_CODES.SERVICE_COLLECT) ||
      permissions.includes(PERMISSION_CODES.SERVICE_MANAGE);
    const person = (id: string | null) =>
      id ? { id, fullName: names.person.get(id) ?? '—' } : null;
    const branch = names.branch.get(row.sucursal_id);
    const oil = (row.aceite ?? {}) as Record<string, unknown>;
    const tasks = (row.tareas ?? []) as ServiceTask[];
    const parts = (row.repuestos ?? []) as Array<{
      codigo: string | null;
      descripcion: string;
      cantidad: number;
      precioUnitario: string | null;
    }>;
    return {
      id: row.id,
      number: row.numero,
      status: row.estado as ServiceOrderStatus,
      version: row.version_fila,
      branch: branch
        ? { id: branch.id, code: branch.codigo, name: branch.nombre }
        : { id: row.sucursal_id, code: '', name: '' },
      receptionDate: day(row.fecha_recepcion),
      client: {
        id: row.cliente_id,
        name: row.cliente_nombre,
        phone: row.cliente_telefono,
        email: row.cliente_correo,
        document: row.cliente_documento,
        address: row.cliente_direccion,
        locality: row.cliente_localidad,
      },
      vehicle: {
        unitId: row.unidad_vehiculo_id,
        plate: row.moto_dominio,
        chassis: row.moto_chasis,
        engine: row.moto_motor,
        model: row.moto_modelo,
        year: row.moto_anio,
      },
      currentKm: row.km_actual,
      nextServiceKm: row.km_proximo_service,
      serviceType: { id: row.tipo_service_id, name: row.tipo_service_nombre },
      receptionNotes: row.observaciones_recepcion,
      tasks: tasks.map((task) => ({
        description: task.descripcion,
        done: task.realizada,
        notes: task.observacion,
      })),
      oil: {
        type: (oil.tipo as string | null) ?? null,
        viscosity: (oil.viscosidad as string | null) ?? null,
        liters: (oil.litros as number | null) ?? null,
        filter: (oil.filtro as boolean | null) ?? null,
      },
      parts: parts.map((part) => ({
        code: part.codigo,
        description: part.descripcion,
        quantity: part.cantidad,
        unitPrice: part.precioUnitario,
      })),
      diagnosis: row.diagnostico,
      signedBy: person(row.mecanico_personal_id),
      signedAt: row.terminada_en,
      delivery:
        row.estado === 'ENTREGADA'
          ? {
              at: row.entregada_en,
              by: person(row.entregada_por_personal_id),
              vehicleCondition: row.estado_entrega,
              notes: row.observaciones_entrega,
              ...(seesMoney
                ? {
                    amount: row.importe?.toFixed(2) ?? null,
                    incomeId: row.ingreso_id,
                  }
                : {}),
            }
          : null,
      cancellation:
        row.estado === 'CANCELADA'
          ? { at: row.cancelada_en, reason: row.cancelada_motivo }
          : null,
      receivedBy: person(row.creado_por_personal_id),
      createdAt: row.creado_en,
      updatedAt: row.actualizado_en,
    };
  }

  private typeView(row: TypeRow) {
    return {
      id: row.id,
      name: row.nombre,
      order: row.orden,
      tasks: row.tareas,
      suggestedPrice: row.precio_sugerido?.toFixed(2) ?? null,
      currency: row.moneda,
      active: row.activo,
    };
  }

  private auditSnapshot(row: OrderRow) {
    return {
      number: row.numero,
      status: row.estado,
      receptionDate: day(row.fecha_recepcion),
      client: row.cliente_nombre,
      plate: row.moto_dominio,
      chassis: row.moto_chasis,
      model: row.moto_modelo,
      currentKm: row.km_actual,
      serviceType: row.tipo_service_nombre,
      branchId: row.sucursal_id,
    };
  }

  private workSnapshot(row: OrderRow) {
    return {
      number: row.numero,
      status: row.estado,
      tasks: row.tareas as Prisma.InputJsonValue,
      oil: row.aceite as Prisma.InputJsonValue,
      parts: row.repuestos as Prisma.InputJsonValue,
      diagnosis: row.diagnostico,
      nextServiceKm: row.km_proximo_service,
    };
  }
}

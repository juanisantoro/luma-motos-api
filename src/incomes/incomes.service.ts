import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  direccion_caja_luma,
  Prisma,
  tipo_movimiento_caja_luma,
} from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CashService } from '../cash/cash.service';
import {
  CreateIncomeDto,
  IncomeQueryDto,
  RegisterFinancialMovementDto,
  ReverseFinancialMovementDto,
  UpdateIncomeDto,
} from '../finance/finance.dto';
import {
  financialBadRequest,
  financialConflict,
  financialNotFound,
} from '../finance/finance.errors';
import {
  assertComputedFilterScanLimit,
  assertOrganization,
  businessDate,
  COMPUTED_FILTER_SCAN_LIMIT,
  decimal,
  paymentStatus,
  scope,
  targetOrganization,
} from '../finance/finance.utils';
import { PrismaService } from '../prisma/prisma.service';

const incomeInclude = {
  sucursales: { select: { id: true, codigo: true, nombre: true } },
  operaciones: { select: { id: true, numero_operacion: true } },
  unidades_vehiculos: {
    select: { id: true, vin_mostrado: true, patente: true },
  },
  personal: { select: { id: true, nombre_completo: true } },
  cuentas_caja: {
    select: { id: true, codigo: true, nombre: true, tipo_cuenta: true },
  },
  movimientos_caja: {
    where: {
      revierte_a_id: null,
      other_movimientos_caja: null,
      tipo_movimiento: tipo_movimiento_caja_luma.INGRESO,
    },
    include: {
      cuentas_caja: {
        select: { id: true, codigo: true, nombre: true, tipo_cuenta: true },
      },
      personal: { select: { id: true, nombre_completo: true } },
    },
    orderBy: [{ contabilizado_en: 'desc' as const }, { id: 'desc' as const }],
  },
} satisfies Prisma.ingresosInclude;

type IncomeRecord = Prisma.ingresosGetPayload<{
  include: typeof incomeInclude;
}>;

@Injectable()
export class IncomesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
  ) {}

  async findAll(query: IncomeQueryDto, actor: AuthenticatedUser) {
    assertOrganization(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const search = query.search?.trim();
    const where: Prisma.ingresosWhereInput = {
      organizacion_id: organizationId,
      sucursal_id: query.branchId,
      tipo_original: query.type?.trim(),
      unidad_vehiculo_id: query.unitId,
      operacion_id: query.operationId,
      es_transferencia: false,
      fecha_ingreso:
        query.from || query.to
          ? {
              gte: query.from ? businessDate(query.from) : undefined,
              lte: query.to ? businessDate(query.to) : undefined,
            }
          : undefined,
      movimientos_caja:
        query.accountId || query.collectorId
          ? {
              some: {
                cuenta_caja_id: query.accountId,
                registrado_por_personal_id: query.collectorId,
                tipo_movimiento: tipo_movimiento_caja_luma.INGRESO,
                revierte_a_id: null,
                other_movimientos_caja: null,
              },
            }
          : undefined,
      OR: search
        ? [
            { tipo_original: { contains: search, mode: 'insensitive' } },
            { descripcion: { contains: search, mode: 'insensitive' } },
            { referencia: { contains: search, mode: 'insensitive' } },
            {
              unidades_vehiculos: {
                vin_mostrado: { contains: search, mode: 'insensitive' },
              },
            },
          ]
        : undefined,
    };
    const [total, rows] = await this.prisma.withTenant(
      scope(actor),
      async (tx) => {
        const orderBy = [
          { fecha_ingreso: 'desc' as const },
          { id: 'desc' as const },
        ];
        if (!query.status)
          return Promise.all([
            tx.ingresos.count({ where }),
            tx.ingresos.findMany({
              where,
              include: incomeInclude,
              orderBy,
              skip: (query.page - 1) * query.limit,
              take: query.limit,
            }),
          ]);
        const matching = await tx.ingresos.findMany({
          where,
          include: incomeInclude,
          orderBy,
          take: COMPUTED_FILTER_SCAN_LIMIT + 1,
        });
        assertComputedFilterScanLimit(matching.length);
        const filtered = matching.filter(
          (item) => this.income(item).paymentStatus === query.status,
        );
        const start = (query.page - 1) * query.limit;
        return [
          filtered.length,
          filtered.slice(start, start + query.limit),
        ] as const;
      },
    );
    const items = rows.map((row) => this.income(row));
    return { items, total, page: query.page, limit: query.limit };
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(scope(actor), async (tx) =>
      this.detail(await this.incomeOr404(tx, id, actor), tx, actor),
    );
  }

  async create(input: CreateIncomeDto, actor: AuthenticatedUser) {
    assertOrganization(actor, input.organizationId);
    const organizationId = input.organizationId ?? actor.organization.id;
    const total = decimal(input.totalAmount);
    return this.mutate(
      actor,
      'INCOME_CREATED',
      async (tx, event) => {
        await this.cash.branchOr400(tx, input.branchId, organizationId);
        await this.validateReferences(
          tx,
          input.unitId,
          input.operationId,
          input.branchId,
          organizationId,
        );
        const income = await tx.ingresos.create({
          data: {
            organizacion_id: organizationId,
            sucursal_id: input.branchId,
            fecha_ingreso: businessDate(input.incomeDate),
            tipo_original: input.type.trim(),
            descripcion: input.description.trim(),
            importe: total,
            moneda: input.currency ?? 'ARS',
            estado_registro: 'PENDIENTE',
            referencia: input.reference?.trim(),
            unidad_vehiculo_id: input.unitId,
            operacion_id: input.operationId,
            observaciones: input.notes?.trim(),
            es_transferencia: false,
          },
          include: incomeInclude,
        });
        event.entityId = income.id;
        return this.income(income);
      },
      undefined,
      organizationId,
    );
  }

  async update(id: string, input: UpdateIncomeDto, actor: AuthenticatedUser) {
    if (!Object.keys(input).length)
      throw new BadRequestException('At least one editable field is required');
    return this.mutate(
      actor,
      'INCOME_UPDATED',
      async (tx, event) => {
        const current = await this.incomeOr404(tx, id, actor, true);
        event.targetOrganizationId = targetOrganization(
          actor,
          current.organizacion_id,
        );
        const branchId = input.branchId ?? current.sucursal_id;
        await this.cash.branchOr400(tx, branchId, current.organizacion_id);
        await this.validateReferences(
          tx,
          input.unitId === undefined
            ? (current.unidad_vehiculo_id ?? undefined)
            : (input.unitId ?? undefined),
          input.operationId === undefined
            ? (current.operacion_id ?? undefined)
            : (input.operationId ?? undefined),
          branchId,
          current.organizacion_id,
        );
        const total =
          input.totalAmount === undefined
            ? current.importe
            : decimal(input.totalAmount);
        const collected = await this.cash.settledAmount(
          tx,
          { ingreso_id: id },
          tipo_movimiento_caja_luma.INGRESO,
        );
        if (total.lessThan(collected))
          financialConflict(
            'EDIT_BELOW_SETTLED',
            'Income total cannot be lower than active collections',
          );
        const updated = await tx.ingresos.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: current.organizacion_id,
            },
          },
          data: {
            sucursal_id: input.branchId,
            fecha_ingreso: input.incomeDate
              ? businessDate(input.incomeDate)
              : undefined,
            tipo_original: input.type?.trim(),
            referencia:
              input.reference === undefined
                ? undefined
                : input.reference?.trim() || null,
            unidad_vehiculo_id: input.unitId,
            operacion_id: input.operationId,
            descripcion: input.description?.trim(),
            importe: total,
            estado_registro: current.requiere_conciliacion
              ? current.estado_registro
              : paymentStatus(collected, total),
            observaciones:
              input.notes === undefined
                ? undefined
                : input.notes?.trim() || null,
          },
          include: incomeInclude,
        });
        return this.income(updated);
      },
      id,
    );
  }

  async collect(
    id: string,
    input: RegisterFinancialMovementDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'INCOME_COLLECTION_REGISTERED',
      async (tx, event) => {
        const income = await this.incomeOr404(tx, id, actor, true);
        event.targetOrganizationId = targetOrganization(
          actor,
          income.organizacion_id,
        );
        if (income.requiere_conciliacion)
          financialConflict(
            'INCOME_REQUIRES_RECONCILIATION',
            'Income must be reconciled before registering collections',
          );
        await this.cash.registerEntityMovement(
          tx,
          actor,
          income.organizacion_id,
          income.moneda,
          input,
          { ingreso_id: id },
          tipo_movimiento_caja_luma.INGRESO,
          direccion_caja_luma.CREDITO,
        );
        const collected = await this.cash.settledAmount(
          tx,
          { ingreso_id: id },
          tipo_movimiento_caja_luma.INGRESO,
        );
        if (collected.greaterThan(income.importe))
          financialConflict('OVERPAYMENT', 'Collection exceeds income balance');
        await tx.ingresos.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: income.organizacion_id,
            },
          },
          data: {
            estado_registro: income.requiere_conciliacion
              ? income.estado_registro
              : paymentStatus(collected, income.importe),
          },
        });
        return this.detail(await this.incomeOr404(tx, id, actor), tx, actor);
      },
      id,
    );
  }

  async reverse(
    id: string,
    movementId: string,
    input: ReverseFinancialMovementDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'INCOME_COLLECTION_REVERSED',
      async (tx, event) => {
        const income = await this.incomeOr404(tx, id, actor, true);
        event.targetOrganizationId = targetOrganization(
          actor,
          income.organizacion_id,
        );
        await this.cash.reverseEntityMovement(
          tx,
          actor,
          income.organizacion_id,
          movementId,
          input,
          { ingreso_id: id },
        );
        const collected = await this.cash.settledAmount(
          tx,
          { ingreso_id: id },
          tipo_movimiento_caja_luma.INGRESO,
        );
        await tx.ingresos.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: income.organizacion_id,
            },
          },
          data: {
            estado_registro: income.requiere_conciliacion
              ? income.estado_registro
              : paymentStatus(collected, income.importe),
          },
        });
        return this.detail(await this.incomeOr404(tx, id, actor), tx, actor);
      },
      id,
    );
  }

  private async detail(
    income: IncomeRecord,
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
  ) {
    const originalIds = await tx.movimientos_caja.findMany({
      where: { ingreso_id: income.id },
      select: { id: true },
    });
    return {
      ...this.income(income),
      movements: await this.cash.entityMovements(
        tx,
        {
          OR: [
            { ingreso_id: income.id },
            { revierte_a_id: { in: originalIds.map((item) => item.id) } },
          ],
        },
        actor,
      ),
    };
  }

  private income(item: IncomeRecord) {
    const collected = item.movimientos_caja.reduce(
      (total, movement) => total.plus(movement.importe),
      new Prisma.Decimal(0),
    );
    const latest = item.movimientos_caja[0];
    return {
      id: item.id,
      incomeDate: item.fecha_ingreso,
      type: item.tipo_original,
      reference: item.referencia,
      description: item.descripcion,
      totalAmount: item.importe.toString(),
      currency: item.moneda,
      paymentStatus: paymentStatus(collected, item.importe),
      paidAmount: collected.toString(),
      balanceAmount: item.importe.minus(collected).toString(),
      organizationId: item.organizacion_id,
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
      branch: {
        id: item.sucursales.id,
        code: item.sucursales.codigo,
        name: item.sucursales.nombre,
      },
      vehicle: item.unidades_vehiculos
        ? {
            unit: {
              id: item.unidades_vehiculos.id,
              vin: item.unidades_vehiculos.vin_mostrado,
              licensePlate: item.unidades_vehiculos.patente,
            },
          }
        : null,
      operation: item.operaciones
        ? {
            id: item.operaciones.id,
            number: item.operaciones.numero_operacion.toString(),
          }
        : null,
      collector: latest
        ? {
            id: latest.personal.id,
            fullName: latest.personal.nombre_completo,
          }
        : item.personal
          ? { id: item.personal.id, fullName: item.personal.nombre_completo }
          : null,
      account: latest
        ? {
            id: latest.cuentas_caja.id,
            code: latest.cuentas_caja.codigo,
            name: latest.cuentas_caja.nombre,
            type: latest.cuentas_caja.tipo_cuenta,
          }
        : item.cuentas_caja
          ? {
              id: item.cuentas_caja.id,
              code: item.cuentas_caja.codigo,
              name: item.cuentas_caja.nombre,
              type: item.cuentas_caja.tipo_cuenta,
            }
          : null,
      notes: item.observaciones,
    };
  }

  private async incomeOr404(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
    lock = false,
  ) {
    if (lock)
      await tx.$queryRaw`
        SELECT "id"
        FROM "public"."ingresos"
        WHERE "id" = CAST(${id} AS uuid)
          AND (${actor.globalAccess} OR "organizacion_id" = CAST(${actor.organization.id} AS uuid))
          AND NOT "es_transferencia"
        FOR UPDATE
      `;
    const income = await tx.ingresos.findFirst({
      where: {
        id,
        es_transferencia: false,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
      },
      include: incomeInclude,
    });
    if (!income) financialNotFound('Income');
    return income;
  }

  private async validateReferences(
    tx: Prisma.TransactionClient,
    unitId: string | undefined,
    operationId: string | undefined,
    branchId: string,
    organizationId: string,
  ) {
    const unit = unitId
      ? await this.cash.unitOr400(tx, unitId, organizationId)
      : undefined;
    const operation = operationId
      ? await this.cash.operationOr400(tx, operationId, organizationId)
      : undefined;
    if (unit && unit.sucursal_id !== branchId)
      financialBadRequest(
        'UNIT_BRANCH_MISMATCH',
        'Inventory unit must belong to the income branch',
      );
    if (operation && operation.sucursal_id !== branchId)
      financialBadRequest(
        'OPERATION_BRANCH_MISMATCH',
        'Sales operation must belong to the income branch',
      );
    if (
      unit &&
      operation?.unidad_vehiculo_id &&
      operation.unidad_vehiculo_id !== unit.id
    )
      financialBadRequest(
        'OPERATION_UNIT_MISMATCH',
        'Sales operation and inventory unit do not match',
      );
  }

  private mutate<T>(
    actor: AuthenticatedUser,
    action: string,
    work: (
      tx: Prisma.TransactionClient,
      event: AuthenticatedAuditEvent,
    ) => Promise<T>,
    entityId?: string,
    organizationId?: string,
  ) {
    const event: AuthenticatedAuditEvent = {
      action,
      entity: 'ingresos',
      entityId,
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId: targetOrganization(actor, organizationId),
    };
    return this.audit
      .execute(event, (tx) => work(tx, event))
      .catch((error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        )
          throw new BadRequestException('A referenced record is invalid');
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' || error.code === 'P2034')
        )
          throw new ConflictException('Income conflicts with another request');
        throw error;
      });
  }
}

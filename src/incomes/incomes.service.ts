import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  direccion_caja_luma,
  estado_rendicion_luma,
  metodo_cobranza_luma,
  Prisma,
  tipo_movimiento_caja_luma,
  tipo_vehiculo_luma,
} from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BranchScope } from '../branch-scope/branch-scope';
import { CashService } from '../cash/cash.service';
import {
  ConfirmCashHandoverDto,
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
  currencyTotals,
  decimal,
  groupedCurrencyTotals,
  paymentStatus,
  scope,
  targetOrganization,
} from '../finance/finance.utils';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertHandoverEditable,
  CashCollectionInput,
  handoverRecipientWhere,
  resolveCashCollection,
} from './cash-handover';
import { syncComponentPaymentStatus } from './component-collections';

const personnelSelect = {
  select: { id: true, nombre_completo: true },
} as const;

const incomeInclude = {
  sucursales: { select: { id: true, codigo: true, nombre: true } },
  operaciones: {
    select: {
      id: true,
      numero_operacion: true,
      numero_boleto: true,
      cliente_id: true,
      versiones_vehiculos: {
        select: {
          modelos_vehiculos: { select: { tipo_vehiculo: true } },
        },
      },
    },
  },
  unidades_vehiculos: {
    select: {
      id: true,
      vin_mostrado: true,
      patente: true,
      versiones_vehiculos: {
        select: {
          modelos_vehiculos: { select: { tipo_vehiculo: true } },
        },
      },
    },
  },
  personal: personnelSelect,
  clientes: {
    select: {
      id: true,
      nombre_completo: true,
      tipo_documento: true,
      numero_documento: true,
    },
  },
  componentes_pago_operacion: {
    select: { id: true, tipo_componente: true, importe_esperado: true },
  },
  rendido_a: personnelSelect,
  rendicion_confirmada_por: personnelSelect,
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

/**
 * Foto del ingreso que queda en la auditoría (`datos_anteriores` /
 * `datos_nuevos`), con nombres en vez de ids para poder leerla después
 * aunque el registro cambie.
 */
export function incomeAuditSnapshot(row: IncomeRecord) {
  return {
    type: row.tipo_original,
    description: row.descripcion,
    amount: row.importe.toString(),
    incomeDate: row.fecha_ingreso.toISOString().slice(0, 10),
    paymentMethod: row.medio_pago,
    collectedBy: row.personal?.nombre_completo ?? row.cobrado_por_original,
    handoverTo: row.rendido_a?.nombre_completo ?? null,
    handoverStatus: row.estado_rendicion,
    operationNumber: row.operaciones?.numero_operacion.toString() ?? null,
    client: row.clientes?.nombre_completo ?? null,
    branch: row.sucursales.nombre,
    reference: row.referencia,
    notes: row.observaciones,
  };
}

/**
 * Backstop for the database invariants of the income links (trigger
 * luma_validar_vinculos_ingreso and the cash CHECKs). The service validates
 * first; this only keeps a racing request from surfacing as a 500.
 */
export function mapIncomeLinkError(error: unknown): void {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('ingresos_cliente_operacion_consistente'))
    financialBadRequest(
      'CLIENT_OPERATION_MISMATCH',
      'The income client must be the client of the sales operation',
    );
  if (message.includes('ingresos_cuota_operacion_consistente'))
    financialBadRequest(
      'INSTALLMENT_OPERATION_MISMATCH',
      'The installment does not belong to the income operation',
    );
  if (message.includes('ingresos_componente_operacion_consistente'))
    financialBadRequest(
      'COMPONENT_OPERATION_MISMATCH',
      'The payment component does not belong to the income operation',
    );
  if (
    message.includes('ingresos_efectivo_requiere_cobrador') ||
    message.includes('ingresos_rendicion_contrato') ||
    message.includes('ingresos_efectivo_requiere_rendicion')
  )
    financialBadRequest(
      'INVALID_CASH_HANDOVER',
      'Cash collections require collector and handover recipient',
    );
}

/**
 * Reversing the cash movement of an own-credit installment gives the amount
 * back to the installment: it goes PARCIAL/PENDIENTE again and a finished
 * credit becomes ACTIVO.
 */
export async function reopenInstallment(
  tx: Prisma.TransactionClient,
  installmentId: string,
  organizationId: string,
  amount: Prisma.Decimal,
): Promise<void> {
  const rows = await tx.$queryRaw<
    Array<{ monto_pagado: Prisma.Decimal; operacion_credito_id: string }>
  >(Prisma.sql`
    SELECT monto_pagado, operacion_credito_id FROM cuotas_credito
    WHERE id = ${installmentId}::uuid AND organizacion_id = ${organizationId}::uuid
    FOR UPDATE
  `);
  const installment = rows[0];
  if (!installment) return;
  const paid = Prisma.Decimal.max(0, installment.monto_pagado.minus(amount));
  const status = paid.isZero() ? 'PENDIENTE' : 'PARCIAL';
  await tx.$executeRaw(Prisma.sql`
    UPDATE cuotas_credito SET
      monto_pagado = ${paid.toFixed(2)}::numeric,
      estado = ${status}::"estado_cuota_credito_luma",
      fecha_pago = NULL
    WHERE id = ${installmentId}::uuid AND organizacion_id = ${organizationId}::uuid
  `);
  await tx.$executeRaw(Prisma.sql`
    UPDATE operacion_creditos SET estado = 'ACTIVO'
    WHERE id = ${installment.operacion_credito_id}::uuid
      AND organizacion_id = ${organizationId}::uuid
      AND estado = 'FINALIZADO'
  `);
}

// Ingresos que pertenecen a la grilla de un tipo de vehículo: los de una
// unidad u operación de ese tipo y, sin ninguna de las dos, los cargados en
// ese circuito. Lo usan el listado y el conteo de rendiciones pendientes,
// para que el aviso y la grilla hablen de los mismos ingresos.
function vehicleTypeWhere(
  vehicleType: tipo_vehiculo_luma,
): Prisma.ingresosWhereInput[] {
  return [
    {
      OR: [
        { unidad_vehiculo_id: null },
        {
          unidades_vehiculos: {
            versiones_vehiculos: {
              modelos_vehiculos: { tipo_vehiculo: vehicleType },
            },
          },
        },
      ],
    },
    {
      OR: [
        { operacion_id: null },
        {
          operaciones: {
            versiones_vehiculos: {
              modelos_vehiculos: { tipo_vehiculo: vehicleType },
            },
          },
        },
      ],
    },
    // Sin unidad ni operación se clasifica por el circuito donde se
    // cargó; sin ese dato no pertenece a ninguna grilla por tipo.
    {
      OR: [
        { unidad_vehiculo_id: { not: null } },
        { operacion_id: { not: null } },
        { tipo_vehiculo: vehicleType },
      ],
    },
  ];
}

@Injectable()
export class IncomesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
  ) {}

  private normalizeTypeName(value: string) {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-AR');
  }

  async types(): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; nombre: string }>
    >(
      Prisma.sql`SELECT id, nombre FROM tipos_ingreso WHERE activo = true ORDER BY nombre ASC`,
    );
    return rows.map((row) => ({ id: row.id, name: row.nombre }));
  }

  private async assertValidType(
    tx: Prisma.TransactionClient,
    type: string,
  ): Promise<void> {
    const normalized = this.normalizeTypeName(type);
    const rows = await tx.$queryRaw<Array<{ exists: boolean }>>(
      Prisma.sql`SELECT EXISTS(
        SELECT 1 FROM tipos_ingreso
        WHERE nombre_normalizado = ${normalized} AND activo = true
      ) AS "exists"`,
    );
    if (!rows[0]?.exists)
      throw new BadRequestException(
        `Tipo de ingreso inválido: "${type}". Elegí uno de los tipos disponibles.`,
      );
  }

  async findAll(query: IncomeQueryDto, actor: AuthenticatedUser) {
    assertOrganization(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const search = query.search?.trim();
    const ticketNumber = query.ticketNumber?.trim();
    const where: Prisma.ingresosWhereInput = {
      organizacion_id: organizationId,
      sucursal_id: BranchScope.forActor(actor).where(query.branchId),
      tipo_original: query.type?.trim(),
      unidad_vehiculo_id: query.unitId,
      operacion_id: query.operationId,
      cliente_id: query.clientId,
      medio_pago: query.paymentMethod,
      estado_rendicion: query.handoverStatus,
      rendido_a_personal_id: query.handoverToId,
      es_transferencia: false,
      operaciones: ticketNumber
        ? {
            is: {
              numero_boleto: { contains: ticketNumber, mode: 'insensitive' },
            },
          }
        : undefined,
      AND: query.vehicleType ? vehicleTypeWhere(query.vehicleType) : undefined,
      fecha_ingreso:
        query.from || query.to
          ? {
              gte: query.from ? businessDate(query.from) : undefined,
              lte: query.to ? businessDate(query.to) : undefined,
            }
          : undefined,
      movimientos_caja:
        query.accountId || query.accountIds?.length || query.collectorId
          ? {
              some: {
                cuenta_caja_id: query.accountIds?.length
                  ? { in: query.accountIds }
                  : query.accountId,
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
            {
              operaciones: {
                is: {
                  numero_boleto: { contains: search, mode: 'insensitive' },
                },
              },
            },
            {
              clientes: {
                is: {
                  nombre_completo: { contains: search, mode: 'insensitive' },
                },
              },
            },
            {
              clientes: {
                is: {
                  numero_documento: { contains: search, mode: 'insensitive' },
                },
              },
            },
          ]
        : undefined,
    };
    const [total, rows, totals] = await this.prisma.withTenant(
      scope(actor),
      async (tx) => {
        const orderBy = [
          { fecha_ingreso: 'desc' as const },
          { id: 'desc' as const },
        ];
        if (!query.status) {
          const [count, page, sums] = await Promise.all([
            tx.ingresos.count({ where }),
            tx.ingresos.findMany({
              where,
              include: incomeInclude,
              orderBy,
              skip: (query.page - 1) * query.limit,
              take: query.limit,
            }),
            tx.ingresos.groupBy({
              by: ['moneda'],
              where,
              _sum: { importe: true },
            }),
          ]);
          return [count, page, groupedCurrencyTotals(sums)] as const;
        }
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
          currencyTotals(filtered),
        ] as const;
      },
    );
    const items = rows.map((row) => this.income(row));
    return { items, total, totals, page: query.page, limit: query.limit };
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(scope(actor), async (tx) =>
      this.detail(await this.incomeOr404(tx, id, actor), tx, actor),
    );
  }

  async create(input: CreateIncomeDto, actor: AuthenticatedUser) {
    assertOrganization(actor, input.organizationId);
    const organizationId = input.organizationId ?? actor.organization.id;
    const branchId = BranchScope.forActor(actor).resolveBranchId(
      input.branchId,
    );
    const total = decimal(input.totalAmount);
    return this.mutate(
      actor,
      'INCOME_CREATED',
      async (tx, event) => {
        await this.cash.branchOr400(tx, branchId, organizationId);
        await this.assertValidType(tx, input.type);
        const operation = await this.validateReferences(
          tx,
          input.unitId,
          input.operationId,
          branchId,
          organizationId,
        );
        const clientId = await this.resolveClient(
          tx,
          input.clientId,
          operation,
          organizationId,
        );
        const cashColumns = await resolveCashCollection(
          tx,
          organizationId,
          () => this.cash.actorPersonnelId(tx, actor, organizationId),
          {
            paymentMethod: input.paymentMethod,
            collectedById: input.collectedById,
            handoverToId: input.handoverToId,
          },
        );
        const income = await tx.ingresos.create({
          data: {
            organizacion_id: organizationId,
            sucursal_id: branchId,
            fecha_ingreso: businessDate(input.incomeDate),
            tipo_original: input.type.trim(),
            descripcion: input.description.trim(),
            importe: total,
            moneda: input.currency ?? 'ARS',
            estado_registro: 'PENDIENTE',
            referencia: input.reference?.trim(),
            unidad_vehiculo_id: input.unitId,
            operacion_id: input.operationId,
            tipo_vehiculo: input.vehicleType,
            cliente_id: clientId,
            ...cashColumns,
            observaciones: input.notes?.trim(),
            es_transferencia: false,
          },
          include: incomeInclude,
        });
        event.entityId = income.id;
        event.metadata = incomeAuditSnapshot(income);
        return this.income(income);
      },
      undefined,
      organizationId,
    );
  }

  async update(id: string, input: UpdateIncomeDto, actor: AuthenticatedUser) {
    if (!Object.keys(input).length)
      throw new BadRequestException('At least one editable field is required');
    if (input.branchId) BranchScope.forActor(actor).assert(input.branchId);
    return this.mutate(
      actor,
      'INCOME_UPDATED',
      async (tx, event) => {
        const current = await this.incomeOr404(tx, id, actor, true);
        event.targetOrganizationId = targetOrganization(
          actor,
          current.organizacion_id,
        );
        if (
          (current.componente_pago_id || current.cuota_credito_id) &&
          ((input.operationId !== undefined &&
            input.operationId !== current.operacion_id) ||
            (input.branchId !== undefined &&
              input.branchId !== current.sucursal_id) ||
            input.totalAmount !== undefined)
        )
          financialConflict(
            'INCOME_LINKED_TO_COMPONENT',
            'An income generated by a payment-plan or installment collection keeps its operation, branch and amount',
          );
        const branchId = input.branchId ?? current.sucursal_id;
        await this.cash.branchOr400(tx, branchId, current.organizacion_id);
        if (input.type !== undefined)
          await this.assertValidType(tx, input.type);
        const operationId =
          input.operationId === undefined
            ? (current.operacion_id ?? undefined)
            : (input.operationId ?? undefined);
        const operation = await this.validateReferences(
          tx,
          input.unitId === undefined
            ? (current.unidad_vehiculo_id ?? undefined)
            : (input.unitId ?? undefined),
          operationId,
          branchId,
          current.organizacion_id,
        );
        const clientId = await this.resolveClient(
          tx,
          input.clientId === undefined
            ? operation
              ? undefined
              : (current.cliente_id ?? undefined)
            : (input.clientId ?? undefined),
          operation,
          current.organizacion_id,
        );
        const cashChanged =
          input.paymentMethod !== undefined ||
          input.collectedById !== undefined ||
          input.handoverToId !== undefined;
        let cashColumns = {};
        if (cashChanged) {
          assertHandoverEditable(current);
          const cashInput: CashCollectionInput = {
            paymentMethod:
              input.paymentMethod === undefined
                ? (current.medio_pago ?? undefined)
                : (input.paymentMethod ?? undefined),
            collectedById:
              input.collectedById === undefined
                ? (current.cobrado_por_personal_id ?? undefined)
                : (input.collectedById ?? undefined),
            handoverToId:
              input.handoverToId === undefined
                ? (current.rendido_a_personal_id ?? undefined)
                : (input.handoverToId ?? undefined),
          };
          cashColumns = await resolveCashCollection(
            tx,
            current.organizacion_id,
            () =>
              this.cash.actorPersonnelId(tx, actor, current.organizacion_id),
            cashInput,
          );
        }
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
            cliente_id: clientId ?? null,
            ...cashColumns,
            version_fila: { increment: 1 },
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
        event.previousData = incomeAuditSnapshot(current);
        event.metadata = incomeAuditSnapshot(updated);
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
        if (income.componente_pago_id)
          await syncComponentPaymentStatus(
            tx,
            income.componente_pago_id,
            income.organizacion_id,
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
        const reversal = await this.cash.reverseEntityMovement(
          tx,
          actor,
          income.organizacion_id,
          movementId,
          input,
          { ingreso_id: id },
        );
        if (income.cuota_credito_id && reversal.revierte_a_id === movementId)
          await reopenInstallment(
            tx,
            income.cuota_credito_id,
            income.organizacion_id,
            reversal.importe,
          );
        if (income.componente_pago_id)
          await syncComponentPaymentStatus(
            tx,
            income.componente_pago_id,
            income.organizacion_id,
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

  /**
   * Lookup of the personnel who can receive cash handovers: active personnel
   * with an active user whose role has `caja.recibir_rendicion`, with what is
   * still pending to be handed to each of them.
   */
  // `vehicleType` acota los pendientes a los que muestra la grilla de ese
  // tipo (Ingresos de motos / de autos), para que el aviso de cada pantalla
  // cuente sólo lo que esa pantalla lista. Sin él, cuenta todo.
  async handoverRecipients(
    actor: AuthenticatedUser,
    organizationId?: string,
    vehicleType?: tipo_vehiculo_luma,
  ) {
    assertOrganization(actor, organizationId);
    const targetOrganizationId = organizationId ?? actor.organization.id;
    return this.prisma.withTenant(scope(actor), async (tx) => {
      const recipients = await tx.personal.findMany({
        where: handoverRecipientWhere(targetOrganizationId),
        select: { id: true, nombre_completo: true, usuario_id: true },
        orderBy: [{ nombre_completo: 'asc' }, { id: 'asc' }],
      });
      const pending = recipients.length
        ? await tx.ingresos.groupBy({
            by: ['rendido_a_personal_id'],
            where: {
              organizacion_id: targetOrganizationId,
              estado_rendicion: estado_rendicion_luma.PENDIENTE_RENDICION,
              rendido_a_personal_id: {
                in: recipients.map((recipient) => recipient.id),
              },
              ...(vehicleType
                ? {
                    es_transferencia: false,
                    AND: vehicleTypeWhere(vehicleType),
                  }
                : {}),
            },
            _count: { _all: true },
            _sum: { importe: true },
          })
        : [];
      const byRecipient = new Map(
        pending.map((row) => [row.rendido_a_personal_id, row]),
      );
      return recipients.map((recipient) => {
        const row = byRecipient.get(recipient.id);
        return {
          id: recipient.id,
          fullName: recipient.nombre_completo,
          isCurrentUser: recipient.usuario_id === actor.id,
          pendingCount: row?._count._all ?? 0,
          pendingAmount: (
            row?._sum.importe ?? new Prisma.Decimal(0)
          ).toString(),
        };
      });
    });
  }

  /**
   * Only the recipient confirms that the cash was handed over. Optimistic
   * concurrency through `expectedVersion`.
   */
  async confirmHandover(
    id: string,
    input: ConfirmCashHandoverDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'INCOME_CASH_HANDOVER_CONFIRMED',
      async (tx, event) => {
        const income = await this.incomeOr404(tx, id, actor, true);
        event.targetOrganizationId = targetOrganization(
          actor,
          income.organizacion_id,
        );
        if (income.version_fila !== input.expectedVersion)
          financialConflict(
            'VERSION_CONFLICT',
            'The income changed since it was loaded; reload and retry',
          );
        if (
          income.medio_pago !== metodo_cobranza_luma.EFECTIVO ||
          income.estado_rendicion !== estado_rendicion_luma.PENDIENTE_RENDICION
        )
          financialConflict(
            'HANDOVER_NOT_PENDING',
            'The income has no cash handover pending',
          );
        const personnelId = await this.cash.actorPersonnelId(
          tx,
          actor,
          income.organizacion_id,
        );
        if (personnelId !== income.rendido_a_personal_id)
          throw new ForbiddenException({
            statusCode: 403,
            error: 'Forbidden',
            code: 'HANDOVER_RECIPIENT_ONLY',
            message: 'Only the recipient can confirm the cash handover',
          });
        const collected = await this.cash.settledAmount(
          tx,
          { ingreso_id: id },
          tipo_movimiento_caja_luma.INGRESO,
        );
        if (collected.isZero())
          financialConflict(
            'HANDOVER_NOT_COLLECTED',
            'The income has no active collection to hand over',
          );
        await tx.ingresos.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: income.organizacion_id,
            },
          },
          data: {
            estado_rendicion: estado_rendicion_luma.RENDIDO,
            rendicion_confirmada_en: new Date(),
            rendicion_confirmada_por_personal_id: personnelId,
            version_fila: { increment: 1 },
          },
        });
        event.metadata = {
          amount: collected.toString(),
          handoverTo: income.rendido_a?.nombre_completo ?? null,
          collectedBy: income.personal?.nombre_completo ?? null,
        };
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
            vehicleType:
              item.unidades_vehiculos.versiones_vehiculos.modelos_vehiculos
                .tipo_vehiculo,
            unit: {
              id: item.unidades_vehiculos.id,
              vin: item.unidades_vehiculos.vin_mostrado,
              licensePlate: item.unidades_vehiculos.patente,
            },
          }
        : null,
      client: item.clientes
        ? {
            id: item.clientes.id,
            fullName: item.clientes.nombre_completo,
            documentType: item.clientes.tipo_documento,
            documentNumber: item.clientes.numero_documento,
          }
        : null,
      paymentComponent: item.componentes_pago_operacion
        ? {
            id: item.componentes_pago_operacion.id,
            type: item.componentes_pago_operacion.tipo_componente,
            expectedAmount:
              item.componentes_pago_operacion.importe_esperado.toString(),
          }
        : null,
      installmentId: item.cuota_credito_id,
      paymentMethod: item.medio_pago,
      collectedBy: item.personal
        ? { id: item.personal.id, fullName: item.personal.nombre_completo }
        : null,
      handover: item.estado_rendicion
        ? {
            status: item.estado_rendicion,
            recipient: item.rendido_a
              ? {
                  id: item.rendido_a.id,
                  fullName: item.rendido_a.nombre_completo,
                }
              : null,
            confirmedAt: item.rendicion_confirmada_en,
            confirmedBy: item.rendicion_confirmada_por
              ? {
                  id: item.rendicion_confirmada_por.id,
                  fullName: item.rendicion_confirmada_por.nombre_completo,
                }
              : null,
          }
        : null,
      rowVersion: item.version_fila,
      operation: item.operaciones
        ? {
            id: item.operaciones.id,
            number: item.operaciones.numero_operacion.toString(),
            ticketNumber: item.operaciones.numero_boleto,
            vehicleType:
              item.operaciones.versiones_vehiculos.modelos_vehiculos
                .tipo_vehiculo,
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
    const branchScope = BranchScope.forActor(actor);
    if (lock)
      await tx.$queryRaw`
        SELECT "id"
        FROM "public"."ingresos"
        WHERE "id" = CAST(${id} AS uuid)
          AND (${actor.globalAccess} OR "organizacion_id" = CAST(${actor.organization.id} AS uuid))
          AND ${branchScope.sql(Prisma.sql`"sucursal_id"`)}
          AND NOT "es_transferencia"
        FOR UPDATE
      `;
    const income = await tx.ingresos.findFirst({
      where: {
        id,
        es_transferencia: false,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
        sucursal_id: branchScope.where(),
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
    return operation;
  }

  // Doble asociación: con operación, el cliente es siempre el de la operación
  // (la base lo refuerza con un trigger); sin operación puede indicarse uno.
  private async resolveClient(
    tx: Prisma.TransactionClient,
    clientId: string | undefined,
    operation: { cliente_id: string } | undefined,
    organizationId: string,
  ): Promise<string | undefined> {
    if (operation) {
      if (clientId && clientId !== operation.cliente_id)
        financialBadRequest(
          'CLIENT_OPERATION_MISMATCH',
          'The income client must be the client of the sales operation',
        );
      return operation.cliente_id;
    }
    if (!clientId) return undefined;
    const client = await tx.clientes.findFirst({
      where: { id: clientId, organizacion_id: organizationId },
      select: { id: true },
    });
    if (!client) financialBadRequest('INVALID_CLIENT', 'Client is invalid');
    return client.id;
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
        mapIncomeLinkError(error);
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

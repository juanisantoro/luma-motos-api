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
  CreateExpenseDto,
  ExpenseQueryDto,
  FinancialPaymentStatus,
  RegisterFinancialMovementDto,
  ReverseFinancialMovementDto,
  UpdateExpenseDto,
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
  databasePaymentStatus,
  decimal,
  paymentStatus,
  scope,
  targetOrganization,
} from '../finance/finance.utils';
import { PrismaService } from '../prisma/prisma.service';

const expenseInclude = {
  sucursales: { select: { id: true, codigo: true, nombre: true } },
  personal: { select: { id: true, nombre_completo: true } },
  movimientos_caja: {
    where: {
      revierte_a_id: null,
      other_movimientos_caja: null,
      tipo_movimiento: {
        in: [
          tipo_movimiento_caja_luma.EGRESO,
          tipo_movimiento_caja_luma.INGRESO,
        ],
      },
    },
    include: {
      cuentas_caja: {
        select: { id: true, codigo: true, nombre: true, tipo_cuenta: true },
      },
      personal: { select: { id: true, nombre_completo: true } },
    },
    orderBy: [{ contabilizado_en: 'desc' as const }, { id: 'desc' as const }],
  },
} satisfies Prisma.gastosInclude;

type ExpenseRecord = Prisma.gastosGetPayload<{
  include: typeof expenseInclude;
}>;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
  ) {}

  async findAll(query: ExpenseQueryDto, actor: AuthenticatedUser) {
    assertOrganization(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const search = query.search?.trim();
    const where: Prisma.gastosWhereInput = {
      organizacion_id: organizationId,
      sucursal_id: query.branchId,
      categoria: query.category?.trim(),
      recuperable: query.recoverable,
      fecha_generacion:
        query.from || query.to
          ? {
              gte: query.from ? businessDate(query.from) : undefined,
              lte: query.to ? businessDate(query.to) : undefined,
            }
          : undefined,
      movimientos_caja: query.accountId
        ? {
            some: {
              cuenta_caja_id: query.accountId,
              revierte_a_id: null,
              other_movimientos_caja: null,
            },
          }
        : undefined,
      OR: search
        ? [
            { categoria: { contains: search, mode: 'insensitive' } },
            { detalle: { contains: search, mode: 'insensitive' } },
            { referencia_origen: { contains: search, mode: 'insensitive' } },
            { pagador_original: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    return this.prisma.withTenant(scope(actor), async (tx) => {
      const orderBy = [
        { fecha_generacion: 'desc' as const },
        { id: 'desc' as const },
      ];
      if (query.status === undefined && query.recovered === undefined) {
        const [total, rows] = await Promise.all([
          tx.gastos.count({ where }),
          tx.gastos.findMany({
            where,
            include: expenseInclude,
            orderBy,
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
        ]);
        return {
          items: rows.map((row) => this.expense(row)),
          total,
          page: query.page,
          limit: query.limit,
        };
      }
      const rows = await tx.gastos.findMany({
        where,
        include: expenseInclude,
        orderBy,
        take: COMPUTED_FILTER_SCAN_LIMIT + 1,
      });
      assertComputedFilterScanLimit(rows.length);
      const filtered = rows
        .map((row) => this.expense(row))
        .filter(
          (row) =>
            (query.recovered === undefined ||
              row.recovered === query.recovered) &&
            (query.status === undefined || row.paymentStatus === query.status),
        );
      const start = (query.page - 1) * query.limit;
      return {
        items: filtered.slice(start, start + query.limit),
        total: filtered.length,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(scope(actor), async (tx) =>
      this.detail(await this.expenseOr404(tx, id, actor), tx, actor),
    );
  }

  async create(input: CreateExpenseDto, actor: AuthenticatedUser) {
    assertOrganization(actor, input.organizationId);
    const organizationId = input.organizationId ?? actor.organization.id;
    const total = decimal(input.totalAmount);
    const expenseDate = businessDate(input.expenseDate);
    this.assertExpensePeriod(expenseDate, input.month, input.year);
    if (input.status !== FinancialPaymentStatus.PENDIENTE)
      financialBadRequest(
        'INITIAL_EXPENSE_STATUS_INVALID',
        'New expenses must start with status PENDIENTE; register payments separately',
      );
    if (input.recovered && input.recoverable === false)
      financialBadRequest(
        'RECOVERED_EXPENSE_NOT_RECOVERABLE',
        'A recovered expense must be recoverable',
      );
    return this.mutate(
      actor,
      'EXPENSE_CREATED',
      async (tx, event) => {
        if (input.branchId)
          await this.cash.branchOr400(tx, input.branchId, organizationId);
        const expense = await tx.gastos.create({
          data: {
            organizacion_id: organizationId,
            sucursal_id: input.branchId,
            fecha_generacion: expenseDate,
            categoria: input.category.trim(),
            referencia_origen: input.reference.trim(),
            detalle: input.description.trim(),
            importe: total,
            moneda: input.currency ?? 'ARS',
            recuperable: input.recoverable ?? input.recovered,
            recuperada: input.recovered,
            pagador_original: input.paidBy.trim(),
            estado_pago: 'PENDIENTE',
            creado_por_personal_id: await this.cash.actorPersonnelId(
              tx,
              actor,
              organizationId,
            ),
            datos_inferidos: input.notes?.trim()
              ? { observaciones: input.notes.trim() }
              : {},
          },
          include: expenseInclude,
        });
        event.entityId = expense.id;
        return this.expense(expense);
      },
      undefined,
      organizationId,
    );
  }

  async update(id: string, input: UpdateExpenseDto, actor: AuthenticatedUser) {
    if (!Object.keys(input).length)
      throw new BadRequestException('At least one editable field is required');
    return this.mutate(
      actor,
      'EXPENSE_UPDATED',
      async (tx, event) => {
        const current = await this.expenseOr404(tx, id, actor, true);
        event.targetOrganizationId = targetOrganization(
          actor,
          current.organizacion_id,
        );
        const branchId =
          input.branchId === undefined ? current.sucursal_id : input.branchId;
        if (branchId)
          await this.cash.branchOr400(tx, branchId, current.organizacion_id);
        const expenseDate = input.expenseDate
          ? businessDate(input.expenseDate)
          : current.fecha_generacion;
        this.assertExpensePeriod(
          expenseDate,
          input.month ?? expenseDate.getUTCMonth() + 1,
          input.year ?? expenseDate.getUTCFullYear(),
        );
        const total =
          input.totalAmount === undefined
            ? current.importe
            : decimal(input.totalAmount);
        const [paid, recovered] = await Promise.all([
          this.cash.settledAmount(
            tx,
            { gasto_id: id },
            tipo_movimiento_caja_luma.EGRESO,
          ),
          this.cash.settledAmount(
            tx,
            { gasto_id: id },
            tipo_movimiento_caja_luma.INGRESO,
          ),
        ]);
        if (total.lessThan(paid) || total.lessThan(recovered))
          financialConflict(
            'EDIT_BELOW_SETTLED',
            'Expense total cannot be lower than active payments or recoveries',
          );
        if (input.recoverable === false && recovered.isPositive())
          financialConflict(
            'RECOVERY_EXISTS',
            'Expense with active recoveries must remain recoverable',
          );
        const recoverable = input.recoverable ?? current.recuperable;
        const recoveredState = input.recovered ?? current.recuperada;
        if (recoveredState && !recoverable)
          financialBadRequest(
            'RECOVERED_EXPENSE_NOT_RECOVERABLE',
            'A recovered expense must be recoverable',
          );
        const previousData =
          current.datos_inferidos &&
          typeof current.datos_inferidos === 'object' &&
          !Array.isArray(current.datos_inferidos)
            ? current.datos_inferidos
            : {};
        const updated = await tx.gastos.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: current.organizacion_id,
            },
          },
          data: {
            sucursal_id: input.branchId,
            fecha_generacion: input.expenseDate
              ? businessDate(input.expenseDate)
              : undefined,
            categoria: input.category?.trim(),
            referencia_origen:
              input.reference === undefined
                ? undefined
                : input.reference.trim(),
            detalle: input.description?.trim(),
            importe: total,
            recuperable: input.recoverable,
            recuperada: input.recovered,
            pagador_original: input.paidBy?.trim(),
            estado_pago: databasePaymentStatus(paymentStatus(paid, total)),
            datos_inferidos:
              input.notes === undefined
                ? undefined
                : {
                    ...previousData,
                    observaciones: input.notes?.trim() || null,
                  },
          },
          include: expenseInclude,
        });
        return this.expense(updated);
      },
      id,
    );
  }

  async pay(
    id: string,
    input: RegisterFinancialMovementDto,
    actor: AuthenticatedUser,
  ) {
    return this.addMovement(
      id,
      input,
      actor,
      'EXPENSE_PAYMENT_REGISTERED',
      tipo_movimiento_caja_luma.EGRESO,
      direccion_caja_luma.DEBITO,
    );
  }

  async recover(
    id: string,
    input: RegisterFinancialMovementDto,
    actor: AuthenticatedUser,
  ) {
    return this.addMovement(
      id,
      input,
      actor,
      'EXPENSE_RECOVERY_REGISTERED',
      tipo_movimiento_caja_luma.INGRESO,
      direccion_caja_luma.CREDITO,
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
      'EXPENSE_MOVEMENT_REVERSED',
      async (tx, event) => {
        const expense = await this.expenseOr404(tx, id, actor, true);
        event.targetOrganizationId = targetOrganization(
          actor,
          expense.organizacion_id,
        );
        await this.cash.reverseEntityMovement(
          tx,
          actor,
          expense.organizacion_id,
          movementId,
          input,
          { gasto_id: id },
        );
        const paid = await this.cash.settledAmount(
          tx,
          { gasto_id: id },
          tipo_movimiento_caja_luma.EGRESO,
        );
        await tx.gastos.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: expense.organizacion_id,
            },
          },
          data: {
            estado_pago: databasePaymentStatus(
              paymentStatus(paid, expense.importe),
            ),
          },
        });
        return this.detail(await this.expenseOr404(tx, id, actor), tx, actor);
      },
      id,
    );
  }

  private async addMovement(
    id: string,
    input: RegisterFinancialMovementDto,
    actor: AuthenticatedUser,
    auditAction: string,
    type: tipo_movimiento_caja_luma,
    direction: direccion_caja_luma,
  ) {
    return this.mutate(
      actor,
      auditAction,
      async (tx, event) => {
        const expense = await this.expenseOr404(tx, id, actor, true);
        event.targetOrganizationId = targetOrganization(
          actor,
          expense.organizacion_id,
        );
        if (type === tipo_movimiento_caja_luma.INGRESO && !expense.recuperable)
          financialConflict(
            'EXPENSE_NOT_RECOVERABLE',
            'Expense is not marked as recoverable',
          );
        await this.cash.registerEntityMovement(
          tx,
          actor,
          expense.organizacion_id,
          expense.moneda,
          input,
          { gasto_id: id },
          type,
          direction,
        );
        const [paid, recovered] = await Promise.all([
          this.cash.settledAmount(
            tx,
            { gasto_id: id },
            tipo_movimiento_caja_luma.EGRESO,
          ),
          this.cash.settledAmount(
            tx,
            { gasto_id: id },
            tipo_movimiento_caja_luma.INGRESO,
          ),
        ]);
        if (paid.greaterThan(expense.importe))
          financialConflict('OVERPAYMENT', 'Payment exceeds expense balance');
        if (recovered.greaterThan(expense.importe))
          financialConflict(
            'OVER_RECOVERY',
            'Recovery exceeds recoverable expense balance',
          );
        await tx.gastos.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: expense.organizacion_id,
            },
          },
          data: {
            estado_pago: databasePaymentStatus(
              paymentStatus(paid, expense.importe),
            ),
          },
        });
        return this.detail(await this.expenseOr404(tx, id, actor), tx, actor);
      },
      id,
    );
  }

  private async detail(
    expense: ExpenseRecord,
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
  ) {
    const originalIds = await tx.movimientos_caja.findMany({
      where: { gasto_id: expense.id },
      select: { id: true },
    });
    return {
      ...this.expense(expense),
      movements: await this.cash.entityMovements(
        tx,
        {
          OR: [
            { gasto_id: expense.id },
            { revierte_a_id: { in: originalIds.map((item) => item.id) } },
          ],
        },
        actor,
      ),
    };
  }

  private expense(item: ExpenseRecord) {
    const paid = this.amountByType(item, tipo_movimiento_caja_luma.EGRESO);
    const recovered = this.amountByType(
      item,
      tipo_movimiento_caja_luma.INGRESO,
    );
    const latestPayment = item.movimientos_caja.find(
      (movement) =>
        movement.tipo_movimiento === tipo_movimiento_caja_luma.EGRESO,
    );
    const notes =
      item.datos_inferidos &&
      typeof item.datos_inferidos === 'object' &&
      !Array.isArray(item.datos_inferidos) &&
      'observaciones' in item.datos_inferidos &&
      typeof item.datos_inferidos.observaciones === 'string'
        ? item.datos_inferidos.observaciones
        : null;
    return {
      id: item.id,
      expenseDate: item.fecha_generacion,
      month: item.fecha_generacion.getUTCMonth() + 1,
      year: item.fecha_generacion.getUTCFullYear(),
      category: item.categoria,
      reference: item.referencia_origen,
      description: item.detalle,
      totalAmount: item.importe.toString(),
      currency: item.moneda,
      paymentStatus: paymentStatus(paid, item.importe),
      paidAmount: paid.toString(),
      balanceAmount: item.importe.minus(paid).toString(),
      recoverable: item.recuperable,
      recovered:
        item.recuperada ||
        (item.recuperable && recovered.greaterThanOrEqualTo(item.importe)),
      recoveredAmount: recovered.toString(),
      recoverableBalance: item.recuperable
        ? item.importe.minus(recovered).toString()
        : '0',
      organizationId: item.organizacion_id,
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
      branch: item.sucursales
        ? {
            id: item.sucursales.id,
            code: item.sucursales.codigo,
            name: item.sucursales.nombre,
          }
        : null,
      createdBy: {
        id: item.personal.id,
        fullName: item.personal.nombre_completo,
      },
      paidBy: item.pagador_original,
      paymentRegisteredBy: latestPayment
        ? {
            id: latestPayment.personal.id,
            fullName: latestPayment.personal.nombre_completo,
          }
        : null,
      account: latestPayment
        ? {
            id: latestPayment.cuentas_caja.id,
            code: latestPayment.cuentas_caja.codigo,
            name: latestPayment.cuentas_caja.nombre,
            type: latestPayment.cuentas_caja.tipo_cuenta,
          }
        : null,
      notes,
    };
  }

  private amountByType(item: ExpenseRecord, type: tipo_movimiento_caja_luma) {
    return item.movimientos_caja
      .filter((movement) => movement.tipo_movimiento === type)
      .reduce(
        (total, movement) => total.plus(movement.importe),
        new Prisma.Decimal(0),
      );
  }

  private async expenseOr404(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
    lock = false,
  ) {
    if (lock)
      await tx.$queryRaw`
        SELECT "id"
        FROM "public"."gastos"
        WHERE "id" = CAST(${id} AS uuid)
          AND (${actor.globalAccess} OR "organizacion_id" = CAST(${actor.organization.id} AS uuid))
        FOR UPDATE
      `;
    const expense = await tx.gastos.findFirst({
      where: {
        id,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
      },
      include: expenseInclude,
    });
    if (!expense) financialNotFound('Expense');
    return expense;
  }

  private assertExpensePeriod(expenseDate: Date, month: number, year: number) {
    if (
      expenseDate.getUTCMonth() + 1 !== month ||
      expenseDate.getUTCFullYear() !== year
    )
      financialBadRequest(
        'EXPENSE_PERIOD_MISMATCH',
        'month and year must match expenseDate',
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
      entity: 'gastos',
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
          throw new ConflictException('Expense conflicts with another request');
        throw error;
      });
  }
}

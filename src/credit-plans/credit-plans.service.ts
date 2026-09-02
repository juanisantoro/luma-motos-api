import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CashService } from '../cash/cash.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildInstallmentSchedule, simulateCredit } from './credit-calculator';
import {
  ConfirmOperationCreditDto,
  CreateCreditPlanDto,
  CreditInstallmentQueryDto,
  CreditInstallmentStatus,
  CreditPlanQueryDto,
  PayCreditInstallmentDto,
  UpdateCreditPlanDto,
} from './credit-plans.dto';

type CreditPlanRow = {
  id: string;
  nombre: string;
  metodo_calculo: 'FRANCES' | 'INTERES_SIMPLE';
  cantidad_cuotas: number;
  tasa_interes: Prisma.Decimal;
  monto_minimo: Prisma.Decimal | null;
  monto_maximo: Prisma.Decimal | null;
  activo: boolean;
  creado_en: Date;
  actualizado_en: Date;
};

type OperationCreditRow = {
  id: string;
  operacion_id: string;
  plan_credito_id: string | null;
  metodo_calculo: 'FRANCES' | 'INTERES_SIMPLE';
  cantidad_cuotas: number;
  tasa_interes: Prisma.Decimal;
  monto_financiado: Prisma.Decimal;
  interes_total: Prisma.Decimal;
  monto_total: Prisma.Decimal;
  monto_cuota: Prisma.Decimal;
  estado: 'ACTIVO' | 'CANCELADO' | 'FINALIZADO';
  creado_en: Date;
  numero_operacion: bigint;
};

type InstallmentRow = {
  id: string;
  operacion_credito_id: string;
  numero_cuota: number;
  monto: Prisma.Decimal;
  vencimiento: Date;
  estado: CreditInstallmentStatus;
  estado_efectivo: CreditInstallmentStatus;
  monto_pagado: Prisma.Decimal;
  fecha_pago: Date | null;
  creado_en: Date;
  actualizado_en: Date;
  operacion_id: string;
  numero_operacion: bigint;
  cliente_nombre: string;
};

function parseBusinessDate(value: string): Date {
  const result = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(result.getTime()) ||
    result.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('Invalid business date');
  }
  return result;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class CreditPlansService {
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

  private resolveOrganizationId(actor: AuthenticatedUser, requested?: string) {
    if (requested && requested !== actor.organization.id && !actor.globalAccess) {
      throw new BadRequestException(
        'Only users with global access can select an organization',
      );
    }
    return requested ?? actor.organization.id;
  }

  private mapPlan(row: CreditPlanRow) {
    return {
      id: row.id,
      name: row.nombre,
      calculationMethod: row.metodo_calculo,
      installmentCount: row.cantidad_cuotas,
      interestRate: Number(row.tasa_interes),
      minimumAmount: row.monto_minimo === null ? null : Number(row.monto_minimo),
      maximumAmount: row.monto_maximo === null ? null : Number(row.monto_maximo),
      active: row.activo,
      createdAt: row.creado_en.toISOString(),
      updatedAt: row.actualizado_en.toISOString(),
    };
  }

  async listPlans(query: CreditPlanQueryDto, actor: AuthenticatedUser) {
    const organizationId =
      query.organizationId ?? (actor.globalAccess ? undefined : actor.organization.id);
    const conditions: Prisma.Sql[] = [];
    if (organizationId) conditions.push(Prisma.sql`organizacion_id = ${organizationId}::uuid`);
    if (query.active !== undefined) conditions.push(Prisma.sql`activo = ${query.active}`);
    if (query.amount !== undefined) {
      conditions.push(Prisma.sql`
        (monto_minimo IS NULL OR monto_minimo <= ${query.amount}::numeric)
        AND (monto_maximo IS NULL OR monto_maximo >= ${query.amount}::numeric)
      `);
    }
    const where = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.sql``;

    const rows = await this.prisma.withTenant(this.scope(actor), (tx) =>
      tx.$queryRaw<CreditPlanRow[]>(Prisma.sql`
        SELECT id, nombre, metodo_calculo, cantidad_cuotas, tasa_interes,
          monto_minimo, monto_maximo, activo, creado_en, actualizado_en
        FROM planes_credito
        ${where}
        ORDER BY activo DESC, nombre ASC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
      `),
    );
    const [{ count }] = await this.prisma.withTenant(this.scope(actor), (tx) =>
      tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count FROM planes_credito ${where}
      `),
    );
    return {
      items: rows.map((row) => this.mapPlan(row)),
      total: Number(count),
      page: query.page,
      limit: query.limit,
    };
  }

  private validateAmountRange(minimum?: number | null, maximum?: number | null) {
    if (
      minimum !== undefined &&
      minimum !== null &&
      maximum !== undefined &&
      maximum !== null &&
      maximum < minimum
    ) {
      throw new BadRequestException(
        'maximumAmount cannot be lower than minimumAmount',
      );
    }
  }

  async createPlan(input: CreateCreditPlanDto, actor: AuthenticatedUser) {
    this.resolveOrganizationId(actor, input.organizationId);
    const organizationId = input.organizationId ?? actor.organization.id;
    this.validateAmountRange(input.minimumAmount, input.maximumAmount);

    const event: AuthenticatedAuditEvent = {
      action: 'CREDIT_PLAN_CREATED',
      entity: 'planes_credito',
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId: organizationId,
    };
    return this.audit.execute(event, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        INSERT INTO planes_credito (
          organizacion_id, nombre, metodo_calculo, cantidad_cuotas, tasa_interes,
          monto_minimo, monto_maximo, activo
        ) VALUES (
          ${organizationId}::uuid, ${input.name.trim()}, ${input.calculationMethod}::"metodo_calculo_credito_luma",
          ${input.installmentCount}, ${input.interestRate}::numeric,
          ${input.minimumAmount ?? null}::numeric, ${input.maximumAmount ?? null}::numeric,
          ${input.active ?? true}
        )
        RETURNING id
      `);
      event.entityId = rows[0].id;
      return this.planDetail(tx, rows[0].id);
    });
  }

  async updatePlan(id: string, input: UpdateCreditPlanDto, actor: AuthenticatedUser) {
    if (!Object.keys(input).length) {
      throw new BadRequestException('At least one editable field is required');
    }
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const current = await tx.$queryRaw<
        Array<{
          organizacion_id: string;
          monto_minimo: Prisma.Decimal | null;
          monto_maximo: Prisma.Decimal | null;
        }>
      >(Prisma.sql`
        SELECT organizacion_id, monto_minimo, monto_maximo FROM planes_credito
        WHERE id = ${id}::uuid
        AND (${actor.globalAccess} OR organizacion_id = ${actor.organization.id}::uuid)
      `);
      if (!current[0]) throw new NotFoundException('Credit plan not found');
      const organizationId = current[0].organizacion_id;

      const nextMinimum =
        input.minimumAmount === undefined
          ? current[0].monto_minimo === null
            ? null
            : Number(current[0].monto_minimo)
          : input.minimumAmount;
      const nextMaximum =
        input.maximumAmount === undefined
          ? current[0].monto_maximo === null
            ? null
            : Number(current[0].monto_maximo)
          : input.maximumAmount;
      this.validateAmountRange(nextMinimum, nextMaximum);

      const event: AuthenticatedAuditEvent = {
        action: 'CREDIT_PLAN_UPDATED',
        entity: 'planes_credito',
        entityId: id,
        actorId: actor.id,
        organizationId: actor.organization.id,
        globalAccess: actor.globalAccess,
        targetOrganizationId: organizationId,
      };
      await this.audit.record(event, tx);

      await tx.$executeRaw(Prisma.sql`
        UPDATE planes_credito SET
          nombre = COALESCE(${input.name?.trim() ?? null}, nombre),
          metodo_calculo = COALESCE(${input.calculationMethod ?? null}::"metodo_calculo_credito_luma", metodo_calculo),
          cantidad_cuotas = COALESCE(${input.installmentCount ?? null}, cantidad_cuotas),
          tasa_interes = COALESCE(${input.interestRate ?? null}::numeric, tasa_interes),
          monto_minimo = ${input.minimumAmount === undefined ? Prisma.sql`monto_minimo` : Prisma.sql`${input.minimumAmount}::numeric`},
          monto_maximo = ${input.maximumAmount === undefined ? Prisma.sql`monto_maximo` : Prisma.sql`${input.maximumAmount}::numeric`},
          activo = COALESCE(${input.active ?? null}, activo)
        WHERE id = ${id}::uuid
      `);
      return this.planDetail(tx, id);
    });
  }

  private async planDetail(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<CreditPlanRow[]>(Prisma.sql`
      SELECT id, nombre, metodo_calculo, cantidad_cuotas, tasa_interes,
        monto_minimo, monto_maximo, activo, creado_en, actualizado_en
      FROM planes_credito WHERE id = ${id}::uuid
    `);
    if (!rows[0]) throw new NotFoundException('Credit plan not found');
    return this.mapPlan(rows[0]);
  }

  private mapOperationCredit(row: OperationCreditRow) {
    return {
      id: row.id,
      operationId: row.operacion_id,
      operationNumber: row.numero_operacion.toString(),
      planId: row.plan_credito_id,
      calculationMethod: row.metodo_calculo,
      installmentCount: row.cantidad_cuotas,
      interestRate: Number(row.tasa_interes),
      financedAmount: Number(row.monto_financiado),
      totalInterest: Number(row.interes_total),
      totalAmount: Number(row.monto_total),
      installmentAmount: Number(row.monto_cuota),
      status: row.estado,
      createdAt: row.creado_en.toISOString(),
    };
  }

  private mapInstallment(row: InstallmentRow) {
    return {
      id: row.id,
      operationCreditId: row.operacion_credito_id,
      operationId: row.operacion_id,
      operationNumber: row.numero_operacion.toString(),
      clientName: row.cliente_nombre,
      number: row.numero_cuota,
      amount: Number(row.monto),
      dueDate: toIsoDate(row.vencimiento),
      status: row.estado_efectivo,
      paidAmount: Number(row.monto_pagado),
      paidAt: row.fecha_pago ? toIsoDate(row.fecha_pago) : null,
      createdAt: row.creado_en.toISOString(),
      updatedAt: row.actualizado_en.toISOString(),
    };
  }

  private async assertOperationInScope(
    tx: Prisma.TransactionClient,
    operationId: string,
    organizationId: string,
  ) {
    const operation = await tx.operaciones.findFirst({
      where: { id: operationId, organizacion_id: organizationId },
      select: { id: true },
    });
    if (!operation) throw new NotFoundException('Sales operation not found');
  }

  async getOperationCredit(operationId: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      await this.assertOperationInScope(tx, operationId, actor.organization.id);
      const rows = await tx.$queryRaw<OperationCreditRow[]>(Prisma.sql`
        SELECT oc.id, oc.operacion_id, oc.plan_credito_id, oc.metodo_calculo,
          oc.cantidad_cuotas, oc.tasa_interes, oc.monto_financiado, oc.interes_total,
          oc.monto_total, oc.monto_cuota, oc.estado, oc.creado_en, o.numero_operacion
        FROM operacion_creditos oc
        JOIN operaciones o ON o.id = oc.operacion_id
        WHERE oc.operacion_id = ${operationId}::uuid
        ORDER BY oc.creado_en DESC
        LIMIT 1
      `);
      if (!rows[0]) return null;
      const installments = await tx.$queryRaw<
        Array<{
          id: string;
          numero_cuota: number;
          monto: Prisma.Decimal;
          vencimiento: Date;
          estado: CreditInstallmentStatus;
          monto_pagado: Prisma.Decimal;
          fecha_pago: Date | null;
        }>
      >(Prisma.sql`
        SELECT id, numero_cuota, monto, vencimiento, estado, monto_pagado, fecha_pago
        FROM cuotas_credito
        WHERE operacion_credito_id = ${rows[0].id}::uuid
        ORDER BY numero_cuota ASC
      `);
      return {
        ...this.mapOperationCredit(rows[0]),
        installments: installments.map((installment) => ({
          id: installment.id,
          number: installment.numero_cuota,
          amount: Number(installment.monto),
          dueDate: toIsoDate(installment.vencimiento),
          status: installment.estado,
          paidAmount: Number(installment.monto_pagado),
          paidAt: installment.fecha_pago ? toIsoDate(installment.fecha_pago) : null,
        })),
      };
    });
  }

  async confirmOperationCredit(
    operationId: string,
    input: ConfirmOperationCreditDto,
    actor: AuthenticatedUser,
  ) {
    const event: AuthenticatedAuditEvent = {
      action: 'OPERATION_CREDIT_CONFIRMED',
      entity: 'operacion_creditos',
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId: actor.organization.id,
    };
    return this.audit.execute(event, async (tx) => {
      const organizationId = actor.organization.id;
      await this.assertOperationInScope(tx, operationId, organizationId);

      const planRows = await tx.$queryRaw<CreditPlanRow[]>(Prisma.sql`
        SELECT id, nombre, metodo_calculo, cantidad_cuotas, tasa_interes,
          monto_minimo, monto_maximo, activo, creado_en, actualizado_en
        FROM planes_credito
        WHERE id = ${input.planId}::uuid AND organizacion_id = ${organizationId}::uuid
      `);
      const plan = planRows[0];
      if (!plan || !plan.activo) {
        throw new BadRequestException('Invalid or inactive credit plan');
      }
      const minimum = plan.monto_minimo === null ? null : Number(plan.monto_minimo);
      const maximum = plan.monto_maximo === null ? null : Number(plan.monto_maximo);
      if (minimum !== null && input.financedAmount < minimum) {
        throw new BadRequestException(
          `The financed amount is below the plan's minimum (${minimum})`,
        );
      }
      if (maximum !== null && input.financedAmount > maximum) {
        throw new BadRequestException(
          `The financed amount is above the plan's maximum (${maximum})`,
        );
      }

      const simulation = simulateCredit(
        input.financedAmount,
        plan.cantidad_cuotas,
        Number(plan.tasa_interes),
        plan.metodo_calculo,
      );
      const personnelId = await this.cash.actorPersonnelId(tx, actor, organizationId);

      const creditRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        INSERT INTO operacion_creditos (
          organizacion_id, operacion_id, plan_credito_id, metodo_calculo,
          cantidad_cuotas, tasa_interes, monto_financiado, interes_total,
          monto_total, monto_cuota, estado, creado_por_personal_id
        ) VALUES (
          ${organizationId}::uuid, ${operationId}::uuid, ${plan.id}::uuid,
          ${plan.metodo_calculo}::"metodo_calculo_credito_luma", ${plan.cantidad_cuotas},
          ${Number(plan.tasa_interes)}::numeric, ${input.financedAmount}::numeric,
          ${simulation.totalInterest}::numeric, ${simulation.totalAmount}::numeric,
          ${simulation.installmentAmount}::numeric, 'ACTIVO', ${personnelId}::uuid
        )
        RETURNING id
      `);
      const operationCreditId = creditRows[0].id;
      event.entityId = operationCreditId;

      const schedule = buildInstallmentSchedule(
        simulation,
        parseBusinessDate(input.firstDueDate),
      );
      const installmentRows = schedule.map(
        (installment) => Prisma.sql`(
          ${organizationId}::uuid, ${operationCreditId}::uuid, ${installment.number},
          ${installment.amount}::numeric, ${toIsoDate(installment.dueDate)}::date, 'PENDIENTE'
        )`,
      );
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO cuotas_credito (
          organizacion_id, operacion_credito_id, numero_cuota, monto, vencimiento, estado
        ) VALUES ${Prisma.join(installmentRows)}
      `);

      return this.getOperationCredit(operationId, actor);
    });
  }

  private installmentJoinedSelect() {
    return Prisma.sql`
      SELECT
        c.id, c.operacion_credito_id, c.numero_cuota, c.monto, c.vencimiento,
        c.estado,
        CASE
          WHEN c.estado IN ('PENDIENTE', 'PARCIAL') AND c.vencimiento < CURRENT_DATE
          THEN 'VENCIDA'
          ELSE c.estado
        END AS estado_efectivo,
        c.monto_pagado, c.fecha_pago, c.creado_en, c.actualizado_en,
        oc.operacion_id, o.numero_operacion, cl.nombre_completo AS cliente_nombre
      FROM cuotas_credito c
      JOIN operacion_creditos oc ON oc.id = c.operacion_credito_id
      JOIN operaciones o ON o.id = oc.operacion_id
      JOIN clientes cl ON cl.id = o.cliente_id
    `;
  }

  // --- Dashboard support. All three join cuotas_credito -> operacion_creditos
  // -> operaciones the same way installmentJoinedSelect() above does, since
  // that is how a branch is reached from an installment (cuotas_credito
  // itself only carries organizacion_id). branchId omitted means org-wide
  // (the ADMINISTRADOR home); passed means one branch (GERENTE/ADMINISTRATIVA).

  // "cartera de créditos personales activa": total financed amount of
  // credits still ACTIVO, plus how much of their installments is currently
  // in arrears (vencimiento < today, still PENDIENTE/PARCIAL).
  async personalCreditPortfolio(actor: AuthenticatedUser, branchId?: string) {
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const [financed, overdue] = await Promise.all([
        tx.$queryRaw<Array<{ total: Prisma.Decimal | null }>>(Prisma.sql`
          SELECT SUM(oc.monto_total) AS total
          FROM operacion_creditos oc
          JOIN operaciones o ON o.id = oc.operacion_id
          WHERE oc.organizacion_id = ${actor.organization.id}::uuid
            AND oc.estado = 'ACTIVO'
            ${branchId ? Prisma.sql`AND o.sucursal_id = ${branchId}::uuid` : Prisma.empty}
        `),
        tx.$queryRaw<Array<{ total: Prisma.Decimal | null; count: bigint }>>(Prisma.sql`
          SELECT SUM(c.monto - c.monto_pagado) AS total, COUNT(*)::bigint AS count
          FROM cuotas_credito c
          JOIN operacion_creditos oc ON oc.id = c.operacion_credito_id
          JOIN operaciones o ON o.id = oc.operacion_id
          WHERE c.organizacion_id = ${actor.organization.id}::uuid
            AND c.estado IN ('PENDIENTE', 'PARCIAL')
            AND c.vencimiento < CURRENT_DATE
            ${branchId ? Prisma.sql`AND o.sucursal_id = ${branchId}::uuid` : Prisma.empty}
        `),
      ]);
      return {
        financedAmount: Number(financed[0]?.total ?? 0),
        overdueAmount: Number(overdue[0]?.total ?? 0),
        overdueInstallments: Number(overdue[0]?.count ?? 0),
      };
    });
  }

  // Alert strip (ADMINISTRATIVA home): total amount and distinct client
  // count of installments due exactly today for one branch, still unpaid -
  // unconstrained by any list limit, unlike dueToday() below which is the
  // capped panel listing.
  async dueTodaySummary(actor: AuthenticatedUser, branchId: string) {
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ total: Prisma.Decimal | null; clients: bigint }>
      >(Prisma.sql`
        SELECT SUM(c.monto - c.monto_pagado) AS total, COUNT(DISTINCT o.cliente_id)::bigint AS clients
        FROM cuotas_credito c
        JOIN operacion_creditos oc ON oc.id = c.operacion_credito_id
        JOIN operaciones o ON o.id = oc.operacion_id
        WHERE c.organizacion_id = ${actor.organization.id}::uuid
          AND o.sucursal_id = ${branchId}::uuid
          AND c.estado IN ('PENDIENTE', 'PARCIAL')
          AND c.vencimiento = CURRENT_DATE
      `);
      return {
        amount: Number(rows[0]?.total ?? 0),
        clientCount: Number(rows[0]?.clients ?? 0),
      };
    });
  }

  // "cuotas por cobrar esta semana" (ADMINISTRATIVA KPI): amount and count
  // of installments due within [from, to] for one branch, still unpaid.
  async dueInRange(
    actor: AuthenticatedUser,
    branchId: string,
    from: Date,
    to: Date,
  ) {
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const rows = await tx.$queryRaw<Array<{ total: Prisma.Decimal | null; count: bigint }>>(
        Prisma.sql`
          SELECT SUM(c.monto - c.monto_pagado) AS total, COUNT(*)::bigint AS count
          FROM cuotas_credito c
          JOIN operacion_creditos oc ON oc.id = c.operacion_credito_id
          JOIN operaciones o ON o.id = oc.operacion_id
          WHERE c.organizacion_id = ${actor.organization.id}::uuid
            AND o.sucursal_id = ${branchId}::uuid
            AND c.estado IN ('PENDIENTE', 'PARCIAL')
            AND c.vencimiento BETWEEN ${from}::date AND ${to}::date
        `,
      );
      return {
        amount: Number(rows[0]?.total ?? 0),
        count: Number(rows[0]?.count ?? 0),
      };
    });
  }

  // "Cobranza de hoy" (ADMINISTRATIVA): installments due exactly today for
  // one branch, still unpaid.
  async dueToday(actor: AuthenticatedUser, branchId: string, limit: number) {
    return this.prisma.withTenant(this.scope(actor), (tx) =>
      tx.$queryRaw<
        Array<{
          id: string;
          numero_cuota: number;
          monto: Prisma.Decimal;
          monto_pagado: Prisma.Decimal;
          cliente_nombre: string;
        }>
      >(Prisma.sql`
        SELECT c.id, c.numero_cuota, c.monto, c.monto_pagado, cl.nombre_completo AS cliente_nombre
        FROM cuotas_credito c
        JOIN operacion_creditos oc ON oc.id = c.operacion_credito_id
        JOIN operaciones o ON o.id = oc.operacion_id
        JOIN clientes cl ON cl.id = o.cliente_id
        WHERE c.organizacion_id = ${actor.organization.id}::uuid
          AND o.sucursal_id = ${branchId}::uuid
          AND c.estado IN ('PENDIENTE', 'PARCIAL')
          AND c.vencimiento = CURRENT_DATE
        ORDER BY c.monto DESC
        LIMIT ${limit}
      `),
    );
  }

  // "Alertas de gestión" (ADMINISTRATIVA): installments overdue by more
  // than `days` days for one branch.
  async overdueAlert(actor: AuthenticatedUser, branchId: string, days: number) {
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const rows = await tx.$queryRaw<Array<{ total: Prisma.Decimal | null; count: bigint }>>(
        Prisma.sql`
          SELECT SUM(c.monto - c.monto_pagado) AS total, COUNT(*)::bigint AS count
          FROM cuotas_credito c
          JOIN operacion_creditos oc ON oc.id = c.operacion_credito_id
          JOIN operaciones o ON o.id = oc.operacion_id
          WHERE c.organizacion_id = ${actor.organization.id}::uuid
            AND o.sucursal_id = ${branchId}::uuid
            AND c.estado IN ('PENDIENTE', 'PARCIAL')
            AND c.vencimiento < CURRENT_DATE - (${days}::int || ' days')::interval
        `,
      );
      return {
        amount: Number(rows[0]?.total ?? 0),
        count: Number(rows[0]?.count ?? 0),
      };
    });
  }

  async listInstallments(query: CreditInstallmentQueryDto, actor: AuthenticatedUser) {
    const organizationId =
      query.organizationId ?? (actor.globalAccess ? undefined : actor.organization.id);
    const search = query.search?.trim();

    const conditions: Prisma.Sql[] = [];
    if (organizationId) conditions.push(Prisma.sql`c.organizacion_id = ${organizationId}::uuid`);
    if (query.operationId) conditions.push(Prisma.sql`oc.operacion_id = ${query.operationId}::uuid`);
    if (query.status) {
      conditions.push(Prisma.sql`
        CASE
          WHEN c.estado IN ('PENDIENTE', 'PARCIAL') AND c.vencimiento < CURRENT_DATE
          THEN 'VENCIDA'
          ELSE c.estado
        END = ${query.status}
      `);
    }
    if (search) {
      conditions.push(Prisma.sql`(
        cl.nombre_completo ILIKE ${`%${search}%`}
        OR o.numero_operacion::text ILIKE ${`%${search}%`}
      )`);
    }
    const where = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.sql``;

    const rows = await this.prisma.withTenant(this.scope(actor), (tx) =>
      tx.$queryRaw<InstallmentRow[]>(Prisma.sql`
        ${this.installmentJoinedSelect()}
        ${where}
        ORDER BY c.vencimiento ASC, c.numero_cuota ASC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
      `),
    );
    const [{ count }] = await this.prisma.withTenant(this.scope(actor), (tx) =>
      tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM cuotas_credito c
        JOIN operacion_creditos oc ON oc.id = c.operacion_credito_id
        JOIN operaciones o ON o.id = oc.operacion_id
        JOIN clientes cl ON cl.id = o.cliente_id
        ${where}
      `),
    );
    return {
      items: rows.map((row) => this.mapInstallment(row)),
      total: Number(count),
      page: query.page,
      limit: query.limit,
    };
  }

  async payInstallment(id: string, input: PayCreditInstallmentDto, actor: AuthenticatedUser) {
    const event: AuthenticatedAuditEvent = {
      action: 'CREDIT_INSTALLMENT_PAID',
      entity: 'cuotas_credito',
      entityId: id,
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId: actor.organization.id,
    };
    return this.audit.execute(event, async (tx) => {
      const organizationId = actor.organization.id;
      const current = await tx.$queryRaw<
        Array<{
          organizacion_id: string;
          operacion_credito_id: string;
          monto: Prisma.Decimal;
          monto_pagado: Prisma.Decimal;
          estado: CreditInstallmentStatus;
        }>
      >(Prisma.sql`
        SELECT organizacion_id, operacion_credito_id, monto, monto_pagado, estado
        FROM cuotas_credito
        WHERE id = ${id}::uuid AND organizacion_id = ${organizationId}::uuid
      `);
      if (!current[0]) throw new NotFoundException('Installment not found');
      if (current[0].estado === 'PAGADA') {
        throw new BadRequestException('Installment is already fully paid');
      }
      const amount = Number(current[0].monto);
      const paidSoFar = Number(current[0].monto_pagado);
      const nextPaid = Math.round((paidSoFar + input.amount) * 100) / 100;
      if (nextPaid > amount) {
        throw new BadRequestException(
          'The payment amount exceeds the installment balance',
        );
      }
      const nextStatus: CreditInstallmentStatus =
        nextPaid === amount ? 'PAGADA' : 'PARCIAL';
      const personnelId = await this.cash.actorPersonnelId(tx, actor, organizationId);

      await tx.$executeRaw(Prisma.sql`
        UPDATE cuotas_credito SET
          monto_pagado = ${nextPaid}::numeric,
          estado = ${nextStatus}::"estado_cuota_credito_luma",
          fecha_pago = CASE WHEN ${nextStatus} = 'PAGADA' THEN ${parseBusinessDate(input.paymentDate)} ELSE fecha_pago END,
          registrado_por_personal_id = ${personnelId}::uuid
        WHERE id = ${id}::uuid
      `);

      if (nextStatus === 'PAGADA') {
        const pending = await tx.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
          SELECT EXISTS(
            SELECT 1 FROM cuotas_credito
            WHERE operacion_credito_id = ${current[0].operacion_credito_id}::uuid
            AND estado <> 'PAGADA'
          ) AS "exists"
        `);
        if (!pending[0]?.exists) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE operacion_creditos SET estado = 'FINALIZADO'
            WHERE id = ${current[0].operacion_credito_id}::uuid
          `);
        }
      }

      const rows = await tx.$queryRaw<InstallmentRow[]>(Prisma.sql`
        ${this.installmentJoinedSelect()}
        WHERE c.id = ${id}::uuid
      `);
      return this.mapInstallment(rows[0]);
    });
  }
}

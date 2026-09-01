import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  direccion_caja_luma,
  estado_liquidacion_comision_luma,
  estado_politica_comision_luma,
  Prisma,
  rol_asignacion_luma,
  tipo_movimiento_caja_luma,
  tipo_vehiculo_luma,
} from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import { ROLE_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CashService } from '../cash/cash.service';
import {
  assertOrganization,
  businessDate,
  scope,
  stableHash,
  targetOrganization,
} from '../finance/finance.utils';
import { PrismaService } from '../prisma/prisma.service';
import {
  calculateFixedCommission,
  calculateManagerCommission,
  commissionPeriod,
  commissionOperationEligibility,
  commissionPriceComparison,
  CommissionTierValue,
  validateCommissionTiers,
} from './commissions.calculation';
import {
  AgreeManagerCommissionDto,
  CommissionAgreementDto,
  CommissionHistoryQueryDto,
  CommissionMeQueryDto,
  CommissionPolicyAmbito,
  CommissionPolicyQueryDto,
  CommissionPolicyStatus,
  CommissionSettlementQueryDto,
  CommissionSettlementStatus,
  CommissionSuggestionQueryDto,
  CreateCommissionPolicyDto,
  ManagerCommissionHistoryQueryDto,
  ManagerCommissionMode,
  ManagerCommissionScope,
  ManagerCommissionSettlementQueryDto,
  ManagerCommissionSettlementStatus,
  ManagerCommissionSuggestionQueryDto,
  PayCommissionDto,
  PayManagerCommissionDto,
  SaveManagerCommissionConfigDto,
  UpdateCommissionPolicyDto,
  VersionedCommissionPolicyDto,
} from './commissions.dto';
import {
  commissionBadRequest,
  commissionConflict,
  commissionNotFound,
} from './commissions.errors';

const SELLER_ASSIGNMENT_ROLES: rol_asignacion_luma[] = ['VENDEDOR', 'CALLCENTER'];

const policyInclude = {
  escalas_comisiones: {
    orderBy: [{ minimo_ventas: 'asc' as const }],
  },
} satisfies Prisma.politicas_comisionesInclude;

const operationInclude = {
  clientes: { select: { id: true, nombre_completo: true } },
  sucursales: { select: { id: true, nombre: true } },
  versiones_vehiculos: {
    include: {
      modelos_vehiculos: {
        include: { marcas_vehiculos: true },
      },
    },
  },
  asignaciones_personal_operacion: {
    orderBy: [{ creado_en: 'asc' as const }, { personal_id: 'asc' as const }],
    include: {
      personal: {
        select: { id: true, nombre_completo: true },
      },
    },
  },
} satisfies Prisma.operacionesInclude;

const settlementInclude = {
  personal_liquidaciones_comisiones_personal_idTopersonal: {
    select: { id: true, nombre_completo: true },
  },
  sucursales: { select: { id: true, nombre: true } },
  personal_liquidaciones_comisiones_acordado_por_personal_idTopersonal: {
    select: { id: true, nombre_completo: true },
  },
} satisfies Prisma.liquidaciones_comisionesInclude;

type PolicyRecord = Prisma.politicas_comisionesGetPayload<{
  include: typeof policyInclude;
}>;
type OperationRecord = Prisma.operacionesGetPayload<{
  include: typeof operationInclude;
}>;
type SettlementRecord = Prisma.liquidaciones_comisionesGetPayload<{
  include: typeof settlementInclude;
}>;

type ManagerCommissionConfigRow = {
  id: string;
  personal_id: string;
  modo_calculo: ManagerCommissionMode;
  porcentaje: Prisma.Decimal | null;
  politica_comision_id: string | null;
  alcance: ManagerCommissionScope;
  activo: boolean;
  actualizado_en: Date;
  actualizado_por_personal_id: string | null;
};

// Manager (GERENTE) commission settlements - agree/pay flow, its own table
// (liquidaciones_comisiones_gerente). Row shape includes the joined names
// used by managerSettlementResponse() so every query fetches them in one
// round trip instead of N+1 lookups.
type ManagerSettlementRow = {
  id: string;
  organizacion_id: string;
  personal_id: string;
  manager_nombre: string;
  tipo_vehiculo: tipo_vehiculo_luma;
  periodo_desde: Date;
  periodo_hasta: Date;
  modo_calculo: ManagerCommissionMode;
  alcance: ManagerCommissionScope;
  sucursales_incluidas: Prisma.JsonValue;
  cantidad_operaciones_computables: number;
  porcentaje: Prisma.Decimal | null;
  politica_comision_id: string | null;
  escala_snapshot: Prisma.JsonValue | null;
  monto_calculado: Prisma.Decimal;
  moneda: string;
  estado: 'SUGERIDA' | 'ACORDADA' | 'PAGADA';
  acordado_en: Date | null;
  acordado_por_personal_id: string | null;
  acordado_por_nombre: string | null;
  pagado_en: Date | null;
  pagado_por_personal_id: string | null;
  pagado_por_nombre: string | null;
  notas: string | null;
  version_fila: number;
  creado_en: Date;
  actualizado_en: Date;
};

interface ManagerSuggestionKey {
  organizationId: string;
  managerId: string;
  period: string;
  vehicleType: tipo_vehiculo_luma;
}

const managerSettlementSelect = Prisma.sql`
  SELECT g.*, m.nombre_completo AS manager_nombre,
    a.nombre_completo AS acordado_por_nombre,
    pg.nombre_completo AS pagado_por_nombre
  FROM liquidaciones_comisiones_gerente g
  JOIN personal m ON m.id = g.personal_id AND m.organizacion_id = g.organizacion_id
  LEFT JOIN personal a ON a.id = g.acordado_por_personal_id AND a.organizacion_id = g.organizacion_id
  LEFT JOIN personal pg ON pg.id = g.pagado_por_personal_id AND pg.organizacion_id = g.organizacion_id
`;

interface SuggestionKey {
  organizationId: string;
  sellerId: string;
  branchId: string;
  period: string;
  vehicleType: tipo_vehiculo_luma;
}

interface SuggestionData {
  key: SuggestionKey;
  seller: { id: string; name: string };
  branch: { id: string; name: string };
  policy: PolicyRecord | null;
  operations: ReturnType<CommissionsService['operationSnapshot']>[];
  settlement: SettlementRecord | null;
}

@Injectable()
export class CommissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
  ) {}

  async suggestions(
    query: CommissionSuggestionQueryDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganization(actor, query.organizationId);
    if (
      query.minComputableSales !== undefined &&
      query.maxComputableSales !== undefined &&
      query.minComputableSales > query.maxComputableSales
    )
      commissionBadRequest(
        'INVALID_COMPUTABLE_SALES_RANGE',
        'Minimum computable sales cannot exceed maximum computable sales',
      );
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const period = commissionPeriod(query.period);
    return this.prisma.withTenant(scope(actor), async (tx) => {
      const operations = await tx.operaciones.findMany({
        relationLoadStrategy: 'join',
        where: {
          organizacion_id: organizationId,
          sucursal_id: query.branchId,
          fecha_operacion: { gte: period.from, lte: period.to },
          versiones_vehiculos: {
            modelos_vehiculos: { tipo_vehiculo: query.vehicleType },
          },
          asignaciones_personal_operacion: {
            some: {
              rol_asignacion: { in: SELLER_ASSIGNMENT_ROLES },
              personal_id: query.sellerId,
            },
          },
        },
        include: operationInclude,
        orderBy: [{ fecha_operacion: 'desc' }, { id: 'desc' }],
      });

      const groups = new Map<string, SuggestionKey>();
      for (const operation of operations) {
        const seller = this.primarySeller(operation);
        if (!seller || (query.sellerId && seller.id !== query.sellerId))
          continue;
        const key: SuggestionKey = {
          organizationId: operation.organizacion_id,
          sellerId: seller.id,
          branchId: operation.sucursal_id,
          period: query.period,
          vehicleType: query.vehicleType,
        };
        groups.set(this.keyString(key), key);
      }
      if (query.sellerId && query.branchId && organizationId) {
        const key: SuggestionKey = {
          organizationId,
          sellerId: query.sellerId,
          branchId: query.branchId,
          period: query.period,
          vehicleType: query.vehicleType,
        };
        groups.set(this.keyString(key), key);
      }

      const calculated = await Promise.all(
        [...groups.values()].map(async (key) =>
          this.suggestionData(tx, key, operations),
        ),
      );
      const items = calculated
        .map((data) => this.suggestionResponse(data, false))
        .filter(
          (item) =>
            (query.minComputableSales === undefined ||
              item.computableSales >= query.minComputableSales) &&
            (query.maxComputableSales === undefined ||
              item.computableSales <= query.maxComputableSales),
        )
        .sort(
          (left, right) =>
            left.seller.name.localeCompare(right.seller.name) ||
            left.branch.name.localeCompare(right.branch.name),
        );
      return {
        items: items.slice(
          (query.page - 1) * query.limit,
          query.page * query.limit,
        ),
        total: items.length,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async suggestion(id: string, actor: AuthenticatedUser) {
    const key = this.decodeSuggestionId(id);
    this.assertKeyScope(key, actor);
    return this.prisma.withTenant(scope(actor), async (tx) => {
      const data = await this.suggestionData(tx, key);
      return {
        ...this.suggestionResponse(data, true),
        settlement: data.settlement
          ? await this.settlementResponse(tx, data.settlement)
          : null,
      };
    });
  }

  async agree(
    id: string,
    input: CommissionAgreementDto,
    actor: AuthenticatedUser,
  ) {
    const key = this.decodeSuggestionId(id);
    this.assertKeyScope(key, actor);
    return this.mutate(
      actor,
      'COMMISSION_AGREEMENT_RECORDED',
      async (tx, event) => {
        await this.lockBusinessKey(tx, key);
        const data = await this.suggestionData(tx, key);
        event.targetOrganizationId = targetOrganization(
          actor,
          key.organizationId,
        );
        if (!data.policy)
          commissionConflict(
            'COMMISSION_POLICY_NOT_CONFIGURED',
            `No active ${key.vehicleType} commission policy is configured for this period`,
          );
        const amount = new Prisma.Decimal(input.agreedAmount);
        const now = new Date();
        if (data.settlement) {
          if (
            data.settlement.estado ===
              estado_liquidacion_comision_luma.PAGADA ||
            data.settlement.estado ===
              estado_liquidacion_comision_luma.PENDIENTE_PAGO
          )
            commissionConflict(
              'POLICY_IMMUTABLE',
              'A paid or paying commission agreement cannot be changed',
            );
          const repeated =
            data.settlement.importe_acordado?.equals(amount) &&
            this.dateOnly(data.settlement.fecha_reunion) ===
              input.meetingDate &&
            (data.settlement.notas ?? null) === (input.notes?.trim() ?? null);
          if (repeated) {
            event.skipRecord = true;
            return this.settlementResponse(tx, data.settlement);
          }
          if (
            input.expectedVersion === undefined ||
            input.expectedVersion !== data.settlement.version_fila
          )
            commissionConflict(
              'COMMISSION_STALE_VERSION',
              'Commission settlement was modified by another request',
            );
          const updated = await tx.liquidaciones_comisiones.update({
            where: {
              id_organizacion_id: {
                id: data.settlement.id,
                organizacion_id: key.organizationId,
              },
            },
            data: {
              importe_acordado: amount,
              fecha_reunion: businessDate(input.meetingDate),
              notas: input.notes?.trim(),
              acordado_en: now,
              acordado_por_personal_id: await this.actorPersonnelId(
                tx,
                actor,
                key.organizationId,
              ),
              estado: estado_liquidacion_comision_luma.ACORDADA,
              version_fila: { increment: 1 },
            },
            include: settlementInclude,
          });
          event.entityId = updated.id;
          event.metadata = {
            suggestedAmount: updated.importe_sugerido.toString(),
            agreedAmount: updated.importe_acordado?.toString() ?? null,
            differsFromSuggested: !updated.importe_sugerido.equals(amount),
          };
          return this.settlementResponse(tx, updated);
        }

        const live = this.liveCalculation(data);
        const personnelId = await this.actorPersonnelId(
          tx,
          actor,
          key.organizationId,
        );
        const created = await tx.liquidaciones_comisiones.create({
          data: {
            organizacion_id: key.organizationId,
            personal_id: key.sellerId,
            sucursal_id: key.branchId,
            periodo_desde: commissionPeriod(key.period).from,
            periodo_hasta: commissionPeriod(key.period).to,
            tipo_vehiculo: key.vehicleType,
            politica_comision_id: data.policy.id,
            cantidad_ventas: live.computableSales,
            importe_sugerido: live.suggestedAmount as string,
            importe_acordado: amount,
            moneda: data.policy.moneda,
            politica_snapshot: this.policySnapshot(data.policy),
            escala_snapshot: live.scale
              ? (live.scale as unknown as Prisma.InputJsonObject)
              : Prisma.DbNull,
            operaciones_snapshot: data.operations,
            fecha_reunion: businessDate(input.meetingDate),
            notas: input.notes?.trim(),
            acordado_en: now,
            acordado_por_personal_id: personnelId,
            estado: estado_liquidacion_comision_luma.ACORDADA,
            estado_pago: 'PENDIENTE',
          },
        });
        event.entityId = created.id;
        event.metadata = {
          suggestedAmount: created.importe_sugerido.toString(),
          agreedAmount: created.importe_acordado?.toString() ?? null,
          differsFromSuggested: !created.importe_sugerido.equals(amount),
        };
        return this.settlementResponse(
          tx,
          await tx.liquidaciones_comisiones.findUniqueOrThrow({
            where: { id: created.id },
            include: settlementInclude,
          }),
        );
      },
      undefined,
      key.organizationId,
    );
  }

  async settlements(
    query: CommissionSettlementQueryDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganization(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const period = query.period ? commissionPeriod(query.period) : undefined;
    const status = query.status
      ? this.databaseSettlementStatus(query.status)
      : {
          in: [
            estado_liquidacion_comision_luma.ACORDADA,
            estado_liquidacion_comision_luma.PENDIENTE_PAGO,
          ],
        };
    return this.prisma.withTenant(scope(actor), async (tx) => {
      const where: Prisma.liquidaciones_comisionesWhereInput = {
        organizacion_id: organizationId,
        tipo_vehiculo: query.vehicleType,
        sucursal_id: query.branchId,
        personal_id: query.sellerId,
        estado: status,
        periodo_desde: period?.from,
        periodo_hasta: period?.to,
      };
      const [total, items] = await Promise.all([
        tx.liquidaciones_comisiones.count({ where }),
        tx.liquidaciones_comisiones.findMany({
          where,
          include: settlementInclude,
          orderBy: [{ periodo_desde: 'desc' }, { creado_en: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ]);
      return {
        items: await Promise.all(
          items.map((item) => this.settlementResponse(tx, item)),
        ),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async pay(id: string, input: PayCommissionDto, actor: AuthenticatedUser) {
    return this.mutate(
      actor,
      'COMMISSION_PAYMENT_REGISTERED',
      async (tx, event) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "public"."liquidaciones_comisiones"
          WHERE "id" = CAST(${id} AS uuid)
            AND (${actor.globalAccess} OR "organizacion_id" = CAST(${actor.organization.id} AS uuid))
          FOR UPDATE
        `;
        const settlement = await this.settlementOr404(tx, id, actor);
        event.targetOrganizationId = targetOrganization(
          actor,
          settlement.organizacion_id,
        );
        const hash = stableHash({
          action: 'pay-commission',
          settlementId: id,
          accountId: input.accountId,
          paidAt: input.paidAt,
          reference: input.reference.trim(),
          receipt: input.receipt?.trim() ?? null,
          notes: input.notes?.trim() ?? null,
        });
        if (settlement.estado === estado_liquidacion_comision_luma.PAGADA) {
          if (
            settlement.clave_idempotencia_pago === input.idempotencyKey &&
            settlement.hash_idempotencia_pago === hash
          ) {
            event.skipRecord = true;
            return this.settlementResponse(tx, settlement);
          }
          commissionConflict(
            'COMMISSION_ALREADY_PAID',
            'Commission settlement is already paid',
          );
        }
        if (
          settlement.estado !== estado_liquidacion_comision_luma.ACORDADA &&
          settlement.estado !== estado_liquidacion_comision_luma.PENDIENTE_PAGO
        )
          commissionConflict(
            'COMMISSION_NOT_AGREED',
            'Commission settlement must be agreed before payment',
          );
        if (settlement.version_fila !== input.expectedVersion)
          commissionConflict(
            'COMMISSION_STALE_VERSION',
            'Commission settlement was modified by another request',
          );
        if (!settlement.importe_acordado)
          commissionConflict(
            'COMMISSION_NOT_AGREED',
            'Commission settlement has no agreed amount',
          );

        const payerId = await this.actorPersonnelId(
          tx,
          actor,
          settlement.organizacion_id,
        );
        await tx.liquidaciones_comisiones.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: settlement.organizacion_id,
            },
          },
          data: { estado: estado_liquidacion_comision_luma.PENDIENTE_PAGO },
        });
        const expense = await tx.gastos.create({
          data: {
            organizacion_id: settlement.organizacion_id,
            sucursal_id: settlement.sucursal_id,
            fecha_generacion: businessDate(input.paidAt.slice(0, 10)),
            categoria: 'COMISIONES',
            detalle: `Comisión ${settlement.tipo_vehiculo} ${this.periodLabel(settlement)}`,
            importe: settlement.importe_acordado,
            moneda: settlement.moneda,
            recuperable: false,
            estado_pago: 'PENDIENTE',
            creado_por_personal_id: payerId,
            referencia_origen: input.reference.trim(),
            datos_inferidos: {
              liquidacionComisionId: settlement.id,
              observaciones: input.notes?.trim() ?? null,
              comprobante: input.receipt?.trim() ?? null,
            },
          },
        });
        const movement = await this.cash.registerEntityMovement(
          tx,
          actor,
          settlement.organizacion_id,
          settlement.moneda,
          {
            idempotencyKey: input.idempotencyKey,
            accountId: input.accountId,
            amount: settlement.importe_acordado.toFixed(2),
            occurredAt: input.paidAt,
            reference: input.reference,
            notes: input.notes,
          },
          { gasto_id: expense.id },
          tipo_movimiento_caja_luma.EGRESO,
          direccion_caja_luma.DEBITO,
        );
        await tx.gastos.update({
          where: {
            id_organizacion_id: {
              id: expense.id,
              organizacion_id: settlement.organizacion_id,
            },
          },
          data: { estado_pago: 'PAGADO' },
        });
        const paid = await tx.liquidaciones_comisiones.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: settlement.organizacion_id,
            },
          },
          data: {
            estado: estado_liquidacion_comision_luma.PAGADA,
            estado_pago: 'PAGADO',
            pagado_en: new Date(input.paidAt),
            pagado_por_personal_id: payerId,
            gasto_id: expense.id,
            movimiento_caja_id: movement.id,
            cuenta_caja_id: input.accountId,
            referencia_pago: input.reference.trim(),
            comprobante_pago: input.receipt?.trim(),
            observaciones_pago: input.notes?.trim(),
            clave_idempotencia_pago: input.idempotencyKey,
            hash_idempotencia_pago: hash,
            version_fila: { increment: 1 },
          },
          include: settlementInclude,
        });
        event.entityId = paid.id;
        event.metadata = {
          amount: settlement.importe_acordado.toString(),
          expenseId: expense.id,
          movementId: movement.id,
          accountId: input.accountId,
        };
        return this.settlementResponse(tx, paid);
      },
      id,
    );
  }

  async history(query: CommissionHistoryQueryDto, actor: AuthenticatedUser) {
    assertOrganization(actor, query.organizationId);
    return this.prisma.withTenant(scope(actor), (tx) =>
      this.historyInTx(tx, query, actor),
    );
  }

  async me(query: CommissionMeQueryDto, actor: AuthenticatedUser) {
    return this.prisma.withTenant(scope(actor), async (tx) => {
      const personnel = await this.actorPersonnel(
        tx,
        actor,
        actor.organization.id,
      );
      if (!personnel.sucursal_principal_id)
        commissionBadRequest(
          'SELLER_PROFILE_NOT_FOUND',
          'Seller has no principal branch configured',
        );
      const key: SuggestionKey = {
        organizationId: actor.organization.id,
        sellerId: personnel.id,
        branchId: personnel.sucursal_principal_id,
        period: query.period,
        vehicleType: query.vehicleType,
      };
      const history = await this.historyInTx(
        tx,
        {
          vehicleType: query.vehicleType,
          sellerId: personnel.id,
          year: query.historyYear,
          month: query.historyMonth,
          page: query.page,
          limit: query.limit,
        },
        actor,
      );
      const managerCalculation =
        actor.role.code === ROLE_CODES.GERENTE
          ? await this.managerCommissionForActor(
              tx,
              { id: personnel.id, name: personnel.nombre_completo },
              actor.organization.id,
              query.period,
              query.vehicleType,
            )
          : null;
      // The manager's own settlement for the exact period being viewed
      // (agreed/paid state), if "acordar" was already run for it - mirrors
      // vendor's progress.settlement below. managerCommission itself stays
      // the live, recalculated-every-time number; this is the frozen one.
      const managerSettlementRow = managerCalculation
        ? await this.managerSettlementRowByKey(
            tx,
            actor.organization.id,
            personnel.id,
            commissionPeriod(query.period),
            query.vehicleType,
          )
        : null;
      // Past agreed/paid manager settlements (any period), mirrors
      // vendor's paidHistory below but reads liquidaciones_comisiones_gerente.
      const managerSettlementHistory =
        actor.role.code === ROLE_CODES.GERENTE
          ? await this.managerHistoryInTx(
              tx,
              {
                vehicleType: query.vehicleType,
                managerId: personnel.id,
                year: query.historyYear,
                month: query.historyMonth,
                page: query.page,
                limit: query.limit,
              },
              actor,
            )
          : null;
      return {
        progress: await (async () => {
          const data = await this.suggestionData(tx, key);
          return {
            ...this.suggestionResponse(data, true),
            settlement: data.settlement
              ? await this.settlementResponse(tx, data.settlement)
              : null,
          };
        })(),
        paidHistory: history,
        managerCommission: managerCalculation
          ? {
              ...managerCalculation,
              settlement: managerSettlementRow
                ? this.managerSettlementResponse(managerSettlementRow)
                : null,
            }
          : null,
        managerSettlementHistory,
      };
    });
  }

  // --- Manager (GERENTE) commission configuration and calculation. New and
  // additive: it never reads or writes liquidaciones_comisiones (the vendor
  // settlement table above) and never changes suggestionData/
  // suggestionResponse/liveCalculation. A manager's commission is computed
  // live from configuracion_comision_gerente; there is no agree/pay flow
  // for it yet (see the session report for why - liquidaciones_comisiones
  // requires a single sucursal_id, which does not fit a manager whose scope
  // is every branch).

  private async managerOr404(
    tx: Prisma.TransactionClient,
    managerId: string,
    organizationId: string,
  ) {
    const manager = await tx.personal.findFirst({
      where: {
        id: managerId,
        organizacion_id: organizationId,
        estado: 'ACTIVO',
        roles: { activo: true, codigo: ROLE_CODES.GERENTE },
      },
      select: { id: true, nombre_completo: true, sucursal_principal_id: true },
    });
    if (!manager)
      commissionBadRequest(
        'INVALID_MANAGER',
        'Manager must be an active GERENTE in the organization',
      );
    return manager;
  }

  private async managerCommissionConfigRow(
    tx: Prisma.TransactionClient,
    managerId: string,
    organizationId: string,
  ) {
    const rows = await tx.$queryRaw<ManagerCommissionConfigRow[]>(Prisma.sql`
      SELECT id, personal_id, modo_calculo, porcentaje, politica_comision_id,
        alcance, activo, actualizado_en, actualizado_por_personal_id
      FROM configuracion_comision_gerente
      WHERE personal_id = ${managerId}::uuid AND organizacion_id = ${organizationId}::uuid
    `);
    return rows[0] ?? null;
  }

  private managerConfigResponse(config: ManagerCommissionConfigRow | null) {
    if (!config) return null;
    return {
      mode: config.modo_calculo,
      percentage: config.porcentaje ? config.porcentaje.toFixed(2) : null,
      policyId: config.politica_comision_id,
      scope: config.alcance,
      active: config.activo,
      updatedAt: config.actualizado_en,
    };
  }

  async getManagerCommissionConfig(managerId: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(scope(actor), async (tx) => {
      const manager = await this.managerOr404(tx, managerId, actor.organization.id);
      const config = await this.managerCommissionConfigRow(
        tx,
        manager.id,
        actor.organization.id,
      );
      return this.managerConfigResponse(config);
    });
  }

  async saveManagerCommissionConfig(
    managerId: string,
    input: SaveManagerCommissionConfigDto,
    actor: AuthenticatedUser,
  ) {
    if (input.mode === ManagerCommissionMode.PORCENTAJE) {
      if (!input.percentage)
        commissionBadRequest(
          'INVALID_MANAGER_COMMISSION_CONFIG',
          'A percentage is required for PORCENTAJE mode',
        );
      if (input.policyId)
        commissionBadRequest(
          'INVALID_MANAGER_COMMISSION_CONFIG',
          'PORCENTAJE mode cannot reference a scale policy',
        );
    } else {
      if (!input.policyId)
        commissionBadRequest(
          'INVALID_MANAGER_COMMISSION_CONFIG',
          'A scale policy is required for ESCALA mode',
        );
      if (input.percentage)
        commissionBadRequest(
          'INVALID_MANAGER_COMMISSION_CONFIG',
          'ESCALA mode cannot define a percentage',
        );
    }
    return this.mutate(
      actor,
      'MANAGER_COMMISSION_CONFIG_SAVED',
      async (tx, event) => {
        const manager = await this.managerOr404(
          tx,
          managerId,
          actor.organization.id,
        );
        if (input.policyId) {
          const policy = await tx.politicas_comisiones.findFirst({
            where: {
              id: input.policyId,
              organizacion_id: actor.organization.id,
            },
            select: { id: true },
          });
          if (!policy)
            commissionBadRequest(
              'INVALID_MANAGER_COMMISSION_CONFIG',
              'The referenced scale policy does not exist in this organization',
            );
          const ambito = await this.policyAmbito(
            tx,
            input.policyId,
            actor.organization.id,
          );
          if (ambito !== CommissionPolicyAmbito.GERENCIA)
            commissionBadRequest(
              'INVALID_MANAGER_COMMISSION_CONFIG',
              'A manager scale policy must be ambito GERENCIA, not VENDEDOR - create or pick a management-only scale',
            );
        }
        const updatedBy = await this.actorPersonnelId(
          tx,
          actor,
          actor.organization.id,
        );
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO configuracion_comision_gerente (
            personal_id, organizacion_id, modo_calculo, porcentaje,
            politica_comision_id, alcance, activo, actualizado_por_personal_id
          ) VALUES (
            ${manager.id}::uuid, ${actor.organization.id}::uuid,
            ${input.mode}::"modo_calculo_comision_gerente_luma",
            ${input.percentage ?? null}::numeric,
            ${input.policyId ?? null}::uuid,
            ${input.scope}::"alcance_comision_gerente_luma",
            ${input.active ?? true}, ${updatedBy}::uuid
          )
          ON CONFLICT (personal_id) DO UPDATE SET
            modo_calculo = EXCLUDED.modo_calculo,
            porcentaje = EXCLUDED.porcentaje,
            politica_comision_id = EXCLUDED.politica_comision_id,
            alcance = EXCLUDED.alcance,
            activo = EXCLUDED.activo,
            actualizado_por_personal_id = EXCLUDED.actualizado_por_personal_id
          RETURNING id
        `);
        event.entityId = rows[0].id;
        const config = await this.managerCommissionConfigRow(
          tx,
          manager.id,
          actor.organization.id,
        );
        return this.managerConfigResponse(config);
      },
      undefined,
      actor.organization.id,
      'configuracion_comision_gerente',
    );
  }

  private async managerScopeBranchIds(
    tx: Prisma.TransactionClient,
    organizationId: string,
    scopeValue: ManagerCommissionScope,
    managerBranchId: string | null,
  ) {
    if (scopeValue === ManagerCommissionScope.TODAS_LAS_SUCURSALES) {
      const branches = await tx.sucursales.findMany({
        where: { organizacion_id: organizationId, activa: true },
        select: { id: true },
      });
      return branches.map((branch) => branch.id);
    }
    return managerBranchId ? [managerBranchId] : [];
  }

  private async managerCommissionForActor(
    tx: Prisma.TransactionClient,
    manager: { id: string; name: string },
    organizationId: string,
    periodInput: string,
    vehicleType: tipo_vehiculo_luma,
  ) {
    const config = await this.managerCommissionConfigRow(
      tx,
      manager.id,
      organizationId,
    );
    if (!config || !config.activo) return null;
    const managerPersonnel = await tx.personal.findFirst({
      where: { id: manager.id, organizacion_id: organizationId },
      select: { sucursal_principal_id: true },
    });
    const branchIds = await this.managerScopeBranchIds(
      tx,
      organizationId,
      config.alcance,
      managerPersonnel?.sucursal_principal_id ?? null,
    );
    const period = commissionPeriod(periodInput);
    const operations = branchIds.length
      ? await tx.operaciones.findMany({
          where: {
            organizacion_id: organizationId,
            sucursal_id: { in: branchIds },
            fecha_operacion: { gte: period.from, lte: period.to },
            versiones_vehiculos: {
              modelos_vehiculos: { tipo_vehiculo: vehicleType },
            },
          },
          select: { estado_operacion: true, precio_acordado: true },
        })
      : [];
    const eligibleOperations = operations.filter(
      (operation) =>
        commissionOperationEligibility(operation.estado_operacion).computable,
    );
    let tiers: CommissionTierValue[] | undefined;
    if (
      config.modo_calculo === ManagerCommissionMode.ESCALA &&
      config.politica_comision_id
    ) {
      // Defense in depth: saveManagerCommissionConfig() already rejects a
      // non-GERENCIA policyId at save time, and a DB constraint trigger
      // guarantees it too - but this is the actual money calculation, so
      // it re-checks ambito here as well rather than trusting either of
      // those alone.
      const configuredAmbito = await this.policyAmbito(
        tx,
        config.politica_comision_id,
        organizationId,
      );
      if (configuredAmbito !== CommissionPolicyAmbito.GERENCIA)
        commissionBadRequest(
          'INVALID_MANAGER_COMMISSION_CONFIG',
          'Manager scale policy must be ambito GERENCIA',
        );
      const policy = await tx.politicas_comisiones.findFirst({
        where: {
          id: config.politica_comision_id,
          organizacion_id: organizationId,
        },
        include: policyInclude,
      });
      tiers = policy?.escalas_comisiones.map((tier) =>
        this.scaleResponse(policy, tier),
      );
    }
    const calculation = calculateManagerCommission(
      config.modo_calculo,
      eligibleOperations.map((operation) => ({
        agreedPrice: operation.precio_acordado.toFixed(2),
      })),
      {
        percentage: config.porcentaje ? config.porcentaje.toFixed(2) : undefined,
        tiers,
      },
    );
    return {
      type: 'GERENTE' as const,
      manager,
      organizationId,
      period: periodInput,
      vehicleType,
      scope: config.alcance,
      branchIds,
      branchCount: branchIds.length,
      // Carried through so agree() can freeze the exact config used, without
      // a second config lookup.
      percentage: config.porcentaje ? config.porcentaje.toFixed(2) : null,
      policyId: config.politica_comision_id,
      ...calculation,
    };
  }

  // --- Manager (GERENTE) commission settlements: agree/pay flow, own
  // table (liquidaciones_comisiones_gerente). Reuses
  // managerCommissionForActor() above for the live calculation in every
  // path below - the PORCENTAJE/ESCALA formula lives in exactly one place
  // (commissions.calculation.ts) whether it is being previewed, frozen, or
  // shown back after being frozen. Never touches liquidaciones_comisiones
  // or its agree()/pay()/history() above.

  private encodeManagerSuggestionId(key: ManagerSuggestionKey) {
    return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
  }

  private decodeManagerSuggestionId(id: string): ManagerSuggestionKey {
    try {
      const value = JSON.parse(
        Buffer.from(id, 'base64url').toString('utf8'),
      ) as Partial<ManagerSuggestionKey>;
      if (
        !this.isUuid(value.organizationId) ||
        !this.isUuid(value.managerId) ||
        typeof value.period !== 'string' ||
        (value.vehicleType !== tipo_vehiculo_luma.MOTO &&
          value.vehicleType !== tipo_vehiculo_luma.AUTO)
      )
        throw new Error('invalid');
      commissionPeriod(value.period);
      return value as ManagerSuggestionKey;
    } catch {
      commissionBadRequest(
        'INVALID_MANAGER_COMMISSION_SUGGESTION_ID',
        'Manager commission suggestion id is invalid',
      );
    }
  }

  private assertManagerKeyScope(
    key: ManagerSuggestionKey,
    actor: AuthenticatedUser,
  ) {
    if (!actor.globalAccess && key.organizationId !== actor.organization.id)
      throw new ForbiddenException(
        'Manager commission suggestion is outside your organization',
      );
  }

  private managerKeyString(key: ManagerSuggestionKey) {
    return [
      'manager-commission',
      key.organizationId,
      key.managerId,
      key.period,
      key.vehicleType,
    ].join(':');
  }

  private async managerSettlementRowByKey(
    tx: Prisma.TransactionClient,
    organizationId: string,
    managerId: string,
    period: { from: Date; to: Date },
    vehicleType: tipo_vehiculo_luma,
  ) {
    const rows = await tx.$queryRaw<ManagerSettlementRow[]>(Prisma.sql`
      ${managerSettlementSelect}
      WHERE g.organizacion_id = ${organizationId}::uuid
        AND g.personal_id = ${managerId}::uuid
        AND g.periodo_desde = ${period.from}::date
        AND g.periodo_hasta = ${period.to}::date
        AND g.tipo_vehiculo = ${vehicleType}::"tipo_vehiculo_luma"
    `);
    return rows[0] ?? null;
  }

  private async managerSettlementRowOr404(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
  ) {
    const conditions: Prisma.Sql[] = [Prisma.sql`g.id = ${id}::uuid`];
    if (!actor.globalAccess)
      conditions.push(
        Prisma.sql`g.organizacion_id = ${actor.organization.id}::uuid`,
      );
    const rows = await tx.$queryRaw<ManagerSettlementRow[]>(Prisma.sql`
      ${managerSettlementSelect}
      WHERE ${Prisma.join(conditions, ' AND ')}
    `);
    const row = rows[0];
    if (!row)
      commissionNotFound(
        'MANAGER_COMMISSION_SETTLEMENT_NOT_FOUND',
        'Manager commission settlement not found',
      );
    return row;
  }

  private managerSettlementResponse(row: ManagerSettlementRow) {
    return {
      id: row.id,
      manager: { id: row.personal_id, name: row.manager_nombre },
      period: this.periodLabel(row),
      vehicleType: row.tipo_vehiculo,
      mode: row.modo_calculo,
      scope: row.alcance,
      branchIds: this.jsonArray(row.sucursales_incluidas) as string[],
      computableSales: row.cantidad_operaciones_computables,
      percentage: row.porcentaje ? row.porcentaje.toFixed(2) : null,
      policyId: row.politica_comision_id,
      scale: this.jsonObject(row.escala_snapshot),
      amount: row.monto_calculado.toFixed(2),
      currency: row.moneda,
      status: this.apiManagerSettlementStatus(row.estado),
      version: row.version_fila,
      notes: row.notas,
      agreedAt: row.acordado_en,
      agreedBy: row.acordado_por_personal_id
        ? { id: row.acordado_por_personal_id, name: row.acordado_por_nombre }
        : null,
      paidAt: row.pagado_en,
      paidBy: row.pagado_por_personal_id
        ? { id: row.pagado_por_personal_id, name: row.pagado_por_nombre }
        : null,
      createdAt: row.creado_en,
      updatedAt: row.actualizado_en,
    };
  }

  private apiManagerSettlementStatus(
    status: 'SUGERIDA' | 'ACORDADA' | 'PAGADA',
  ) {
    return status === 'ACORDADA'
      ? ManagerCommissionSettlementStatus.AGREED
      : status === 'PAGADA'
        ? ManagerCommissionSettlementStatus.PAID
        : ManagerCommissionSettlementStatus.SUGGESTED;
  }

  private databaseManagerSettlementStatus(
    status: ManagerCommissionSettlementStatus,
  ) {
    return status === ManagerCommissionSettlementStatus.AGREED
      ? 'ACORDADA'
      : status === ManagerCommissionSettlementStatus.PAID
        ? 'PAGADA'
        : 'SUGERIDA';
  }

  async managerSuggestions(
    query: ManagerCommissionSuggestionQueryDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganization(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    return this.prisma.withTenant(scope(actor), async (tx) => {
      const conditions: Prisma.Sql[] = [
        Prisma.sql`c.activo = true`,
        Prisma.sql`p.estado = 'ACTIVO'`,
      ];
      if (organizationId)
        conditions.push(Prisma.sql`c.organizacion_id = ${organizationId}::uuid`);
      if (query.managerId)
        conditions.push(Prisma.sql`p.id = ${query.managerId}::uuid`);
      const managers = await tx.$queryRaw<
        Array<{ id: string; nombre_completo: string; organizacion_id: string }>
      >(Prisma.sql`
        SELECT p.id, p.nombre_completo, c.organizacion_id
        FROM configuracion_comision_gerente c
        JOIN personal p ON p.id = c.personal_id AND p.organizacion_id = c.organizacion_id
        WHERE ${Prisma.join(conditions, ' AND ')}
        ORDER BY p.nombre_completo ASC
      `);
      const period = commissionPeriod(query.period);
      const [calculations, existingRows] = await Promise.all([
        Promise.all(
          managers.map((manager) =>
            this.managerCommissionForActor(
              tx,
              { id: manager.id, name: manager.nombre_completo },
              manager.organizacion_id,
              query.period,
              query.vehicleType,
            ),
          ),
        ),
        managers.length
          ? tx.$queryRaw<ManagerSettlementRow[]>(Prisma.sql`
              ${managerSettlementSelect}
              WHERE g.personal_id IN (${Prisma.join(
                managers.map((manager) => Prisma.sql`${manager.id}::uuid`),
              )})
                AND g.periodo_desde = ${period.from}::date
                AND g.periodo_hasta = ${period.to}::date
                AND g.tipo_vehiculo = ${query.vehicleType}::"tipo_vehiculo_luma"
            `)
          : Promise.resolve([] as ManagerSettlementRow[]),
      ]);
      const existingByManager = new Map(
        existingRows.map((row) => [row.personal_id, row]),
      );
      const items = calculations
        .filter(
          (calculation): calculation is NonNullable<(typeof calculations)[number]> =>
            calculation !== null,
        )
        .map((calculation) => {
          const existing = existingByManager.get(calculation.manager.id);
          return {
            id: this.encodeManagerSuggestionId({
              organizationId: calculation.organizationId,
              managerId: calculation.manager.id,
              period: calculation.period,
              vehicleType: calculation.vehicleType,
            }),
            ...calculation,
            settlement: existing
              ? this.managerSettlementResponse(existing)
              : null,
          };
        });
      const total = items.length;
      return {
        items: items.slice(
          (query.page - 1) * query.limit,
          (query.page - 1) * query.limit + query.limit,
        ),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async managerSuggestion(id: string, actor: AuthenticatedUser) {
    const key = this.decodeManagerSuggestionId(id);
    this.assertManagerKeyScope(key, actor);
    return this.prisma.withTenant(scope(actor), async (tx) => {
      const manager = await this.managerOr404(
        tx,
        key.managerId,
        key.organizationId,
      );
      const calculation = await this.managerCommissionForActor(
        tx,
        { id: manager.id, name: manager.nombre_completo },
        key.organizationId,
        key.period,
        key.vehicleType,
      );
      if (!calculation)
        commissionBadRequest(
          'MANAGER_COMMISSION_NOT_CONFIGURED',
          'Manager has no active commission configuration',
        );
      const existing = await this.managerSettlementRowByKey(
        tx,
        key.organizationId,
        key.managerId,
        commissionPeriod(key.period),
        key.vehicleType,
      );
      return {
        id,
        ...calculation,
        settlement: existing ? this.managerSettlementResponse(existing) : null,
      };
    });
  }

  async agreeManagerCommission(
    id: string,
    input: AgreeManagerCommissionDto,
    actor: AuthenticatedUser,
  ) {
    const key = this.decodeManagerSuggestionId(id);
    this.assertManagerKeyScope(key, actor);
    return this.mutate(
      actor,
      'MANAGER_COMMISSION_AGREEMENT_RECORDED',
      async (tx, event) => {
        await tx.$executeRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${this.managerKeyString(key)}, 0))
        `);
        event.targetOrganizationId = targetOrganization(
          actor,
          key.organizationId,
        );
        const manager = await this.managerOr404(
          tx,
          key.managerId,
          key.organizationId,
        );
        const calculation = await this.managerCommissionForActor(
          tx,
          { id: manager.id, name: manager.nombre_completo },
          key.organizationId,
          key.period,
          key.vehicleType,
        );
        if (!calculation)
          commissionBadRequest(
            'MANAGER_COMMISSION_NOT_CONFIGURED',
            'Manager has no active commission configuration',
          );
        const period = commissionPeriod(key.period);
        const existing = await this.managerSettlementRowByKey(
          tx,
          key.organizationId,
          key.managerId,
          period,
          key.vehicleType,
        );
        const now = new Date();
        const acordadoPorId = await this.actorPersonnelId(
          tx,
          actor,
          key.organizationId,
        );
        const scaleJson = calculation.scale
          ? JSON.stringify(calculation.scale)
          : null;
        const branchIdsJson = JSON.stringify(calculation.branchIds);
        if (existing) {
          if (existing.estado === 'PAGADA')
            commissionConflict(
              'COMMISSION_ALREADY_PAID',
              'A paid manager commission settlement cannot be changed',
            );
          const repeated =
            existing.monto_calculado.toFixed(2) === calculation.suggestedAmount &&
            existing.cantidad_operaciones_computables ===
              calculation.computableSales;
          if (repeated) {
            event.skipRecord = true;
            return this.managerSettlementResponse(existing);
          }
          if (
            input.expectedVersion === undefined ||
            input.expectedVersion !== existing.version_fila
          )
            commissionConflict(
              'COMMISSION_STALE_VERSION',
              'Manager commission settlement was modified by another request',
            );
          await tx.$executeRaw(Prisma.sql`
            UPDATE liquidaciones_comisiones_gerente SET
              modo_calculo = ${calculation.mode}::"modo_calculo_comision_gerente_luma",
              alcance = ${calculation.scope}::"alcance_comision_gerente_luma",
              sucursales_incluidas = ${branchIdsJson}::jsonb,
              cantidad_operaciones_computables = ${calculation.computableSales},
              porcentaje = ${calculation.percentage}::numeric,
              politica_comision_id = ${calculation.policyId}::uuid,
              escala_snapshot = ${scaleJson}::jsonb,
              monto_calculado = ${calculation.suggestedAmount}::numeric,
              acordado_en = ${now}::timestamptz,
              acordado_por_personal_id = ${acordadoPorId}::uuid,
              version_fila = version_fila + 1
            WHERE id = ${existing.id}::uuid AND organizacion_id = ${key.organizationId}::uuid
          `);
          event.entityId = existing.id;
          event.metadata = {
            previousAmount: existing.monto_calculado.toString(),
            newAmount: calculation.suggestedAmount,
          };
          const updated = await this.managerSettlementRowOr404(
            tx,
            existing.id,
            actor,
          );
          return this.managerSettlementResponse(updated);
        }
        const created = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO liquidaciones_comisiones_gerente (
            organizacion_id, personal_id, tipo_vehiculo, periodo_desde, periodo_hasta,
            modo_calculo, alcance, sucursales_incluidas, cantidad_operaciones_computables,
            porcentaje, politica_comision_id, escala_snapshot, monto_calculado, moneda,
            estado, acordado_en, acordado_por_personal_id
          ) VALUES (
            ${key.organizationId}::uuid, ${key.managerId}::uuid,
            ${key.vehicleType}::"tipo_vehiculo_luma",
            ${period.from}::date, ${period.to}::date,
            ${calculation.mode}::"modo_calculo_comision_gerente_luma",
            ${calculation.scope}::"alcance_comision_gerente_luma",
            ${branchIdsJson}::jsonb, ${calculation.computableSales},
            ${calculation.percentage}::numeric, ${calculation.policyId}::uuid,
            ${scaleJson}::jsonb, ${calculation.suggestedAmount}::numeric, 'ARS',
            'ACORDADA', ${now}::timestamptz, ${acordadoPorId}::uuid
          )
          RETURNING id
        `);
        event.entityId = created[0].id;
        event.metadata = { amount: calculation.suggestedAmount };
        const row = await this.managerSettlementRowOr404(
          tx,
          created[0].id,
          actor,
        );
        return this.managerSettlementResponse(row);
      },
      undefined,
      key.organizationId,
      'liquidaciones_comisiones_gerente',
    );
  }

  async managerSettlements(
    query: ManagerCommissionSettlementQueryDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganization(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const period = query.period ? commissionPeriod(query.period) : undefined;
    const status = query.status
      ? this.databaseManagerSettlementStatus(query.status)
      : undefined;
    return this.prisma.withTenant(scope(actor), async (tx) => {
      const conditions: Prisma.Sql[] = [
        Prisma.sql`g.tipo_vehiculo = ${query.vehicleType}::"tipo_vehiculo_luma"`,
      ];
      if (organizationId)
        conditions.push(Prisma.sql`g.organizacion_id = ${organizationId}::uuid`);
      if (query.managerId)
        conditions.push(Prisma.sql`g.personal_id = ${query.managerId}::uuid`);
      if (status)
        conditions.push(
          Prisma.sql`g.estado = ${status}::"estado_liquidacion_comision_gerente_luma"`,
        );
      else
        conditions.push(Prisma.sql`g.estado IN ('ACORDADA', 'PAGADA')`);
      if (period) {
        conditions.push(Prisma.sql`g.periodo_desde = ${period.from}::date`);
        conditions.push(Prisma.sql`g.periodo_hasta = ${period.to}::date`);
      }
      const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
      const [rows, countRows] = await Promise.all([
        tx.$queryRaw<ManagerSettlementRow[]>(Prisma.sql`
          ${managerSettlementSelect}
          ${where}
          ORDER BY g.periodo_desde DESC, g.creado_en DESC
          LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
        `),
        tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT COUNT(*)::bigint AS count
          FROM liquidaciones_comisiones_gerente g
          ${where}
        `),
      ]);
      return {
        items: rows.map((row) => this.managerSettlementResponse(row)),
        total: Number(countRows[0].count),
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async payManagerCommission(
    id: string,
    input: PayManagerCommissionDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'MANAGER_COMMISSION_PAYMENT_REGISTERED',
      async (tx, event) => {
        await tx.$executeRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${`manager-commission-settlement:${id}`}, 0))
        `);
        const settlement = await this.managerSettlementRowOr404(tx, id, actor);
        event.targetOrganizationId = targetOrganization(
          actor,
          settlement.organizacion_id,
        );
        if (settlement.estado === 'PAGADA')
          commissionConflict(
            'COMMISSION_ALREADY_PAID',
            'Manager commission settlement is already paid',
          );
        if (settlement.estado !== 'ACORDADA')
          commissionConflict(
            'COMMISSION_NOT_AGREED',
            'Manager commission settlement must be agreed before payment',
          );
        if (settlement.version_fila !== input.expectedVersion)
          commissionConflict(
            'COMMISSION_STALE_VERSION',
            'Manager commission settlement was modified by another request',
          );
        const payerId = await this.actorPersonnelId(
          tx,
          actor,
          settlement.organizacion_id,
        );
        await tx.$executeRaw(Prisma.sql`
          UPDATE liquidaciones_comisiones_gerente SET
            estado = 'PAGADA',
            pagado_en = ${new Date(input.paidAt)}::timestamptz,
            pagado_por_personal_id = ${payerId}::uuid,
            notas = ${input.notes ?? null},
            version_fila = version_fila + 1
          WHERE id = ${id}::uuid AND organizacion_id = ${settlement.organizacion_id}::uuid
        `);
        event.entityId = id;
        event.metadata = { amount: settlement.monto_calculado.toString() };
        const paid = await this.managerSettlementRowOr404(tx, id, actor);
        return this.managerSettlementResponse(paid);
      },
      id,
      undefined,
      'liquidaciones_comisiones_gerente',
    );
  }

  private async managerHistoryInTx(
    tx: Prisma.TransactionClient,
    query: ManagerCommissionHistoryQueryDto,
    actor: AuthenticatedUser,
  ) {
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const [paidFrom, paidTo] = this.historyDates(query);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`g.estado = 'PAGADA'`,
      Prisma.sql`g.tipo_vehiculo = ${query.vehicleType}::"tipo_vehiculo_luma"`,
    ];
    if (organizationId)
      conditions.push(Prisma.sql`g.organizacion_id = ${organizationId}::uuid`);
    if (query.managerId)
      conditions.push(Prisma.sql`g.personal_id = ${query.managerId}::uuid`);
    if (paidFrom) conditions.push(Prisma.sql`g.pagado_en >= ${paidFrom}::timestamptz`);
    if (paidTo) conditions.push(Prisma.sql`g.pagado_en <= ${paidTo}::timestamptz`);
    const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const [rows, countRows] = await Promise.all([
      tx.$queryRaw<ManagerSettlementRow[]>(Prisma.sql`
        ${managerSettlementSelect}
        ${where}
        ORDER BY g.pagado_en DESC, g.id DESC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
      `),
      tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM liquidaciones_comisiones_gerente g
        ${where}
      `),
    ]);
    return {
      items: rows.map((row) => this.managerSettlementResponse(row)),
      total: Number(countRows[0].count),
      page: query.page,
      limit: query.limit,
    };
  }

  async managerHistory(
    query: ManagerCommissionHistoryQueryDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganization(actor, query.organizationId);
    return this.prisma.withTenant(scope(actor), (tx) =>
      this.managerHistoryInTx(tx, query, actor),
    );
  }

  async policies(query: CommissionPolicyQueryDto, actor: AuthenticatedUser) {
    assertOrganization(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    // Defaults to VENDEDOR when the caller doesn't send ambito, so any
    // existing client that predates this filter (and never learned about
    // ambito) keeps seeing exactly the vendor policies it always saw -
    // never a GERENCIA one mixed in.
    const ambito = query.ambito ?? CommissionPolicyAmbito.VENDEDOR;
    return this.prisma.withTenant(scope(actor), async (tx) => {
      // ambito isn't part of the generated Prisma Client's typed
      // WhereInput yet (see the ambito helpers above), so the filtering,
      // ordering and pagination happen here via raw SQL first; the actual
      // rows (tiers included) are then hydrated through the existing typed
      // `findMany` below, unchanged from before this filter existed.
      const conditions: Prisma.Sql[] = [
        Prisma.sql`"ambito" = ${ambito}::"ambito_politica_comision_luma"`,
        Prisma.sql`"tipo_vehiculo" = ${query.vehicleType}::"tipo_vehiculo_luma"`,
      ];
      if (organizationId)
        conditions.push(Prisma.sql`"organizacion_id" = ${organizationId}::uuid`);
      if (query.status)
        conditions.push(
          Prisma.sql`"estado" = ${this.databasePolicyStatus(query.status)}::"estado_politica_comision_luma"`,
        );
      const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
      const [countRows, idRows] = await Promise.all([
        tx.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "politicas_comisiones" ${where}`,
        ),
        tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM "politicas_comisiones" ${where}
          ORDER BY "vigente_desde" DESC, "creado_en" DESC
          LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
        `),
      ]);
      const orderedIds = idRows.map((row) => row.id);
      const items = orderedIds.length
        ? await tx.politicas_comisiones.findMany({
            where: { id: { in: orderedIds } },
            include: policyInclude,
          })
        : [];
      const byId = new Map(items.map((item) => [item.id, item]));
      const ordered = orderedIds
        .map((id) => byId.get(id))
        .filter((item): item is PolicyRecord => Boolean(item));
      return {
        items: ordered.map((item) => this.policyResponse(item, ambito)),
        total: Number(countRows[0].count),
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async policy(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(scope(actor), async (tx) => {
      const found = await this.policyOr404(tx, id, actor);
      const ambito =
        (await this.policyAmbito(tx, found.id, found.organizacion_id)) ??
        CommissionPolicyAmbito.VENDEDOR;
      return this.policyResponse(found, ambito);
    });
  }

  async createPolicy(
    input: CreateCommissionPolicyDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganization(actor, input.organizationId);
    this.validatePolicyInput(input);
    const organizationId = input.organizationId ?? actor.organization.id;
    // Defaults to VENDEDOR when omitted, so any existing caller that never
    // sends ambito keeps creating vendor policies exactly as before.
    const ambito = input.ambito ?? CommissionPolicyAmbito.VENDEDOR;
    return this.mutate(
      actor,
      'COMMISSION_POLICY_CREATED',
      async (tx, event) => {
        await this.lockPolicyType(tx, organizationId, input.vehicleType, ambito);
        if (input.status === CommissionPolicyStatus.ACTIVE)
          await this.closePreviousPolicies(
            tx,
            organizationId,
            input.vehicleType,
            ambito,
            businessDate(input.validFrom),
            input.validTo ? businessDate(input.validTo) : null,
          );
        const created = await tx.politicas_comisiones.create({
          data: {
            organizacion_id: organizationId,
            tipo_vehiculo: input.vehicleType,
            moneda: input.currency,
            vigente_desde: businessDate(input.validFrom),
            vigente_hasta: input.validTo
              ? businessDate(input.validTo)
              : undefined,
            estado: this.databasePolicyStatus(input.status),
            creado_por_personal_id: await this.actorPersonnelId(
              tx,
              actor,
              organizationId,
            ),
            escalas_comisiones: {
              create: input.tiers.map((tier) => ({
                organizacion_id: organizationId,
                minimo_ventas: tier.minUnits,
                maximo_ventas: tier.maxUnits,
                importe_fijo: new Prisma.Decimal(tier.fixedAmount),
              })),
            },
          },
          include: policyInclude,
        });
        // ambito isn't part of the typed create() input above (see the
        // ambito helpers note) - set it explicitly, in the same
        // transaction, right after the row exists.
        await this.setPolicyAmbito(tx, created.id, organizationId, ambito);
        event.entityId = created.id;
        return this.policyResponse(created, ambito);
      },
      undefined,
      organizationId,
    );
  }

  async updatePolicy(
    id: string,
    input: UpdateCommissionPolicyDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganization(actor, input.organizationId);
    this.validatePolicyInput(input);
    // Defaults to VENDEDOR when omitted - same rule as createPolicy, so a
    // caller that never sends ambito on an update keeps the policy VENDEDOR
    // rather than silently leaving whatever it happened to be before.
    const ambito = input.ambito ?? CommissionPolicyAmbito.VENDEDOR;
    return this.mutate(
      actor,
      'COMMISSION_POLICY_UPDATED',
      async (tx, event) => {
        const current = await this.policyOr404(tx, id, actor, true);
        if (
          input.organizationId &&
          input.organizationId !== current.organizacion_id
        )
          commissionBadRequest(
            'INVALID_ORGANIZATION',
            'Policy organization cannot be changed',
          );
        event.targetOrganizationId = targetOrganization(
          actor,
          current.organizacion_id,
        );
        if (current.estado !== estado_politica_comision_luma.BORRADOR)
          commissionConflict(
            'POLICY_IMMUTABLE',
            'Only draft commission policies can be edited',
          );
        this.assertVersion(current.version_fila, input.expectedVersion);
        await tx.escalas_comisiones.deleteMany({ where: { politica_id: id } });
        const updated = await tx.politicas_comisiones.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: current.organizacion_id,
            },
          },
          data: {
            tipo_vehiculo: input.vehicleType,
            moneda: input.currency,
            vigente_desde: businessDate(input.validFrom),
            vigente_hasta: input.validTo ? businessDate(input.validTo) : null,
            estado: this.databasePolicyStatus(input.status),
            version_fila: { increment: 1 },
            escalas_comisiones: {
              create: input.tiers.map((tier) => ({
                organizacion_id: current.organizacion_id,
                minimo_ventas: tier.minUnits,
                maximo_ventas: tier.maxUnits,
                importe_fijo: new Prisma.Decimal(tier.fixedAmount),
              })),
            },
          },
          include: policyInclude,
        });
        // ambito isn't part of the typed update() input above (see the
        // ambito helpers note) - set it explicitly in the same transaction.
        await this.setPolicyAmbito(tx, updated.id, current.organizacion_id, ambito);
        if (input.status === CommissionPolicyStatus.ACTIVE) {
          await this.lockPolicyType(
            tx,
            current.organizacion_id,
            input.vehicleType,
            ambito,
          );
          await this.closePreviousPolicies(
            tx,
            current.organizacion_id,
            input.vehicleType,
            ambito,
            businessDate(input.validFrom),
            input.validTo ? businessDate(input.validTo) : null,
            id,
          );
        }
        event.entityId = updated.id;
        return this.policyResponse(updated, ambito);
      },
      id,
    );
  }

  async activatePolicy(
    id: string,
    input: VersionedCommissionPolicyDto,
    actor: AuthenticatedUser,
  ) {
    return this.changePolicyStatus(
      id,
      input,
      actor,
      estado_politica_comision_luma.ACTIVA,
      'COMMISSION_POLICY_ACTIVATED',
    );
  }

  async deactivatePolicy(
    id: string,
    input: VersionedCommissionPolicyDto,
    actor: AuthenticatedUser,
  ) {
    return this.changePolicyStatus(
      id,
      input,
      actor,
      estado_politica_comision_luma.INACTIVA,
      'COMMISSION_POLICY_DEACTIVATED',
    );
  }

  async deletePolicy(
    id: string,
    input: VersionedCommissionPolicyDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'COMMISSION_POLICY_DELETED',
      async (tx, event) => {
        const current = await this.policyOr404(tx, id, actor, true);
        event.targetOrganizationId = targetOrganization(
          actor,
          current.organizacion_id,
        );
        this.assertVersion(current.version_fila, input.expectedVersion);
        if (current.estado !== estado_politica_comision_luma.BORRADOR)
          commissionConflict(
            'POLICY_IMMUTABLE',
            'Only draft commission policies can be deleted',
          );
        await tx.politicas_comisiones.delete({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: current.organizacion_id,
            },
          },
        });
        event.entityId = id;
        return { id, deleted: true };
      },
      id,
    );
  }

  private async changePolicyStatus(
    id: string,
    input: VersionedCommissionPolicyDto,
    actor: AuthenticatedUser,
    status: estado_politica_comision_luma,
    action: string,
  ) {
    return this.mutate(
      actor,
      action,
      async (tx, event) => {
        const current = await this.policyOr404(tx, id, actor, true);
        const ambito =
          (await this.policyAmbito(tx, current.id, current.organizacion_id)) ??
          CommissionPolicyAmbito.VENDEDOR;
        event.targetOrganizationId = targetOrganization(
          actor,
          current.organizacion_id,
        );
        this.assertVersion(current.version_fila, input.expectedVersion);
        if (current.estado === status)
          return this.policyResponse(current, ambito);
        if (
          status === estado_politica_comision_luma.ACTIVA &&
          current.estado !== estado_politica_comision_luma.BORRADOR
        )
          commissionConflict(
            'POLICY_IMMUTABLE',
            'Only a draft commission policy can be activated',
          );
        if (status === estado_politica_comision_luma.ACTIVA) {
          await this.lockPolicyType(
            tx,
            current.organizacion_id,
            current.tipo_vehiculo,
            ambito,
          );
          await this.closePreviousPolicies(
            tx,
            current.organizacion_id,
            current.tipo_vehiculo,
            ambito,
            current.vigente_desde,
            current.vigente_hasta,
            current.id,
          );
        }
        const updated = await tx.politicas_comisiones.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: current.organizacion_id,
            },
          },
          data: { estado: status, version_fila: { increment: 1 } },
          include: policyInclude,
        });
        event.entityId = updated.id;
        return this.policyResponse(updated, ambito);
      },
      id,
    );
  }

  private async historyInTx(
    tx: Prisma.TransactionClient,
    query: CommissionHistoryQueryDto,
    actor: AuthenticatedUser,
  ) {
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const [paidFrom, paidTo] = this.historyDates(query);
    const where: Prisma.liquidaciones_comisionesWhereInput = {
      organizacion_id: organizationId,
      tipo_vehiculo: query.vehicleType,
      personal_id: query.sellerId,
      sucursal_id: query.branchId,
      estado: estado_liquidacion_comision_luma.PAGADA,
      pagado_en:
        paidFrom || paidTo
          ? {
              gte: paidFrom,
              lte: paidTo,
            }
          : undefined,
    };
    const [total, items] = await Promise.all([
      tx.liquidaciones_comisiones.count({ where }),
      tx.liquidaciones_comisiones.findMany({
        where,
        include: settlementInclude,
        orderBy: [{ pagado_en: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return {
      items: await Promise.all(
        items.map((item) => this.settlementResponse(tx, item, true)),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  private async suggestionData(
    tx: Prisma.TransactionClient,
    key: SuggestionKey,
    prefetchedOperations?: OperationRecord[],
  ): Promise<SuggestionData> {
    const period = commissionPeriod(key.period);
    // Resolved ambito-aware (VENDEDOR only - see activePolicyId) before the
    // Promise.all below, since the typed findFirst that hydrates the full
    // row (tiers included) needs the id first. This is THE vendor
    // commission calculation path - a GERENCIA policy must never be able
    // to surface here, no matter what.
    const activeVendorPolicyId = await this.activePolicyId(
      tx,
      key.organizationId,
      key.vehicleType,
      CommissionPolicyAmbito.VENDEDOR,
      period.to,
    );
    const [seller, branch, policy, settlement] = await Promise.all([
      tx.personal.findFirst({
        where: {
          id: key.sellerId,
          organizacion_id: key.organizationId,
          estado: 'ACTIVO',
        },
        select: { id: true, nombre_completo: true },
      }),
      tx.sucursales.findFirst({
        where: {
          id: key.branchId,
          organizacion_id: key.organizationId,
          activa: true,
        },
        select: { id: true, nombre: true },
      }),
      activeVendorPolicyId
        ? tx.politicas_comisiones.findFirst({
            where: { id: activeVendorPolicyId },
            include: policyInclude,
          })
        : Promise.resolve(null),
      tx.liquidaciones_comisiones.findFirst({
        where: {
          organizacion_id: key.organizationId,
          personal_id: key.sellerId,
          sucursal_id: key.branchId,
          periodo_desde: period.from,
          periodo_hasta: period.to,
          tipo_vehiculo: key.vehicleType,
        },
        include: settlementInclude,
      }),
    ]);
    if (!seller)
      commissionBadRequest(
        'SELLER_PROFILE_NOT_FOUND',
        'Seller is invalid, inactive or outside the organization',
      );
    if (!branch)
      commissionBadRequest(
        'INVALID_BRANCH',
        'Branch is invalid, inactive or outside the organization',
      );
    const records =
      prefetchedOperations ??
      (await tx.operaciones.findMany({
        where: {
          organizacion_id: key.organizationId,
          sucursal_id: key.branchId,
          fecha_operacion: { gte: period.from, lte: period.to },
          versiones_vehiculos: {
            modelos_vehiculos: { tipo_vehiculo: key.vehicleType },
          },
          asignaciones_personal_operacion: {
            some: {
              personal_id: key.sellerId,
              rol_asignacion: { in: SELLER_ASSIGNMENT_ROLES },
            },
          },
        },
        include: operationInclude,
        orderBy: [{ fecha_operacion: 'desc' }, { id: 'desc' }],
      }));
    const operations = records
      .filter(
        (operation) =>
          operation.organizacion_id === key.organizationId &&
          operation.sucursal_id === key.branchId &&
          this.primarySeller(operation)?.id === key.sellerId &&
          operation.versiones_vehiculos.modelos_vehiculos.tipo_vehiculo ===
            key.vehicleType,
      )
      .map((operation) => this.operationSnapshot(operation));
    return {
      key,
      seller: { id: seller.id, name: seller.nombre_completo },
      branch: { id: branch.id, name: branch.nombre },
      policy,
      operations,
      settlement,
    };
  }

  private suggestionResponse(data: SuggestionData, detail: boolean) {
    if (data.settlement) {
      const operations = this.jsonArray(data.settlement.operaciones_snapshot);
      const scale = this.jsonObject(data.settlement.escala_snapshot);
      const policy = this.jsonObject(data.settlement.politica_snapshot);
      const tiers =
        policy && Array.isArray(policy.tiers)
          ? (policy.tiers as unknown as CommissionTierValue[])
          : [];
      const next = this.nextScaleFromSnapshot(
        tiers,
        scale as unknown as CommissionTierValue | null,
      );
      const response = {
        id: this.encodeSuggestionId(data.key),
        seller: data.seller,
        branch: data.branch,
        period: data.key.period,
        vehicleType: data.key.vehicleType,
        configurationStatus: 'CONFIGURED' as const,
        computableSales: data.settlement.cantidad_ventas,
        scale,
        suggestedAmount: data.settlement.importe_sugerido.toFixed(2),
        status: this.apiSettlementStatus(data.settlement.estado),
        nextScale: next,
        unitsToNextScale: next
          ? Math.max(0, next.minUnits - data.settlement.cantidad_ventas)
          : null,
        version: data.settlement.version_fila,
        ...(detail
          ? {
              operations,
              settlement: this.basicSettlement(data.settlement),
            }
          : {}),
      };
      return response;
    }
    const live = this.liveCalculation(data);
    const response = {
      id: this.encodeSuggestionId(data.key),
      seller: data.seller,
      branch: data.branch,
      period: data.key.period,
      vehicleType: data.key.vehicleType,
      configurationStatus: data.policy
        ? ('CONFIGURED' as const)
        : ('NOT_CONFIGURED' as const),
      computableSales: live.computableSales,
      scale: live.scale,
      suggestedAmount: data.policy ? live.suggestedAmount : null,
      status: CommissionSettlementStatus.CALCULATED,
      nextScale: data.policy ? live.nextScale : null,
      unitsToNextScale: data.policy ? live.unitsToNextScale : null,
      version: 0,
      ...(detail
        ? {
            operations: data.operations,
            settlement: null,
          }
        : {}),
    };
    return response;
  }

  private liveCalculation(data: SuggestionData) {
    const computableSales = data.operations.filter(
      (operation) => operation.computable,
    ).length;
    if (!data.policy)
      return {
        computableSales,
        scale: null,
        suggestedAmount: null,
        nextScale: null,
        unitsToNextScale: null,
      };
    const tiers = data.policy.escalas_comisiones.map((tier) =>
      this.scaleResponse(data.policy as PolicyRecord, tier),
    );
    return {
      computableSales,
      ...calculateFixedCommission(tiers, computableSales),
    };
  }

  private operationSnapshot(operation: OperationRecord) {
    const eligibility = commissionOperationEligibility(
      operation.estado_operacion,
    );
    const listPrice = operation.precio_lista?.toFixed(2) ?? null;
    const closingPrice = operation.precio_acordado.toFixed(2);
    const comparison = commissionPriceComparison(
      operation.precio_lista,
      operation.precio_acordado,
    );
    const model = operation.versiones_vehiculos.modelos_vehiculos;
    return {
      id: operation.id,
      date: this.dateOnly(operation.fecha_operacion),
      operationNumber: operation.numero_operacion.toString(),
      customerName: operation.clientes.nombre_completo,
      vehicleLabel: `${model.marcas_vehiculos.nombre} ${model.nombre} ${operation.versiones_vehiculos.nombre}`,
      listPrice,
      closingPrice,
      difference: comparison.difference,
      belowList: comparison.belowList,
      computable: eligibility.computable,
      nonComputableReason: eligibility.computable ? null : eligibility.reason,
      eligibilityReason: eligibility.reason,
      status: operation.estado_operacion,
    };
  }

  private primarySeller(operation: OperationRecord) {
    const assignment = operation.asignaciones_personal_operacion.find((item) =>
      (SELLER_ASSIGNMENT_ROLES as readonly string[]).includes(
        item.rol_asignacion,
      ),
    );
    return assignment
      ? {
          id: assignment.personal.id,
          name: assignment.personal.nombre_completo,
        }
      : null;
  }

  private async settlementResponse(
    tx: Prisma.TransactionClient,
    item: SettlementRecord,
    withAudit = false,
  ) {
    const [paidBy, account, auditTrail] = await Promise.all([
      item.pagado_por_personal_id
        ? tx.personal.findUnique({
            where: { id: item.pagado_por_personal_id },
            select: { id: true, nombre_completo: true },
          })
        : null,
      item.cuenta_caja_id
        ? tx.cuentas_caja.findUnique({
            where: { id: item.cuenta_caja_id },
            select: {
              id: true,
              codigo: true,
              nombre: true,
              tipo_cuenta: true,
            },
          })
        : null,
      withAudit
        ? tx.registros_auditoria.findMany({
            where: {
              entidad: 'liquidaciones_comisiones',
              entidad_id: item.id,
            },
            select: {
              accion: true,
              usuario_id: true,
              creado_en: true,
            },
            orderBy: [{ creado_en: 'asc' }],
          })
        : [],
    ]);
    const scale = this.jsonObject(item.escala_snapshot);
    return {
      id: item.id,
      seller: {
        id: item.personal_liquidaciones_comisiones_personal_idTopersonal.id,
        name: item.personal_liquidaciones_comisiones_personal_idTopersonal
          .nombre_completo,
      },
      branch: { id: item.sucursales.id, name: item.sucursales.nombre },
      period: this.periodLabel(item),
      vehicleType: item.tipo_vehiculo,
      status: this.apiSettlementStatus(item.estado),
      configurationStatus: 'CONFIGURED',
      computableSales: item.cantidad_ventas,
      policySnapshot: item.politica_snapshot,
      scaleSnapshot: scale,
      scale,
      suggestedAmount: item.importe_sugerido.toFixed(2),
      agreedAmount: item.importe_acordado?.toFixed(2) ?? null,
      paidAmount:
        item.estado === estado_liquidacion_comision_luma.PAGADA
          ? (item.importe_acordado?.toFixed(2) ?? '0.00')
          : '0.00',
      currency: item.moneda,
      meetingDate: this.dateOnly(item.fecha_reunion),
      notes: item.notas,
      version: item.version_fila,
      agreedAt: item.acordado_en,
      agreedBy:
        item.personal_liquidaciones_comisiones_acordado_por_personal_idTopersonal
          ? {
              id: item
                .personal_liquidaciones_comisiones_acordado_por_personal_idTopersonal
                .id,
              name: item
                .personal_liquidaciones_comisiones_acordado_por_personal_idTopersonal
                .nombre_completo,
            }
          : null,
      paidAt: item.pagado_en,
      paidBy: paidBy ? { id: paidBy.id, name: paidBy.nombre_completo } : null,
      payment:
        item.estado === estado_liquidacion_comision_luma.PAGADA && account
          ? {
              account: {
                id: account.id,
                code: account.codigo,
                name: account.nombre,
                type: account.tipo_cuenta,
              },
              reference: item.referencia_pago,
              receipt: item.comprobante_pago,
              notes: item.observaciones_pago,
              movementId: item.movimiento_caja_id,
              expenseId: item.gasto_id,
            }
          : null,
      account: account
        ? {
            id: account.id,
            code: account.codigo,
            name: account.nombre,
            type: account.tipo_cuenta,
          }
        : null,
      reference: item.referencia_pago,
      auditTrail: auditTrail.map((entry) => ({
        action: entry.accion,
        actorId: entry.usuario_id,
        at: entry.creado_en,
      })),
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
    };
  }

  private basicSettlement(item: SettlementRecord) {
    return {
      id: item.id,
      status: this.apiSettlementStatus(item.estado),
      suggestedAmount: item.importe_sugerido.toFixed(2),
      agreedAmount: item.importe_acordado?.toFixed(2) ?? null,
      meetingDate: this.dateOnly(item.fecha_reunion),
      notes: item.notas,
      version: item.version_fila,
      paidAt: item.pagado_en,
    };
  }

  private policyResponse(item: PolicyRecord, ambito: CommissionPolicyAmbito) {
    return {
      id: item.id,
      organizationId: item.organizacion_id,
      vehicleType: item.tipo_vehiculo,
      ambito,
      currency: item.moneda,
      validFrom: this.dateOnly(item.vigente_desde),
      validTo: this.dateOnly(item.vigente_hasta),
      status: this.apiPolicyStatus(item.estado),
      version: item.version_fila,
      tiers: item.escalas_comisiones.map((tier) =>
        this.scaleResponse(item, tier),
      ),
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
    };
  }

  private scaleResponse(
    policy: Pick<PolicyRecord, 'vigente_desde' | 'vigente_hasta'>,
    tier: PolicyRecord['escalas_comisiones'][number],
  ): CommissionTierValue {
    return {
      id: tier.id,
      minUnits: tier.minimo_ventas,
      maxUnits: tier.maximo_ventas,
      fixedAmount: tier.importe_fijo.toFixed(2),
      validFrom: this.dateOnly(policy.vigente_desde) as string,
      validTo: this.dateOnly(policy.vigente_hasta),
    };
  }

  private policySnapshot(policy: PolicyRecord): Prisma.InputJsonObject {
    return {
      id: policy.id,
      vehicleType: policy.tipo_vehiculo,
      currency: policy.moneda,
      validFrom: this.dateOnly(policy.vigente_desde),
      validTo: this.dateOnly(policy.vigente_hasta),
      version: policy.version_fila,
      tiers: policy.escalas_comisiones.map((tier) =>
        this.scaleResponse(policy, tier),
      ) as unknown as Prisma.InputJsonArray,
    };
  }

  // --- ambito (VENDEDOR | GERENCIA) helpers for politicas_comisiones ------
  // The Prisma Client already generated on disk predates the "ambito"
  // column (this environment is not allowed to run `prisma generate`), so
  // every read or write that touches "ambito" goes through raw SQL here
  // instead of the typed politicas_comisiones delegate. Everything else
  // about politicas_comisiones (tiers, dates, status, pagination...) still
  // goes through the existing typed Prisma calls below, unchanged.

  private async setPolicyAmbito(
    tx: Prisma.TransactionClient,
    policyId: string,
    organizationId: string,
    ambito: CommissionPolicyAmbito,
  ) {
    await tx.$executeRaw`
      UPDATE "politicas_comisiones"
      SET "ambito" = ${ambito}::"ambito_politica_comision_luma"
      WHERE "id" = ${policyId}::uuid AND "organizacion_id" = ${organizationId}::uuid
    `;
  }

  private async policyAmbito(
    tx: Prisma.TransactionClient,
    policyId: string,
    organizationId: string,
  ): Promise<CommissionPolicyAmbito | null> {
    const rows = await tx.$queryRaw<Array<{ ambito: CommissionPolicyAmbito }>>`
      SELECT "ambito" FROM "politicas_comisiones"
      WHERE "id" = ${policyId}::uuid AND "organizacion_id" = ${organizationId}::uuid
    `;
    return rows[0]?.ambito ?? null;
  }

  // Id of the single ACTIVA policy covering `asOf`, scoped by BOTH
  // vehicleType and ambito - this is the ambito-aware replacement for what
  // used to be a plain typed `findFirst` filtered only by vehicleType. Only
  // the id is resolved here; the caller re-fetches the full row (tiers
  // included) through the existing typed `politicas_comisiones.findFirst`,
  // so the response shape stays exactly as it was before ambito existed.
  private async activePolicyId(
    tx: Prisma.TransactionClient,
    organizationId: string,
    vehicleType: tipo_vehiculo_luma,
    ambito: CommissionPolicyAmbito,
    asOf: Date,
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "politicas_comisiones"
      WHERE "organizacion_id" = ${organizationId}::uuid
        AND "tipo_vehiculo" = ${vehicleType}::"tipo_vehiculo_luma"
        AND "ambito" = ${ambito}::"ambito_politica_comision_luma"
        AND "estado" = 'ACTIVA'
        AND "vigente_desde" <= ${asOf}::date
        AND ("vigente_hasta" IS NULL OR "vigente_hasta" >= ${asOf}::date)
      ORDER BY "vigente_desde" DESC
      LIMIT 1
    `;
    return rows[0]?.id ?? null;
  }

  private async policyOr404(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
    lock = false,
  ) {
    if (lock)
      await tx.$queryRaw`
        SELECT "id"
        FROM "public"."politicas_comisiones"
        WHERE "id" = CAST(${id} AS uuid)
          AND (${actor.globalAccess} OR "organizacion_id" = CAST(${actor.organization.id} AS uuid))
        FOR UPDATE
      `;
    const policy = await tx.politicas_comisiones.findFirst({
      where: {
        id,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
      },
      include: policyInclude,
    });
    if (!policy)
      commissionNotFound(
        'COMMISSION_POLICY_NOT_FOUND',
        'Commission policy not found',
      );
    return policy;
  }

  private async settlementOr404(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
  ) {
    const settlement = await tx.liquidaciones_comisiones.findFirst({
      where: {
        id,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
      },
      include: settlementInclude,
    });
    if (!settlement)
      commissionNotFound(
        'COMMISSION_SETTLEMENT_NOT_FOUND',
        'Commission settlement not found',
      );
    return settlement;
  }

  private validatePolicyInput(input: CreateCommissionPolicyDto) {
    validateCommissionTiers(input.tiers);
    const from = businessDate(input.validFrom);
    const to = input.validTo ? businessDate(input.validTo) : null;
    if (to && to < from)
      commissionBadRequest(
        'INVALID_POLICY_PERIOD',
        'Policy validTo cannot be earlier than validFrom',
      );
    if (input.status === CommissionPolicyStatus.INACTIVE)
      commissionBadRequest(
        'INVALID_POLICY_STATUS',
        'New policy versions must be draft or active',
      );
  }

  private async closePreviousPolicies(
    tx: Prisma.TransactionClient,
    organizationId: string,
    vehicleType: tipo_vehiculo_luma,
    ambito: CommissionPolicyAmbito,
    validFrom: Date,
    validTo: Date | null,
    excludingId?: string,
  ) {
    // Raw SQL here too (ambito isn't in the typed WhereInput) - only the
    // two columns the loop below actually reads (id, vigente_desde) are
    // selected; the loop's own tx.politicas_comisiones.update() calls
    // further down are untouched, they don't reference ambito.
    const conditions: Prisma.Sql[] = [
      Prisma.sql`"organizacion_id" = ${organizationId}::uuid`,
      Prisma.sql`"tipo_vehiculo" = ${vehicleType}::"tipo_vehiculo_luma"`,
      Prisma.sql`"ambito" = ${ambito}::"ambito_politica_comision_luma"`,
      Prisma.sql`"estado" = 'ACTIVA'`,
      Prisma.sql`("vigente_hasta" IS NULL OR "vigente_hasta" >= ${validFrom}::date)`,
    ];
    if (excludingId)
      conditions.push(Prisma.sql`"id" <> ${excludingId}::uuid`);
    if (validTo)
      conditions.push(Prisma.sql`"vigente_desde" <= ${validTo}::date`);
    const existing = await tx.$queryRaw<Array<{ id: string; vigente_desde: Date }>>(
      Prisma.sql`
        SELECT "id", "vigente_desde" FROM "politicas_comisiones"
        WHERE ${Prisma.join(conditions, ' AND ')}
        ORDER BY "vigente_desde" ASC
      `,
    );
    for (const policy of existing) {
      if (policy.vigente_desde > validFrom)
        commissionConflict(
          'POLICY_PERIOD_OVERLAP',
          'Commission policy overlaps a future active version',
        );
      if (policy.vigente_desde.getTime() === validFrom.getTime()) {
        await tx.politicas_comisiones.update({
          where: {
            id_organizacion_id: {
              id: policy.id,
              organizacion_id: organizationId,
            },
          },
          data: {
            estado: estado_politica_comision_luma.INACTIVA,
            version_fila: { increment: 1 },
          },
        });
      } else {
        const previousDay = new Date(validFrom);
        previousDay.setUTCDate(previousDay.getUTCDate() - 1);
        await tx.politicas_comisiones.update({
          where: {
            id_organizacion_id: {
              id: policy.id,
              organizacion_id: organizationId,
            },
          },
          data: {
            vigente_hasta: previousDay,
            version_fila: { increment: 1 },
          },
        });
      }
    }
  }

  private async lockPolicyType(
    tx: Prisma.TransactionClient,
    organizationId: string,
    vehicleType: tipo_vehiculo_luma,
    ambito: CommissionPolicyAmbito,
  ) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${organizationId}:commission-policy:${vehicleType}:${ambito}`}, 0)
      )
    `;
  }

  private async lockBusinessKey(
    tx: Prisma.TransactionClient,
    key: SuggestionKey,
  ) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${this.keyString(key)}, 0)
      )
    `;
  }

  private assertVersion(current: number, expected: number) {
    if (current !== expected)
      commissionConflict(
        'COMMISSION_STALE_VERSION',
        'Commission record was modified by another request',
      );
  }

  private async actorPersonnel(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    organizationId: string,
  ) {
    const personnel = await tx.personal.findFirst({
      where: {
        usuario_id: actor.id,
        organizacion_id: organizationId,
        estado: 'ACTIVO',
      },
      select: {
        id: true,
        nombre_completo: true,
        sucursal_principal_id: true,
      },
    });
    if (!personnel)
      commissionBadRequest(
        'SELLER_PROFILE_NOT_FOUND',
        'Authenticated user has no active personnel profile in the organization',
      );
    return personnel;
  }

  private async actorPersonnelId(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    organizationId: string,
  ) {
    return (await this.actorPersonnel(tx, actor, organizationId)).id;
  }

  private assertKeyScope(key: SuggestionKey, actor: AuthenticatedUser) {
    if (!actor.globalAccess && key.organizationId !== actor.organization.id)
      throw new ForbiddenException(
        'Commission suggestion is outside your organization',
      );
  }

  private encodeSuggestionId(key: SuggestionKey) {
    return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
  }

  private decodeSuggestionId(id: string): SuggestionKey {
    try {
      const value = JSON.parse(
        Buffer.from(id, 'base64url').toString('utf8'),
      ) as Partial<SuggestionKey>;
      if (
        !this.isUuid(value.organizationId) ||
        !this.isUuid(value.sellerId) ||
        !this.isUuid(value.branchId) ||
        typeof value.period !== 'string' ||
        (value.vehicleType !== tipo_vehiculo_luma.MOTO &&
          value.vehicleType !== tipo_vehiculo_luma.AUTO)
      )
        throw new Error('invalid');
      commissionPeriod(value.period);
      return value as SuggestionKey;
    } catch {
      commissionBadRequest(
        'INVALID_COMMISSION_SUGGESTION_ID',
        'Commission suggestion id is invalid',
      );
    }
  }

  private keyString(key: SuggestionKey) {
    return [
      key.organizationId,
      key.sellerId,
      key.branchId,
      key.period,
      key.vehicleType,
    ].join(':');
  }

  private isUuid(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    );
  }

  private dateOnly(value: Date | null | undefined): string | null {
    return value ? value.toISOString().slice(0, 10) : null;
  }

  private periodLabel(item: { periodo_desde: Date }) {
    return item.periodo_desde.toISOString().slice(0, 7);
  }

  private historyDates(
    query: Pick<
      CommissionHistoryQueryDto,
      'paidFrom' | 'paidTo' | 'year' | 'month'
    >,
  ): [Date | undefined, Date | undefined] {
    if ((query.year === undefined) !== (query.month === undefined))
      commissionBadRequest(
        'INVALID_HISTORY_PERIOD',
        'History year and month must be provided together',
      );
    if ((query.paidFrom || query.paidTo) && query.year !== undefined)
      commissionBadRequest(
        'INVALID_HISTORY_PERIOD',
        'Date range cannot be combined with year and month',
      );
    if (query.year !== undefined && query.month !== undefined) {
      return [
        new Date(Date.UTC(query.year, query.month - 1, 1)),
        new Date(Date.UTC(query.year, query.month, 0, 23, 59, 59, 999)),
      ];
    }
    return [
      query.paidFrom ? new Date(`${query.paidFrom}T00:00:00.000Z`) : undefined,
      query.paidTo ? new Date(`${query.paidTo}T23:59:59.999Z`) : undefined,
    ];
  }

  private jsonObject(
    value: Prisma.JsonValue | null,
  ): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null;
  }

  private jsonArray(value: Prisma.JsonValue): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private nextScaleFromSnapshot(
    tiers: CommissionTierValue[],
    current: CommissionTierValue | null,
  ) {
    if (!current) return tiers[0] ?? null;
    const index = tiers.findIndex((tier) => tier.id === current.id);
    return index >= 0 ? (tiers[index + 1] ?? null) : null;
  }

  private apiPolicyStatus(status: estado_politica_comision_luma) {
    return status === estado_politica_comision_luma.BORRADOR
      ? CommissionPolicyStatus.DRAFT
      : status === estado_politica_comision_luma.ACTIVA
        ? CommissionPolicyStatus.ACTIVE
        : CommissionPolicyStatus.INACTIVE;
  }

  private databasePolicyStatus(status: CommissionPolicyStatus) {
    return status === CommissionPolicyStatus.DRAFT
      ? estado_politica_comision_luma.BORRADOR
      : status === CommissionPolicyStatus.ACTIVE
        ? estado_politica_comision_luma.ACTIVA
        : estado_politica_comision_luma.INACTIVA;
  }

  private apiSettlementStatus(status: estado_liquidacion_comision_luma) {
    return status === estado_liquidacion_comision_luma.CALCULADA
      ? CommissionSettlementStatus.CALCULATED
      : status === estado_liquidacion_comision_luma.ACORDADA
        ? CommissionSettlementStatus.AGREED
        : status === estado_liquidacion_comision_luma.PENDIENTE_PAGO
          ? CommissionSettlementStatus.PENDING_PAYMENT
          : CommissionSettlementStatus.PAID;
  }

  private databaseSettlementStatus(status: CommissionSettlementStatus) {
    return status === CommissionSettlementStatus.CALCULATED
      ? estado_liquidacion_comision_luma.CALCULADA
      : status === CommissionSettlementStatus.AGREED
        ? estado_liquidacion_comision_luma.ACORDADA
        : status === CommissionSettlementStatus.PENDING_PAYMENT
          ? estado_liquidacion_comision_luma.PENDIENTE_PAGO
          : estado_liquidacion_comision_luma.PAGADA;
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
    // Additive: every pre-existing call site omits this and keeps auditing
    // against liquidaciones_comisiones exactly as before. Manager
    // commission mutations (settlements and, from now on, config) pass
    // their own entity name so the audit trail names the right table.
    entity: string = 'liquidaciones_comisiones',
  ) {
    const event: AuthenticatedAuditEvent = {
      action,
      entity,
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
          (error.code === 'P2002' || error.code === 'P2034')
        )
          commissionConflict(
            'COMMISSION_CONCURRENT_MODIFICATION',
            'Commission record conflicts with another request',
          );
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        )
          throw new BadRequestException(
            'A referenced commission record is invalid',
          );
        throw error;
      });
  }
}

import { Injectable } from '@nestjs/common';
import { luma_estado_inventario, tipo_vehiculo_luma } from '@prisma/client';
import { PERMISSION_CODES, ROLE_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CashService } from '../cash/cash.service';
import { ClientsService } from '../clients/clients.service';
import { CommissionsService } from '../commissions/commissions.service';
import { CreditInquiriesService } from '../credit-inquiries/credit-inquiries.service';
import { CreditPlansService } from '../credit-plans/credit-plans.service';
import { ExpensesService } from '../expenses/expenses.service';
import { InventoryService } from '../inventory/inventory.service';
import { SalesService } from '../sales/sales.service';
import { SupplierPurchasesService } from '../supplier-purchases/supplier-purchases.service';
import { VehiclePaymentsService } from '../vehicle-payments/vehicle-payments.service';

const VEHICLE_TYPES = [tipo_vehiculo_luma.MOTO, tipo_vehiculo_luma.AUTO] as const;

function currentPeriodKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// "Esta semana" throughout this module is a rolling window anchored on
// today (UTC), not a Mon-Sun calendar week - simpler to reason about and
// avoids a timezone-dependent week boundary. Backward-looking for "loaded
// this week" counts, forward-looking for "due this week" amounts.
function daysAgoUtcStart(days: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days),
  );
}
function todayUtcStart(): Date {
  return daysAgoUtcStart(0);
}
function daysAheadUtcEnd(days: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + days,
      23,
      59,
      59,
      999,
    ),
  );
}

type ApprovalPage = Awaited<ReturnType<SalesService['pendingApprovals']>>;
type ApprovalItem = ApprovalPage['items'][number];
type SuggestionPage = Awaited<ReturnType<CommissionsService['suggestions']>>;
type SuggestionItem = SuggestionPage['items'][number];
type MeResult = Awaited<ReturnType<CommissionsService['me']>>;
type CashAccountPage = Awaited<ReturnType<CashService['findAccounts']>>;
type CashAccountItem = CashAccountPage['items'][number];

@Injectable()
export class DashboardService {
  constructor(
    private readonly sales: SalesService,
    private readonly commissions: CommissionsService,
    private readonly cash: CashService,
    private readonly creditPlans: CreditPlansService,
    private readonly creditInquiries: CreditInquiriesService,
    private readonly inventory: InventoryService,
    private readonly clients: ClientsService,
    private readonly supplierPurchases: SupplierPurchasesService,
    private readonly vehiclePayments: VehiclePaymentsService,
    private readonly expenses: ExpensesService,
  ) {}

  async getHome(actor: AuthenticatedUser) {
    const permissions = new Set(actor.role.permissions);
    const has = (code: string) => permissions.has(code);
    const greeting = {
      name: actor.name ?? actor.email,
      organizationName: actor.organization.name,
      branchName: actor.branch?.name ?? null,
      date: new Date().toISOString().slice(0, 10),
    };

    switch (actor.role.code) {
      case ROLE_CODES.ADMINISTRADOR:
        return {
          role: 'ADMINISTRADOR' as const,
          greeting,
          ...(await this.buildAdminHome(actor, has)),
        };
      case ROLE_CODES.GERENTE:
        return actor.branch
          ? {
              role: 'GERENTE' as const,
              greeting,
              ...(await this.buildManagerHome(actor, actor.branch.id, has)),
            }
          : { role: 'GERENTE' as const, greeting };
      case ROLE_CODES.ADMINISTRATIVA:
        return actor.branch
          ? {
              role: 'ADMINISTRATIVA' as const,
              greeting,
              ...(await this.buildAdministrativeHome(actor, actor.branch.id, has)),
            }
          : { role: 'ADMINISTRATIVA' as const, greeting };
      case ROLE_CODES.VENDEDOR:
      case ROLE_CODES.CALLCENTER:
        return actor.branch
          ? {
              role: 'VENDEDOR' as const,
              greeting,
              ...(await this.buildSellerHome(actor, has)),
            }
          : { role: 'VENDEDOR' as const, greeting };
      default:
        // A custom role (created via the roles module) that isn't one of
        // the five system roles: the greeting is all we can render without
        // guessing which of the four screens it should resemble.
        return { role: 'OTRO' as const, greeting };
    }
  }

  // --- ADMINISTRADOR: organization-wide, every branch. -------------------

  private async buildAdminHome(
    actor: AuthenticatedUser,
    has: (code: string) => boolean,
  ) {
    const period = currentPeriodKey();
    const [
      monthlySales,
      salesByBranch,
      topModels,
      newClientsThisWeek,
      stockUnitsTotal,
      creditPortfolio,
      pendingPurchases,
    ] = await Promise.all([
      has(PERMISSION_CODES.SALES_READ) ? this.sales.monthlyPerformance(actor) : null,
      has(PERMISSION_CODES.SALES_READ) ? this.sales.salesByBranch(actor, period) : null,
      has(PERMISSION_CODES.SALES_READ)
        ? this.sales.topModels(actor, { period, limit: 5 })
        : null,
      has(PERMISSION_CODES.CLIENTS_READ)
        ? this.clients.countCreatedSince(actor, daysAgoUtcStart(6))
        : null,
      has(PERMISSION_CODES.INVENTORY_READ)
        ? this.sumAcrossVehicleTypes((vehicleType) => this.stockCount(actor, vehicleType))
        : null,
      has(PERMISSION_CODES.CREDIT_PLANS_READ)
        ? this.creditPlans.personalCreditPortfolio(actor)
        : null,
      has(PERMISSION_CODES.PURCHASES_READ)
        ? this.supplierPurchases.pendingReceiptCount(actor)
        : null,
    ]);
    return {
      monthlySales,
      newClientsThisWeek,
      stockUnitsTotal,
      creditPortfolio,
      pendingPurchases,
      salesByBranch,
      topModels,
    };
  }

  // --- GERENTE: the manager's own branch. ---------------------------------

  private async buildManagerHome(
    actor: AuthenticatedUser,
    branchId: string,
    has: (code: string) => boolean,
  ) {
    const period = currentPeriodKey();
    const [monthlySales, ownCommission, creditOverdue, approvals, teamRanking, topModels] =
      await Promise.all([
        has(PERMISSION_CODES.SALES_READ)
          ? this.sales.monthlyPerformance(actor, { branchId })
          : null,
        has(PERMISSION_CODES.COMMISSIONS_READ)
          ? this.estimatedCommission(actor, period, 'MANAGER')
          : null,
        has(PERMISSION_CODES.CREDIT_PLANS_READ)
          ? this.creditPlans.personalCreditPortfolio(actor, branchId)
          : null,
        has(PERMISSION_CODES.SALES_APPROVE)
          ? this.approvalsAcrossVehicleTypes(actor, branchId, 10)
          : null,
        has(PERMISSION_CODES.COMMISSIONS_READ)
          ? this.teamRanking(actor, branchId, period)
          : null,
        has(PERMISSION_CODES.SALES_READ)
          ? this.sales.topModels(actor, { branchId, period, limit: 5 })
          : null,
      ]);
    return {
      pendingApprovalsCount: approvals?.total ?? null,
      monthlySales,
      ownCommission,
      creditOverdue: creditOverdue
        ? { amount: creditOverdue.overdueAmount, installments: creditOverdue.overdueInstallments }
        : null,
      approvals: approvals?.items ?? null,
      teamRanking,
      topModels,
    };
  }

  // --- ADMINISTRATIVA: the branch's day-to-day operations. ---------------

  private async buildAdministrativeHome(
    actor: AuthenticatedUser,
    branchId: string,
    has: (code: string) => boolean,
  ) {
    const period = currentPeriodKey();
    const [
      dueTodayAlert,
      cashBalanceToday,
      dueThisWeek,
      unconfirmedVehiclePayments,
      payableExpensesThisWeek,
      collectionsToday,
      recentInquiries,
      managementAlerts,
      topModels,
    ] = await Promise.all([
      has(PERMISSION_CODES.CREDIT_PLANS_READ)
        ? this.creditPlans.dueTodaySummary(actor, branchId)
        : null,
      has(PERMISSION_CODES.CASH_READ) ? this.cashBalance(actor, branchId) : null,
      has(PERMISSION_CODES.CREDIT_PLANS_READ)
        ? this.creditPlans.dueInRange(actor, branchId, todayUtcStart(), daysAheadUtcEnd(6))
        : null,
      has(PERMISSION_CODES.VEHICLE_PAYMENTS_READ)
        ? this.vehiclePayments.unconfirmedSummary(actor, branchId)
        : null,
      has(PERMISSION_CODES.EXPENSES_READ)
        ? this.expenses.payableInRange(actor, branchId, todayUtcStart(), daysAheadUtcEnd(6))
        : null,
      has(PERMISSION_CODES.CREDIT_PLANS_COLLECT)
        ? this.creditPlans.dueToday(actor, branchId, 10)
        : null,
      has(PERMISSION_CODES.CREDIT_INQUIRIES_READ)
        ? this.creditInquiries.recent(actor, branchId, 8)
        : null,
      has(PERMISSION_CODES.CREDIT_PLANS_READ) ||
      has(PERMISSION_CODES.VEHICLE_PAYMENTS_READ) ||
      has(PERMISSION_CODES.INVENTORY_READ)
        ? this.administrativeManagementAlerts(actor, branchId, has)
        : null,
      has(PERMISSION_CODES.SALES_READ)
        ? this.sales.topModels(actor, { branchId, period, limit: 5 })
        : null,
    ]);
    // "comisiones por pagar" was in scope but ADMINISTRATIVA holds none of
    // comisiones.consultar/.pagar/.gestionar in the seeded permission set -
    // deliberately dropped rather than gated on a permission that would
    // never be true for this role. See the session report.
    return {
      dueTodayAlert,
      cashBalanceToday,
      dueThisWeek,
      unconfirmedVehiclePayments,
      payableExpensesThisWeek,
      collectionsToday,
      recentInquiries: recentInquiries?.map((row) => ({
        id: row.id,
        clientName: row.clientes.nombre_completo,
        institutionName:
          row
            .financieras_consultas_crediticias_financiera_id_organizacion_idTofinancieras
            .razon_social,
        result: row.resultado,
        consultedAt: row.consultado_en,
      })),
      managementAlerts,
      topModels,
    };
  }

  private async administrativeManagementAlerts(
    actor: AuthenticatedUser,
    branchId: string,
    has: (code: string) => boolean,
  ) {
    const [overdueInstallments, staleVehiclePayments, zeroStockModels] = await Promise.all([
      has(PERMISSION_CODES.CREDIT_PLANS_READ)
        ? this.creditPlans.overdueAlert(actor, branchId, 30)
        : null,
      has(PERMISSION_CODES.VEHICLE_PAYMENTS_READ)
        ? this.vehiclePayments.unconfirmedSummary(actor, branchId)
        : null,
      has(PERMISSION_CODES.INVENTORY_READ)
        ? this.inventory.zeroStockModels(actor, branchId, 10)
        : null,
    ]);
    return {
      overdueInstallments,
      staleVehiclePayments: staleVehiclePayments
        ? { count: staleVehiclePayments.staleCount }
        : null,
      zeroStockModels,
    };
  }

  // --- VENDEDOR / CALLCENTER: the seller's own book of business. ---------

  private async buildSellerHome(
    actor: AuthenticatedUser,
    has: (code: string) => boolean,
  ) {
    const period = currentPeriodKey();
    const sellerId = has(PERMISSION_CODES.SALES_READ)
      ? await this.sales.resolveSellerId(actor)
      : null;
    const [monthlySales, ownCommission, clientsThisWeek, myOperations, topModels] =
      await Promise.all([
        sellerId ? this.sales.monthlyPerformance(actor, { sellerId }) : null,
        has(PERMISSION_CODES.COMMISSIONS_OWN)
          ? this.estimatedCommission(actor, period, 'SELLER')
          : null,
        has(PERMISSION_CODES.CLIENTS_READ)
          ? this.clients.countCreatedByActorSince(actor, daysAgoUtcStart(6))
          : null,
        sellerId ? this.sales.sellerAttentionOperations(actor, 20) : null,
        sellerId ? this.sales.topModels(actor, { sellerId, period, limit: 5 }) : null,
      ]);
    return {
      attentionCount: myOperations?.length ?? null,
      monthlySales,
      ownCommission,
      clientsThisWeek,
      myOperations,
      topModels,
      quickLinks: {
        bcraCheck: has(PERMISSION_CODES.CREDIT_PLANS_READ) ? '/creditos/consulta-bcra' : null,
        catalog: has(PERMISSION_CODES.CATALOG_READ) ? '/catalogo/motos' : null,
        newClient: has(PERMISSION_CODES.CLIENTS_MANAGE) ? '/clientes' : null,
      },
    };
  }

  // --- Shared helpers. -----------------------------------------------------

  private async sumAcrossVehicleTypes(
    fn: (vehicleType: tipo_vehiculo_luma) => Promise<number>,
  ): Promise<number> {
    const values = await Promise.all(VEHICLE_TYPES.map((type) => fn(type)));
    return values.reduce((sum, value) => sum + value, 0);
  }

  private async stockCount(actor: AuthenticatedUser, vehicleType: tipo_vehiculo_luma) {
    const page = await this.inventory.findAll(
      { vehicleType, inventoryStatus: luma_estado_inventario.EN_STOCK, page: 1, limit: 1 },
      actor,
    );
    return page.total;
  }

  private async approvalsAcrossVehicleTypes(
    actor: AuthenticatedUser,
    branchId: string,
    limit: number,
  ) {
    const pages: ApprovalPage[] = await Promise.all(
      VEHICLE_TYPES.map((vehicleType) =>
        this.sales.pendingApprovals({ vehicleType, branchId, page: 1, limit }, actor),
      ),
    );
    const items = pages
      .flatMap((page) => page.items)
      .slice(0, limit)
      .map((item) => this.approvalSummary(item));
    const total = pages.reduce((sum, page) => sum + page.total, 0);
    return { items, total };
  }

  private approvalSummary(item: ApprovalItem) {
    const listPrice = item.listPrice !== null ? Number(item.listPrice) : null;
    const agreedPrice = Number(item.agreedPrice);
    return {
      operationId: item.id,
      operationNumber: item.number,
      sellerName: item.seller?.fullName ?? '—',
      clientName: item.client.fullName,
      listPrice,
      agreedPrice,
      differencePercent:
        listPrice && listPrice > 0
          ? Number((((agreedPrice - listPrice) / listPrice) * 100).toFixed(1))
          : null,
    };
  }

  private async teamRanking(actor: AuthenticatedUser, branchId: string, period: string) {
    const pages: SuggestionPage[] = await Promise.all(
      VEHICLE_TYPES.map((vehicleType) =>
        this.commissions.suggestions(
          { period, vehicleType, branchId, page: 1, limit: 100 },
          actor,
        ),
      ),
    );
    const bySeller = new Map<
      string,
      { sellerId: string; sellerName: string; units: number; amount: number }
    >();
    const accumulate = (item: SuggestionItem) => {
      const acc = bySeller.get(item.seller.id) ?? {
        sellerId: item.seller.id,
        sellerName: item.seller.name,
        units: 0,
        amount: 0,
      };
      acc.units += item.computableSales;
      acc.amount += Number(item.suggestedAmount ?? 0);
      bySeller.set(item.seller.id, acc);
    };
    for (const page of pages) page.items.forEach(accumulate);
    return [...bySeller.values()].sort((left, right) => right.units - left.units);
  }

  // Sums an own commission (VENDEDOR/CALLCENTER: progress.suggestedAmount;
  // GERENTE: managerCommission.suggestedAmount, which me() only populates
  // when actor.role.code === GERENTE - see commissions.service.ts) across
  // MOTO and AUTO, since CommissionMeQueryDto takes exactly one vehicleType
  // per call.
  private async estimatedCommission(
    actor: AuthenticatedUser,
    period: string,
    kind: 'SELLER' | 'MANAGER',
  ) {
    const results: MeResult[] = await Promise.all(
      VEHICLE_TYPES.map((vehicleType) =>
        this.commissions.me({ period, vehicleType, page: 1, limit: 1 }, actor),
      ),
    );
    const amount = results.reduce(
      (sum, result) =>
        sum +
        Number(
          (kind === 'SELLER'
            ? result.progress.suggestedAmount
            : result.managerCommission?.suggestedAmount) ?? 0,
        ),
      0,
    );
    return { period, amount };
  }

  private async cashBalance(actor: AuthenticatedUser, branchId: string) {
    const page: CashAccountPage = await this.cash.findAccounts(
      { branchId, active: true, page: 1, limit: 100 },
      actor,
    );
    return page.items.reduce(
      (sum: number, account: CashAccountItem) => sum + Number(account.balance),
      0,
    );
  }
}

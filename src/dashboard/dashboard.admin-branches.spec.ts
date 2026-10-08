import type { AuthenticatedUser } from '../auth/auth.types';
import type { BranchScope } from '../branch-scope/branch-scope';
import { DashboardService } from './dashboard.service';

// Inicio del ADMINISTRADOR por sucursal: cada sucursal activa trae sus
// propios números, calculados con un alcance reducido a esa sucursal.

function admin(permissions: string[]): AuthenticatedUser {
  return {
    id: 'u1',
    email: 'admin@luma.test',
    name: 'Admin',
    active: true,
    globalAccess: false,
    organization: {
      id: 'o1',
      code: 'LUMA',
      name: 'Luma',
      type: 'CASA_CENTRAL',
    },
    role: {
      id: 'r1',
      code: 'ADMINISTRADOR',
      name: 'Administrador',
      system: true,
      permissions: ['sucursales.todas', ...permissions],
    },
    branch: null,
    branchScope: { allBranches: true, branches: [] },
  } as unknown as AuthenticatedUser;
}

const ALL = [
  'ventas.consultar',
  'ventas.aprobar',
  'ingresos.consultar',
  'gastos.consultar',
  'inventario.consultar',
  'creditos.consultar',
  'comisiones.consultar',
];

describe('DashboardService - ADMINISTRADOR por sucursal', () => {
  const performance = {
    period: '2026-10',
    currentMonth: { units: 0, amount: 0 },
    previousMonth: { units: 0, amount: 0 },
  };
  const sales = {
    monthlyPerformance: jest.fn(),
    salesByBranch: jest.fn(),
    topModels: jest.fn(),
    collectionSummary: jest.fn(),
    pendingApprovals: jest.fn(),
  };
  const commissions = { suggestions: jest.fn() };
  const creditPlans = { personalCreditPortfolio: jest.fn() };
  const inventory = { findAll: jest.fn() };
  const expenses = { totalInRange: jest.fn() };
  const clients = { countCreatedSince: jest.fn() };
  const supplierPurchases = { pendingReceiptCount: jest.fn() };
  const pendingTasks = { byBranch: jest.fn() };

  const service = new DashboardService(
    sales as never,
    commissions as never,
    creditPlans as never,
    {} as never,
    inventory as never,
    clients as never,
    supplierPurchases as never,
    {} as never,
    expenses as never,
    pendingTasks as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    sales.monthlyPerformance.mockResolvedValue(performance);
    sales.salesByBranch.mockResolvedValue([
      { branchId: 'b1', branchName: 'San Miguel', units: 3, amount: 9 },
      { branchId: 'b2', branchName: 'Del Viso', units: 1, amount: 4 },
    ]);
    sales.topModels.mockResolvedValue([]);
    sales.collectionSummary.mockResolvedValue({
      agreedAmount: 100,
      collectedAmount: 80,
      pendingAmount: 20,
      pendingOperations: 2,
    });
    sales.pendingApprovals.mockResolvedValue({ items: [], total: 2 });
    commissions.suggestions.mockResolvedValue({
      items: [
        {
          seller: { id: 's1', name: 'Uno' },
          computableSales: 2,
          suggestedAmount: '10',
        },
        {
          seller: { id: 's2', name: 'Dos' },
          computableSales: 5,
          suggestedAmount: '20',
        },
      ],
    });
    creditPlans.personalCreditPortfolio.mockResolvedValue({
      financedAmount: 50,
      overdueAmount: 5,
      overdueInstallments: 11,
    });
    inventory.findAll.mockResolvedValue({ total: 7 });
    expenses.totalInRange.mockResolvedValue({ amount: 30, count: 3 });
    clients.countCreatedSince.mockResolvedValue(0);
    supplierPurchases.pendingReceiptCount.mockResolvedValue(0);
    pendingTasks.byBranch.mockResolvedValue(null);
  });

  type Home = { branches: Array<Record<string, unknown>> | null };

  it('returns one entry per active branch with its own numbers', async () => {
    const home = (await service.getHome(admin(ALL))) as unknown as Home;

    expect(home.branches).toHaveLength(2);
    expect(home.branches?.[0]).toMatchObject({
      branchId: 'b1',
      branchName: 'San Miguel',
      monthlySales: performance,
      collection: { collectedAmount: 80, pendingAmount: 20 },
      expensesThisMonth: { amount: 30, count: 3 },
      // MOTO + AUTO.
      stockUnits: 14,
      pendingApprovals: 4,
      // Ordered by units; MOTO + AUTO suggestions are added up.
      sellers: [
        { sellerId: 's2', sellerName: 'Dos', units: 10 },
        { sellerId: 's1', sellerName: 'Uno', units: 4 },
      ],
    });
    expect(home.branches?.[1]).toMatchObject({ branchId: 'b2' });
  });

  it('queries each branch with a scope narrowed to that branch', async () => {
    await service.getHome(admin(ALL));

    expect(sales.monthlyPerformance).toHaveBeenCalledWith(expect.anything(), {
      branchId: 'b2',
      period: expect.stringMatching(/^\d{4}-\d{2}$/) as unknown,
    });
    expect(sales.collectionSummary).toHaveBeenCalledWith(expect.anything(), {
      branchId: 'b1',
      period: expect.stringMatching(/^\d{4}-\d{2}$/) as unknown,
    });
    const scopes = (
      expenses.totalInRange.mock.calls as Array<[unknown, BranchScope]>
    ).map(([, scope]) => scope.allowedBranchIds);
    expect(scopes).toEqual([['b1'], ['b2']]);
    const stockBranches = (
      inventory.findAll.mock.calls as Array<[{ branchId?: string }]>
    ).map(([query]) => query.branchId);
    // Organization total first (no branch), then two vehicle types per branch.
    expect(stockBranches.filter((id) => id === 'b1')).toHaveLength(2);
    expect(stockBranches.filter((id) => id === 'b2')).toHaveLength(2);
  });

  it('leaves out what the role has no permission for', async () => {
    const home = (await service.getHome(
      admin(['ventas.consultar']),
    )) as unknown as Home;

    expect(home.branches?.[0]).toMatchObject({
      monthlySales: performance,
      collection: null,
      expensesThisMonth: null,
      stockUnits: null,
      creditPortfolio: null,
      pendingApprovals: null,
      sellers: null,
    });
    expect(sales.collectionSummary).not.toHaveBeenCalled();
    expect(expenses.totalInRange).not.toHaveBeenCalled();

    const noSales = (await service.getHome(admin([]))) as unknown as Home;
    expect(noSales.branches).toBeNull();
  });

  describe('mes del inicio', () => {
    const periodKey = (offset: number) => {
      const now = new Date();
      const date = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
      );
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    };

    it('uses the current month by default', async () => {
      const home = (await service.getHome(admin(ALL))) as unknown as Record<
        string,
        unknown
      >;

      expect(home).toMatchObject({ month: 'current', period: periodKey(0) });
      expect(sales.salesByBranch).toHaveBeenCalledWith(
        expect.anything(),
        periodKey(0),
      );
    });

    it('moves every monthly number to the previous month', async () => {
      const previous = periodKey(-1);
      const [year, month] = previous.split('-').map(Number);
      const home = (await service.getHome(
        admin(ALL),
        'previous',
      )) as unknown as Record<string, unknown>;

      expect(home).toMatchObject({ month: 'previous', period: previous });
      expect(sales.monthlyPerformance).toHaveBeenCalledWith(expect.anything(), {
        period: previous,
      });
      expect(sales.monthlyPerformance).toHaveBeenCalledWith(expect.anything(), {
        branchId: 'b1',
        period: previous,
      });
      expect(sales.salesByBranch).toHaveBeenCalledWith(
        expect.anything(),
        previous,
      );
      expect(sales.topModels).toHaveBeenCalledWith(expect.anything(), {
        period: previous,
        limit: 5,
      });
      expect(sales.collectionSummary).toHaveBeenCalledWith(expect.anything(), {
        branchId: 'b1',
        period: previous,
      });
      expect(expenses.totalInRange).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        new Date(Date.UTC(year, month - 1, 1)),
        new Date(Date.UTC(year, month, 0)),
      );
      expect(commissions.suggestions).toHaveBeenCalledWith(
        expect.objectContaining({ period: previous }),
        expect.anything(),
      );
      // Lo que es una foto de hoy no depende del mes elegido.
      expect(pendingTasks.byBranch).toHaveBeenCalledTimes(1);
    });
  });
});

import type { AuthenticatedUser } from '../auth/auth.types';
import { BranchScope } from '../branch-scope/branch-scope';
import { PendingTasksService } from './pending-tasks.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const SM = '22222222-2222-4222-8222-222222222222';
const DV = '33333333-3333-4333-8333-333333333333';

const ALL_PERMISSIONS = [
  'creditos.consultar',
  'ingresos.consultar',
  'pagos_vehiculo.consultar',
  'ventas.patentamiento.gestionar',
  'gastos.consultar',
];

function actor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-id',
    email: 'rosa@luma.test',
    name: 'Rosa',
    active: true,
    globalAccess: false,
    organization: { id: ORG, code: 'LUMA', name: 'Luma', type: 'FRANQUICIA' },
    role: {
      id: 'role-id',
      code: 'ADMINISTRATIVA',
      name: 'Administrativa',
      system: true,
      permissions: ALL_PERMISSIONS,
    },
    branch: { id: SM, code: 'SM', name: 'San Miguel' },
    branchScope: {
      allBranches: false,
      branches: [{ id: SM, code: 'SM', name: 'San Miguel' }],
    },
    ...overrides,
  };
}

describe('PendingTasksService', () => {
  type ScopedArgs = [AuthenticatedUser, BranchScope, ...unknown[]];
  type CountArgs = [{ where: Record<string, unknown> }];
  const tx = {
    sucursales: { findMany: jest.fn<Promise<unknown>, CountArgs>() },
    ingresos: { count: jest.fn<Promise<number>, CountArgs>() },
  };
  const prisma = {
    withTenant: jest.fn(
      (_scope: unknown, work: (client: typeof tx) => unknown) => work(tx),
    ),
  };
  const creditPlans = {
    dueInRange: jest.fn<Promise<unknown>, ScopedArgs>(),
    overdueAlert: jest.fn<Promise<unknown>, ScopedArgs>(),
  };
  const vehiclePayments = {
    unconfirmedSummary: jest.fn<Promise<unknown>, ScopedArgs>(),
  };
  const sales = { licensingAlerts: jest.fn<Promise<unknown>, ScopedArgs>() };
  const expenses = {
    pendingPaymentCount: jest.fn<Promise<number>, ScopedArgs>(),
  };
  let service: PendingTasksService;

  beforeEach(() => {
    jest.clearAllMocks();
    creditPlans.dueInRange.mockResolvedValue({ count: 2, amount: 80000 });
    creditPlans.overdueAlert.mockResolvedValue({ count: 3, amount: 150000 });
    vehiclePayments.unconfirmedSummary.mockResolvedValue({
      count: 4,
      staleCount: 1,
    });
    sales.licensingAlerts.mockResolvedValue({
      overdue: 1,
      receivedPendingCollection: 0,
    });
    expenses.pendingPaymentCount.mockResolvedValue(5);
    tx.ingresos.count.mockResolvedValueOnce(6).mockResolvedValueOnce(7);
    service = new PendingTasksService(
      prisma as never,
      creditPlans as never,
      vehiclePayments as never,
      sales as never,
      expenses as never,
    );
  });

  it('gives the administrative user the tasks of her own branch', async () => {
    const result = await service.byBranch(actor());

    expect(result?.branches).toEqual([
      {
        branchId: SM,
        branchName: 'San Miguel',
        total: 28,
        tasks: [
          { key: 'INSTALLMENTS_DUE_TODAY', count: 2, amount: 80000 },
          { key: 'INSTALLMENTS_OVERDUE', count: 3, amount: 150000 },
          { key: 'INCOMES_PENDING_COLLECTION', count: 6, amount: null },
          { key: 'CASH_PENDING_HANDOVER', count: 7, amount: null },
          { key: 'VEHICLE_PAYMENTS_UNCONFIRMED', count: 4, amount: null },
          { key: 'LICENSING_OVERDUE', count: 1, amount: null },
          { key: 'LICENSING_PENDING_COLLECTION', count: 0, amount: null },
          { key: 'EXPENSES_PENDING_PAYMENT', count: 5, amount: null },
        ],
      },
    ]);
    // Cada consulta se acota a esa sucursal.
    const overdueCall = creditPlans.overdueAlert.mock.calls[0];
    expect(overdueCall?.[1].branchIds).toEqual([SM]);
    expect(tx.ingresos.count.mock.calls[0]?.[0].where).toMatchObject({
      organizacion_id: ORG,
      sucursal_id: { in: [SM] },
      estado_registro: { in: ['PENDIENTE', 'PAGO_PARCIAL'] },
      requiere_conciliacion: false,
    });
    // Todas las cuotas vencidas, no sólo las de más de 30 días.
    expect(overdueCall?.[2]).toBe(0);
    // No hace falta leer sucursales: salen del alcance del usuario.
    expect(tx.sucursales.findMany).not.toHaveBeenCalled();
  });

  it('breaks the tasks down by every active branch for an administrator', async () => {
    tx.sucursales.findMany.mockResolvedValue([
      { id: DV, nombre: 'Del Viso' },
      { id: SM, nombre: 'San Miguel' },
    ]);
    tx.ingresos.count.mockReset().mockResolvedValue(0);

    const result = await service.byBranch(
      actor({
        role: {
          id: 'role-id',
          code: 'ADMINISTRADOR',
          name: 'Administrador',
          system: true,
          permissions: [...ALL_PERMISSIONS, 'sucursales.todas'],
        },
        branch: null,
        branchScope: { allBranches: true, branches: [] },
      }),
    );

    expect(result?.branches.map((row) => row.branchName)).toEqual([
      'Del Viso',
      'San Miguel',
    ]);
    expect(tx.sucursales.findMany.mock.calls[0]?.[0].where).toEqual({
      organizacion_id: ORG,
      activa: true,
    });
    const scopes = vehiclePayments.unconfirmedSummary.mock.calls.map(
      (call) => call[1].branchIds,
    );
    expect(scopes).toEqual([[DV], [SM]]);
  });

  it('limits a manager to the branches assigned to him', async () => {
    const result = await service.byBranch(
      actor({
        role: {
          id: 'role-id',
          code: 'GERENTE',
          name: 'Gerente',
          system: true,
          permissions: ALL_PERMISSIONS,
        },
        branchScope: {
          allBranches: false,
          branches: [
            { id: SM, code: 'SM', name: 'San Miguel' },
            { id: DV, code: 'DV', name: 'Del Viso' },
          ],
        },
      }),
    );

    expect(result?.branches.map((row) => row.branchId)).toEqual([DV, SM]);
    expect(tx.sucursales.findMany).not.toHaveBeenCalled();
  });

  it('only counts the tasks the user has permission to see', async () => {
    const result = await service.byBranch(
      actor({
        role: {
          id: 'role-id',
          code: 'ADMINISTRATIVA',
          name: 'Administrativa',
          system: true,
          permissions: ['gastos.consultar'],
        },
      }),
    );

    expect(result?.branches[0]?.tasks).toEqual([
      { key: 'EXPENSES_PENDING_PAYMENT', count: 5, amount: null },
    ]);
    expect(creditPlans.overdueAlert).not.toHaveBeenCalled();
    expect(tx.ingresos.count).not.toHaveBeenCalled();
  });

  it('returns nothing when the user cannot see any task', async () => {
    const result = await service.byBranch(
      actor({
        role: {
          id: 'role-id',
          code: 'VENDEDOR',
          name: 'Vendedor',
          system: true,
          permissions: ['ventas.consultar'],
        },
      }),
    );

    expect(result).toBeNull();
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });
});

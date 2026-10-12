import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import type { SalesService } from '../sales/sales.service';
import { BalanceService } from './balance.service';

const org = '3b83b9bb-b6b5-4587-b51f-ab77626a55d3';
const sm = '8d34898d-c999-4112-86e7-664cce2bf635';
const dv = 'acb427da-1744-4285-b704-a3587b81aa94';
const juan = '11111111-1111-4111-8111-111111111111';
const dec = (value: number) => new Prisma.Decimal(value);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

function actor(allBranches = true): AuthenticatedUser {
  return {
    id: juan,
    organization: { id: org },
    globalAccess: false,
    role: {
      permissions: allBranches
        ? ['sucursales.todas', 'meses_trabajo.gestionar']
        : ['meses_trabajo.gestionar'],
    },
    branch: { id: sm },
    branchScope: { allBranches, branches: [{ id: sm }] },
  } as unknown as AuthenticatedUser;
}

function whereOf(mock: jest.Mock): Record<string, unknown> {
  return (mock.mock.calls[0] as [{ where: Record<string, unknown> }])[0].where;
}

const juanBox = { cuentas_caja: { personal_responsable_id: juan } };

function setup() {
  const tx = {
    $queryRaw: jest.fn((query: Prisma.Sql) => {
      if (query.sql.includes('meses_trabajo'))
        return Promise.resolve([
          { periodo: '2026-09', fecha_corte: day('2026-09-27') },
          { periodo: '2026-10', fecha_corte: day('2026-10-27') },
        ]);
      if (query.sql.includes('pagos_vehiculo'))
        return Promise.resolve([
          {
            importe: dec(60000),
            sucursal_id: dv,
            concepto: 'Patente',
            estado: 'PAGADO',
            responsable: juan,
            con_caja: true,
          },
          {
            importe: dec(30000),
            sucursal_id: sm,
            concepto: 'Seguro',
            estado: 'PENDIENTE',
            responsable: null,
            con_caja: false,
          },
        ]);
      if (query.sql.includes('liquidaciones_comisiones_gerente'))
        return Promise.resolve([{ monto_calculado: dec(45000) }]);
      return Promise.resolve([]);
    }),
    ingresos: {
      findMany: jest.fn().mockResolvedValue([
        {
          importe: dec(1000000),
          sucursal_id: sm,
          tipo_original: ' Venta ',
          estado_registro: 'PAGADO',
          movimientos_caja: [{ importe: dec(1000000), ...juanBox }],
        },
        {
          importe: dec(200000),
          sucursal_id: dv,
          tipo_original: 'Otros',
          estado_registro: 'PENDIENTE',
          movimientos_caja: [],
        },
      ]),
    },
    gastos: {
      findMany: jest.fn().mockResolvedValue([
        {
          importe: dec(100000),
          sucursal_id: null,
          categoria: 'PUBLICIDAD',
          estado_pago: 'PAGO_PARCIAL',
          movimientos_caja: [{ importe: dec(40000), ...juanBox }],
        },
        {
          importe: dec(80000),
          sucursal_id: sm,
          categoria: 'COMISIONES',
          estado_pago: 'PAGADO',
          movimientos_caja: [],
        },
      ]),
    },
    compras_proveedor: { findMany: jest.fn().mockResolvedValue([]) },
    operaciones: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'op1',
          sucursal_id: sm,
          estado_operacion: 'APROBADA',
          unidades_vehiculos: {
            costo_compra: dec(1),
            compras_proveedor: [{ importe_total: dec(2000000), moneda: 'ARS' }],
          },
        },
        {
          id: 'op2',
          sucursal_id: dv,
          estado_operacion: 'CERRADA',
          unidades_vehiculos: { costo_compra: null, compras_proveedor: [] },
        },
        {
          id: 'op3',
          sucursal_id: dv,
          estado_operacion: 'CANCELADA',
          unidades_vehiculos: { costo_compra: dec(5), compras_proveedor: [] },
        },
      ]),
    },
    sucursales: {
      findMany: jest.fn().mockResolvedValue([
        { id: dv, nombre: 'Del Viso' },
        { id: sm, nombre: 'San Miguel' },
      ]),
    },
    personal: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: juan, nombre_completo: 'Juan' }]),
    },
  };
  const prisma = {
    withTenant: jest.fn(
      (_scope: unknown, work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
    ),
  } as unknown as PrismaService;
  const sales = {
    collectionSummary: jest.fn().mockResolvedValue({
      agreedAmount: 3000000,
      collectedAmount: 1000000,
      pendingAmount: 2000000,
      pendingOperations: 1,
    }),
  };
  return {
    tx,
    sales,
    service: new BalanceService(prisma, sales as unknown as SalesService),
  };
}

describe('BalanceService.monthly', () => {
  it('uses the work month, splits by cash box and separates commissions', async () => {
    const { tx, service } = setup();
    const result = await service.monthly(actor(), {
      period: '2026-10',
      currency: 'ARS',
    });

    expect([result.from, result.to]).toEqual(['2026-09-28', '2026-10-27']);
    const incomeWhere = whereOf(tx.ingresos.findMany);
    expect(incomeWhere).toMatchObject({
      moneda: 'ARS',
      es_transferencia: false,
      estado_registro: { not: 'ANULADO' },
    });
    expect(whereOf(tx.gastos.findMany).fecha_generacion).toEqual({
      gte: day('2026-09-28'),
      lte: day('2026-10-27'),
    });

    const simple = result.entries.map((entry) => [
      entry.section,
      entry.line,
      entry.branch,
      entry.partner,
      entry.amount,
      entry.paid,
    ]);
    expect(simple).toEqual(
      expect.arrayContaining([
        ['INCOME', 'Venta', sm, juan, 1000000, true],
        ['INCOME', 'Otros', dv, 'NONE', 200000, false],
        ['EXPENSE', 'PUBLICIDAD', 'GENERAL', juan, 40000, true],
        ['EXPENSE', 'PUBLICIDAD', 'GENERAL', 'NONE', 60000, false],
        // Pagada pero sin movimiento de caja: cuenta como pagada.
        ['COMMISSION', 'Comisiones de vendedores', sm, 'NONE', 80000, true],
        [
          'COMMISSION',
          'Comisiones de gerentes',
          'GENERAL',
          'NONE',
          45000,
          true,
        ],
        ['VEHICLE_EXPENSE', 'Patente', dv, juan, 60000, true],
        ['VEHICLE_EXPENSE', 'Seguro', sm, 'NONE', 30000, false],
        // La compra de la unidad manda sobre el costo de la ficha.
        [
          'COST_OF_SALES',
          'Lo que costaron las unidades vendidas',
          sm,
          null,
          2000000,
          true,
        ],
      ]),
    );
    expect(result.entries).toHaveLength(9);
    expect(result.sales).toEqual({
      units: 2,
      unitsWithoutCost: 1,
      pending: [
        { branch: sm, amount: 2000000, operations: 1 },
        { branch: dv, amount: 2000000, operations: 1 },
      ],
    });
    expect(result.branches.map((branch) => branch.key)).toEqual([
      dv,
      sm,
      'GENERAL',
    ]);
    expect(result.partners.map((partner) => partner.key)).toEqual([
      juan,
      'NONE',
    ]);
  });

  it('defaults to the current work month', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-28T12:00:00-03:00'));
    try {
      const { service } = setup();
      const result = await service.monthly(actor(), { currency: 'ARS' });
      expect(result.period).toBe('2026-11');
      expect(result.current).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves out organization-wide rows for users with some branches', async () => {
    const { tx, service } = setup();
    const result = await service.monthly(actor(false), {
      period: '2026-10',
      currency: 'ARS',
    });

    expect(whereOf(tx.gastos.findMany).sucursal_id).toEqual({
      in: [sm],
    });
    expect(
      result.entries.filter(
        (entry) =>
          entry.line === 'Comisiones de gerentes' || entry.line === 'Patente',
      ),
    ).toEqual([]);
    expect(result.branches.map((branch) => branch.key)).not.toContain(
      'GENERAL',
    );
  });

  it('does not ask for pending sales in dollars', async () => {
    const { sales, service } = setup();
    await service.monthly(actor(), { period: '2026-10', currency: 'USD' });
    expect(sales.collectionSummary).not.toHaveBeenCalled();
  });
});

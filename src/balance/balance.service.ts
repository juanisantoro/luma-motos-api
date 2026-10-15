import { Injectable } from '@nestjs/common';
import { Prisma, tipo_movimiento_caja_luma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BranchScope } from '../branch-scope/branch-scope';
import { commissionOperationEligibility } from '../commissions/commissions.calculation';
import { scope } from '../finance/finance.utils';
import { monthWhere } from '../incomes/incomes.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import {
  loadWorkCalendar,
  toDateOnly,
} from '../work-months/work-months.calendar';
import type { BalanceQueryDto } from './balance.dto';

// Columnas del balance que no son una sucursal o un socio.
export const GENERAL_BRANCH = 'GENERAL'; // lo cargado sin sucursal
export const NO_ACCOUNT = 'NONE'; // todavía no cobrado/pagado, o sin caja
export const OTHER_ACCOUNTS = 'OTHER'; // cajas sin socio responsable

export type BalanceSection =
  | 'INCOME'
  | 'COST_OF_SALES'
  | 'EXPENSE'
  | 'VEHICLE_EXPENSE'
  | 'COMMISSION'
  | 'PURCHASE';

/**
 * Un importe del balance: cuánto, de qué renglón, de qué sucursal y en qué
 * caja (el socio responsable). `paid` dice si ya se cobró o pagó: lo que
 * falta va con `partner = NONE` y `paid = false`.
 */
export type BalanceEntry = {
  section: BalanceSection;
  line: string;
  branch: string;
  partner: string | null;
  amount: number;
  paid: boolean;
};

type Account = {
  personal_responsable_id: string | null;
} | null;

const ACTIVE_MOVEMENT = {
  revierte_a_id: null,
  other_movimientos_caja: null,
} as const;

const SELLER_COMMISSIONS = 'COMISIONES';

function money(value: Prisma.Decimal | number | null | undefined): number {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

function partnerOf(account: Account): string {
  if (!account) return NO_ACCOUNT;
  return account.personal_responsable_id ?? OTHER_ACCOUNTS;
}

function branchOf(id: string | null | undefined): string {
  return id ?? GENERAL_BRANCH;
}

function cleanLabel(value: string | null | undefined, fallback: string) {
  const text = (value ?? '').trim().replace(/\s+/g, ' ');
  return text || fallback;
}

/**
 * Reparte un importe entre las cajas que lo cobraron o pagaron. Lo que no
 * cubren los movimientos va a `NONE`: pendiente, salvo que el registro ya
 * figure pagado (`settled`), como lo importado sin movimientos de caja. Si
 * los movimientos suman más que el importe se respeta lo que dicen las cajas.
 */
function splitByAccounts(
  base: Omit<BalanceEntry, 'partner' | 'amount' | 'paid'>,
  total: number,
  movements: Array<{ importe: Prisma.Decimal; cuentas_caja: Account }>,
  settled: boolean,
): BalanceEntry[] {
  const out: BalanceEntry[] = [];
  let covered = 0;
  for (const movement of movements) {
    const amount = money(movement.importe);
    if (!amount) continue;
    covered += amount;
    out.push({
      ...base,
      partner: partnerOf(movement.cuentas_caja),
      amount,
      paid: true,
    });
  }
  const rest = money(total - covered);
  if (rest > 0)
    out.push({ ...base, partner: NO_ACCOUNT, amount: rest, paid: settled });
  return out;
}

@Injectable()
export class BalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
  ) {}

  async monthly(actor: AuthenticatedUser, query: BalanceQueryDto) {
    const organizationId = actor.organization.id;
    const currency = query.currency ?? 'ARS';
    // Lo que no es de una sucursal (gastos generales, comisiones de gerentes)
    // sólo lo ve quien tiene todas las sucursales, como en el resto.
    const branches = BranchScope.forActor(actor);
    const branchWhere = branches.where();
    const data = await this.prisma.withTenant(scope(actor), async (tx) => {
      const calendar = await loadWorkCalendar(tx, organizationId);
      const period = query.period ?? calendar.current();
      const range = calendar.range(period);
      const days = { gte: range.from, lte: range.to };
      // Las comisiones (de vendedores y de gerentes) van al mes que
      // liquidan, aunque se paguen en el siguiente.
      const entries: BalanceEntry[] = [];

      const [incomes, expenses, purchases, sales, vehicle, managers] =
        await Promise.all([
          tx.ingresos.findMany({
            where: {
              organizacion_id: organizationId,
              sucursal_id: branchWhere,
              moneda: currency,
              es_transferencia: false,
              estado_registro: { not: 'ANULADO' },
              AND: [monthWhere(range)],
            },
            select: {
              importe: true,
              sucursal_id: true,
              tipo_original: true,
              estado_registro: true,
              movimientos_caja: {
                where: {
                  ...ACTIVE_MOVEMENT,
                  tipo_movimiento: tipo_movimiento_caja_luma.INGRESO,
                },
                select: {
                  importe: true,
                  cuentas_caja: { select: { personal_responsable_id: true } },
                },
              },
            },
          }),
          tx.gastos.findMany({
            where: {
              organizacion_id: organizationId,
              sucursal_id: branchWhere,
              moneda: currency,
              estado_pago: { not: 'CANCELADA' },
              fecha_generacion: days,
            },
            select: {
              importe: true,
              sucursal_id: true,
              categoria: true,
              estado_pago: true,
              movimientos_caja: {
                where: {
                  ...ACTIVE_MOVEMENT,
                  tipo_movimiento: tipo_movimiento_caja_luma.EGRESO,
                },
                select: {
                  importe: true,
                  cuentas_caja: { select: { personal_responsable_id: true } },
                },
              },
            },
          }),
          tx.compras_proveedor.findMany({
            where: {
              organizacion_id: organizationId,
              sucursal_id: branchWhere,
              moneda: currency,
              estado_pago: { not: 'CANCELADA' },
              fecha_compra: days,
            },
            select: {
              importe_total: true,
              sucursal_id: true,
              estado_pago: true,
              movimientos_caja: {
                where: {
                  ...ACTIVE_MOVEMENT,
                  tipo_movimiento: tipo_movimiento_caja_luma.EGRESO,
                },
                select: {
                  importe: true,
                  cuentas_caja: { select: { personal_responsable_id: true } },
                },
              },
            },
          }),
          tx.operaciones.findMany({
            where: {
              organizacion_id: organizationId,
              sucursal_id: branchWhere,
              fecha_operacion: days,
            },
            select: {
              id: true,
              sucursal_id: true,
              estado_operacion: true,
              unidades_vehiculos: {
                select: {
                  costo_compra: true,
                  compras_proveedor: {
                    where: { estado_pago: { not: 'CANCELADA' } },
                    select: { importe_total: true, moneda: true },
                  },
                },
              },
            },
          }),
          tx.$queryRaw<
            Array<{
              importe: Prisma.Decimal;
              sucursal_id: string;
              concepto: string | null;
              estado: string;
              responsable: string | null;
              con_caja: boolean;
            }>
          >(Prisma.sql`
            SELECT p.importe, p.sucursal_id, c.nombre AS concepto, p.estado,
                   cc.personal_responsable_id AS responsable,
                   (cc.id IS NOT NULL) AS con_caja
            FROM pagos_vehiculo p
            LEFT JOIN conceptos_pago_vehiculo c ON c.id = p.concepto_id
            LEFT JOIN movimientos_caja m ON m.id = p.movimiento_caja_id
            LEFT JOIN cuentas_caja cc ON cc.id = m.cuenta_caja_id
            WHERE p.organizacion_id = ${organizationId}::uuid
              AND p.moneda = ${currency}
              AND p.fecha BETWEEN ${range.from}::date AND ${range.to}::date
          `),
          tx.$queryRaw<Array<{ monto_calculado: Prisma.Decimal }>>(Prisma.sql`
            SELECT g.monto_calculado
            FROM liquidaciones_comisiones_gerente g
            WHERE g.organizacion_id = ${organizationId}::uuid
              AND g.estado = 'PAGADA'
              AND g.moneda = ${currency}
              AND g.periodo_hasta BETWEEN ${range.from}::date AND ${range.to}::date
          `),
        ]);

      for (const income of incomes)
        entries.push(
          ...splitByAccounts(
            {
              section: 'INCOME',
              line: cleanLabel(income.tipo_original, 'Sin tipo'),
              branch: branchOf(income.sucursal_id),
            },
            money(income.importe),
            income.movimientos_caja,
            income.estado_registro === 'PAGADO',
          ),
        );

      for (const expense of expenses) {
        const commission =
          expense.categoria.trim().toUpperCase() === SELLER_COMMISSIONS;
        entries.push(
          ...splitByAccounts(
            {
              section: commission ? 'COMMISSION' : 'EXPENSE',
              line: commission
                ? 'Comisiones de vendedores'
                : cleanLabel(expense.categoria, 'Sin categoría'),
              branch: branchOf(expense.sucursal_id),
            },
            money(expense.importe),
            expense.movimientos_caja,
            expense.estado_pago === 'PAGADO',
          ),
        );
      }

      for (const payment of vehicle) {
        if (!branches.includes(payment.sucursal_id)) continue;
        const base = {
          section: 'VEHICLE_EXPENSE' as const,
          line: cleanLabel(payment.concepto, 'Otros'),
          branch: branchOf(payment.sucursal_id),
          amount: money(payment.importe),
        };
        entries.push(
          payment.estado === 'PAGADO'
            ? {
                ...base,
                partner: payment.con_caja
                  ? (payment.responsable ?? OTHER_ACCOUNTS)
                  : NO_ACCOUNT,
                paid: true,
              }
            : { ...base, partner: NO_ACCOUNT, paid: false },
        );
      }

      if (branches.allowedBranchIds === null)
        for (const settlement of managers)
          entries.push({
            section: 'COMMISSION',
            line: 'Comisiones de gerentes',
            branch: GENERAL_BRANCH,
            // El pago de la comisión de gerente no registra caja.
            partner: NO_ACCOUNT,
            amount: money(settlement.monto_calculado),
            paid: true,
          });

      for (const purchase of purchases)
        entries.push(
          ...splitByAccounts(
            {
              section: 'PURCHASE',
              line: 'Compras a proveedores',
              branch: branchOf(purchase.sucursal_id),
            },
            money(purchase.importe_total),
            purchase.movimientos_caja,
            purchase.estado_pago === 'PAGADO',
          ),
        );

      // Costo de lo vendido: lo que costó cada unidad vendida en el mes.
      // Se toma la compra al proveedor de esa unidad; si no está cargada, el
      // costo de la ficha de la unidad (en pesos).
      let soldUnits = 0;
      let unitsWithoutCost = 0;
      const soldByBranch = new Set<string>();
      for (const sale of sales) {
        if (!commissionOperationEligibility(sale.estado_operacion).computable)
          continue;
        soldByBranch.add(sale.sucursal_id);
        const unit = sale.unidades_vehiculos;
        if (!unit) continue;
        soldUnits += 1;
        const bought = unit.compras_proveedor;
        let cost: number | null = null;
        if (bought.length) {
          const inCurrency = bought.filter((row) => row.moneda === currency);
          if (inCurrency.length)
            cost = inCurrency.reduce(
              (total, row) => total + money(row.importe_total),
              0,
            );
          else continue; // costo cargado en la otra moneda
        } else if (unit.costo_compra !== null) {
          if (currency !== 'ARS') continue;
          cost = money(unit.costo_compra);
        }
        if (cost === null) {
          unitsWithoutCost += 1;
          continue;
        }
        entries.push({
          section: 'COST_OF_SALES',
          line: 'Lo que costaron las unidades vendidas',
          branch: branchOf(sale.sucursal_id),
          partner: null,
          amount: cost,
          paid: true,
        });
      }

      const branchKeys = new Set(entries.map((entry) => entry.branch));
      soldByBranch.forEach((id) => branchKeys.add(id));
      const partnerIds = [
        ...new Set(
          entries
            .map((entry) => entry.partner)
            .filter(
              (key): key is string =>
                !!key && key !== NO_ACCOUNT && key !== OTHER_ACCOUNTS,
            ),
        ),
      ];
      const [branchRows, partnerRows] = await Promise.all([
        tx.sucursales.findMany({
          where: {
            organizacion_id: organizationId,
            id: branchWhere,
            OR: [
              { activa: true },
              {
                id: {
                  in: [...branchKeys].filter((key) => key !== GENERAL_BRANCH),
                },
              },
            ],
          },
          select: { id: true, nombre: true },
          orderBy: { nombre: 'asc' },
        }),
        partnerIds.length
          ? tx.personal.findMany({
              where: {
                organizacion_id: organizationId,
                id: { in: partnerIds },
              },
              select: { id: true, nombre_completo: true },
              orderBy: { nombre_completo: 'asc' },
            })
          : Promise.resolve([]),
      ]);

      return {
        period,
        range,
        calendar,
        entries,
        soldUnits,
        unitsWithoutCost,
        soldBranches: [...soldByBranch],
        branches: [
          ...branchRows.map((row) => ({ key: row.id, name: row.nombre })),
          ...(branches.allowedBranchIds === null
            ? [{ key: GENERAL_BRANCH, name: 'Generales' }]
            : []),
        ],
        partners: [
          ...partnerRows.map((row) => ({
            key: row.id,
            name: row.nombre_completo,
          })),
          ...(entries.some((entry) => entry.partner === OTHER_ACCOUNTS)
            ? [{ key: OTHER_ACCOUNTS, name: 'Cajas sin socio' }]
            : []),
          { key: NO_ACCOUNT, name: 'Sin caja' },
        ],
      };
    });

    // Lo que falta cobrar de las ventas del mes, con las mismas reglas que
    // Seguimiento de cobros. Esas cuentas son en pesos.
    const pendingSales =
      currency === 'ARS'
        ? await Promise.all(
            data.soldBranches.map(async (branchId) => ({
              branch: branchId,
              ...(await this.sales.collectionSummary(actor, {
                branchId,
                period: data.period,
              })),
            })),
          )
        : [];

    const current = data.calendar.current();
    return {
      period: data.period,
      from: toDateOnly(data.range.from),
      to: toDateOnly(data.range.to),
      current: data.period === current,
      currency,
      branches: data.branches,
      partners: data.partners,
      entries: data.entries,
      sales: {
        units: data.soldUnits,
        unitsWithoutCost: data.unitsWithoutCost,
        pending: pendingSales
          .filter((row) => row.pendingAmount > 0)
          .map((row) => ({
            branch: row.branch,
            amount: money(row.pendingAmount),
            operations: row.pendingOperations,
          })),
      },
    };
  }
}

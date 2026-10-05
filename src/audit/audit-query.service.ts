import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BranchScope } from '../branch-scope/branch-scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABELS,
  auditActionInfo,
  auditActionsOfCategory,
} from './audit.catalog';
import {
  AuditLogQueryDto,
  AuditMoneyQueryDto,
} from './dto/audit-log-query.dto';

type Tx = Prisma.TransactionClient;

const PURCHASE_COSTS = 'compras.costos.consultar';
const TRACE_LIMIT = 500;

/**
 * Entidades de toda la organización (no pertenecen a una sucursal). De
 * cualquier otra, un usuario limitado a sus sucursales sólo ve el detalle si
 * el registro está dentro de su alcance.
 */
const ORGANIZATION_WIDE_ENTITIES = new Set([
  'clientes',
  'usuarios',
  'roles',
  'proveedores',
  'planes_credito',
  'financieras',
  'sesiones_autenticacion',
  'marcas_vehiculos',
  'modelos_vehiculos',
  'versiones_vehiculos',
]);

/** A qué registro se refiere un evento, ya resuelto para mostrarlo. */
export interface AuditSubject {
  title: string;
  detail: string | null;
  amount: string | null;
  operationId: string | null;
  operationNumber: string | null;
}

const logSelect = {
  id: true,
  accion: true,
  entidad: true,
  entidad_id: true,
  datos_anteriores: true,
  datos_nuevos: true,
  direccion_ip: true,
  creado_en: true,
  organizacion_id: true,
  organizacion_objetivo_id: true,
  organizaciones: { select: { codigo: true, nombre: true, tipo: true } },
  organizacion_objetivo: {
    select: { codigo: true, nombre: true, tipo: true },
  },
  usuarios: {
    select: {
      id: true,
      correo: true,
      personal: { select: { nombre_completo: true } },
      roles: { select: { nombre: true } },
      sucursales: { select: { id: true, codigo: true, nombre: true } },
    },
  },
} satisfies Prisma.registros_auditoriaSelect;

type LogRecord = Prisma.registros_auditoriaGetPayload<{
  select: typeof logSelect;
}>;

const operationRef = {
  select: {
    id: true,
    numero_operacion: true,
    clientes: { select: { nombre_completo: true } },
  },
} as const;

const person = { select: { id: true, nombre_completo: true } } as const;

const moneyInclude = {
  cuentas_caja: {
    select: {
      id: true,
      codigo: true,
      nombre: true,
      tipo_cuenta: true,
      moneda: true,
      sucursales: { select: { id: true, codigo: true, nombre: true } },
    },
  },
  personal: person,
  other_movimientos_caja: {
    select: { id: true, creado_en: true, notas: true, personal: person },
  },
  movimientos_caja: {
    select: { id: true, creado_en: true, compra_proveedor_id: true },
  },
  ingresos_movimientos_caja_ingreso: {
    select: {
      id: true,
      sucursal_id: true,
      tipo_original: true,
      descripcion: true,
      medio_pago: true,
      estado_rendicion: true,
      rendicion_confirmada_en: true,
      rendido_a: person,
      rendicion_confirmada_por: person,
      clientes: { select: { nombre_completo: true } },
      operaciones: operationRef,
    },
  },
  gastos: {
    select: {
      id: true,
      sucursal_id: true,
      categoria: true,
      detalle: true,
      operaciones: operationRef,
    },
  },
  compras_proveedor: {
    select: {
      id: true,
      numero_documento: true,
      proveedores: { select: { razon_social: true } },
    },
  },
  liquidaciones_comisiones: {
    select: {
      id: true,
      personal_liquidaciones_comisiones_personal_idTopersonal: person,
    },
  },
  transferencias_caja_movimientos_caja_transferencia_idTotransferencias_caja: {
    select: {
      id: true,
      cuentas_caja_transferencias_caja_cuenta_origen_idTocuentas_caja: {
        select: { nombre: true },
      },
      cuentas_caja_transferencias_caja_cuenta_destino_idTocuentas_caja: {
        select: { nombre: true },
      },
    },
  },
} satisfies Prisma.movimientos_cajaInclude;

type MoneyRecord = Prisma.movimientos_cajaGetPayload<{
  include: typeof moneyInclude;
}>;

function range(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    gte: from ? new Date(from) : undefined,
    lte: to ? new Date(to) : undefined,
  };
}

function money(value: Prisma.Decimal | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

function named(row: { id: string; nombre_completo: string } | null) {
  return row ? { id: row.id, fullName: row.nombre_completo } : null;
}

function subject(
  title: string,
  extra: Partial<Omit<AuditSubject, 'title'>> = {},
): AuditSubject {
  return {
    title,
    detail: extra.detail ?? null,
    amount: extra.amount ?? null,
    operationId: extra.operationId ?? null,
    operationNumber: extra.operationNumber ?? null,
  };
}

/**
 * Lectura de la auditoría: bitácora de eventos, trazabilidad de una venta y
 * libro de movimientos de dinero. No escribe nada: la escritura sigue en
 * `AuditService` (`record`/`execute`).
 */
@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(actor: AuthenticatedUser) {
    return {
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
    };
  }

  private tenantWhere(
    actor: AuthenticatedUser,
  ): Prisma.registros_auditoriaWhereInput {
    return actor.globalAccess
      ? {}
      : {
          OR: [
            { organizacion_id: actor.organization.id },
            { organizacion_objetivo_id: actor.organization.id },
          ],
        };
  }

  /** Opciones de los filtros de la pantalla. */
  async filters(actor: AuthenticatedUser) {
    const [users, accounts, branches] = await this.prisma.withTenant(
      this.scope(actor),
      (tx) =>
        Promise.all([
          tx.usuarios.findMany({
            where: actor.globalAccess
              ? undefined
              : { organizacion_id: actor.organization.id },
            select: {
              id: true,
              correo: true,
              activo: true,
              personal: { select: { nombre_completo: true } },
            },
            orderBy: { correo: 'asc' },
          }),
          tx.cuentas_caja.findMany({
            where: {
              organizacion_id: actor.globalAccess
                ? undefined
                : actor.organization.id,
              ...BranchScope.forActor(
                actor,
              ).whereSharedOrInScope<Prisma.cuentas_cajaWhereInput>(),
            },
            select: {
              id: true,
              nombre: true,
              moneda: true,
              activo: true,
              sucursal_id: true,
            },
            orderBy: { nombre: 'asc' },
          }),
          tx.sucursales.findMany({
            where: {
              organizacion_id: actor.globalAccess
                ? undefined
                : actor.organization.id,
              id: BranchScope.forActor(actor).where(),
            },
            select: { id: true, codigo: true, nombre: true },
            orderBy: { nombre: 'asc' },
          }),
        ]),
    );
    return {
      categories: AUDIT_CATEGORIES.map((code) => ({
        code,
        label: AUDIT_CATEGORY_LABELS[code],
      })),
      actions: Object.entries(AUDIT_ACTIONS)
        .map(([code, info]) => ({
          code,
          label: info.label,
          category: info.category,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es')),
      actors: users
        .map((user) => ({
          id: user.id,
          email: user.correo,
          name: user.personal?.nombre_completo ?? null,
          active: user.activo,
        }))
        .sort((a, b) =>
          (a.name ?? a.email).localeCompare(b.name ?? b.email, 'es'),
        ),
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.nombre,
        currency: account.moneda,
        branchId: account.sucursal_id,
        active: account.activo,
      })),
      branches: branches.map((branch) => ({
        id: branch.id,
        code: branch.codigo,
        name: branch.nombre,
      })),
    };
  }

  /** Bitácora: quién hizo qué y cuándo, con filtros. */
  async findLogs(query: AuditLogQueryDto, actor: AuthenticatedUser) {
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const and: Prisma.registros_auditoriaWhereInput[] = [
        this.tenantWhere(actor),
      ];
      const operationId = await this.resolveOperationId(tx, query, actor);
      if (operationId === null)
        return { items: [], total: 0, page: query.page, limit: query.limit };
      if (operationId)
        and.push({ OR: await this.operationWhere(tx, operationId) });
      if (query.category)
        and.push(
          query.category === 'OTROS'
            ? { accion: { notIn: Object.keys(AUDIT_ACTIONS) } }
            : { accion: { in: auditActionsOfCategory(query.category) } },
        );
      const where: Prisma.registros_auditoriaWhereInput = {
        AND: and,
        accion: query.action,
        entidad: query.entity,
        entidad_id: query.entityId,
        usuario_id: query.actorId,
        creado_en: range(query.from, query.to),
      };
      const [total, records] = await Promise.all([
        tx.registros_auditoria.count({ where }),
        tx.registros_auditoria.findMany({
          where,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ creado_en: 'desc' }, { id: 'desc' }],
          select: logSelect,
        }),
      ]);
      return {
        items: await this.logItems(tx, records, actor),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  /**
   * Trazabilidad de una venta: sus datos, quién pidió y quién decidió cada
   * aprobación, todos los eventos (propios y de sus ingresos, gastos, pagos
   * y cuotas) en orden cronológico y los movimientos de dinero asociados.
   */
  async operationTrace(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const operation = await tx.operaciones.findFirst({
        where: {
          id,
          organizacion_id: actor.globalAccess
            ? undefined
            : actor.organization.id,
          sucursal_id: BranchScope.forActor(actor).where(),
        },
        select: {
          id: true,
          numero_operacion: true,
          numero_boleto: true,
          fecha_operacion: true,
          estado_operacion: true,
          estado_entrega: true,
          entregado_en: true,
          precio_lista: true,
          precio_minimo: true,
          precio_acordado: true,
          creado_en: true,
          actualizado_en: true,
          clientes: { select: { nombre_completo: true } },
          sucursales: { select: { id: true, codigo: true, nombre: true } },
          personal: person,
          versiones_vehiculos: { select: { nombre: true } },
          unidades_vehiculos: { select: { vin_mostrado: true } },
          aprobaciones_operacion: {
            orderBy: { solicitado_en: 'asc' },
            select: {
              id: true,
              decision: true,
              solicitado_en: true,
              decidido_en: true,
              precio_lista_referencia: true,
              precio_minimo_referencia: true,
              precio_acordado_referencia: true,
              motivo: true,
              personal_aprobaciones_operacion_solicitado_por_personal_idTopersonal:
                person,
              personal_aprobaciones_operacion_decidido_por_personal_idTopersonal:
                person,
            },
          },
        },
      });
      if (!operation) throw new NotFoundException('Operation not found');

      const eventsWhere: Prisma.registros_auditoriaWhereInput = {
        AND: [
          this.tenantWhere(actor),
          { OR: await this.operationWhere(tx, id) },
        ],
      };
      const [records, total, movements] = await Promise.all([
        tx.registros_auditoria.findMany({
          where: eventsWhere,
          orderBy: [{ creado_en: 'asc' }, { id: 'asc' }],
          take: TRACE_LIMIT,
          select: logSelect,
        }),
        tx.registros_auditoria.count({ where: eventsWhere }),
        tx.movimientos_caja.findMany({
          where: {
            OR: [
              { ingresos_movimientos_caja_ingreso: { operacion_id: id } },
              { gastos: { operacion_id: id } },
            ],
          },
          include: moneyInclude,
          orderBy: [{ creado_en: 'asc' }, { id: 'asc' }],
          take: TRACE_LIMIT,
        }),
      ]);

      return {
        operation: {
          id: operation.id,
          number: operation.numero_operacion.toString(),
          ticketNumber: operation.numero_boleto,
          date: operation.fecha_operacion,
          status: operation.estado_operacion,
          deliveryStatus: operation.estado_entrega,
          deliveredAt: operation.entregado_en,
          client: operation.clientes.nombre_completo,
          vehicle: operation.versiones_vehiculos.nombre,
          vin: operation.unidades_vehiculos?.vin_mostrado ?? null,
          branch: {
            id: operation.sucursales.id,
            code: operation.sucursales.codigo,
            name: operation.sucursales.nombre,
          },
          listPrice: money(operation.precio_lista),
          minimumPrice: money(operation.precio_minimo),
          agreedPrice: money(operation.precio_acordado),
          createdBy: named(operation.personal),
          createdAt: operation.creado_en,
          updatedAt: operation.actualizado_en,
        },
        approvals: operation.aprobaciones_operacion.map((approval) => ({
          id: approval.id,
          decision: approval.decision,
          requestedBy: named(
            approval.personal_aprobaciones_operacion_solicitado_por_personal_idTopersonal,
          ),
          requestedAt: approval.solicitado_en,
          decidedBy: named(
            approval.personal_aprobaciones_operacion_decidido_por_personal_idTopersonal,
          ),
          decidedAt: approval.decidido_en,
          listPrice: money(approval.precio_lista_referencia),
          minimumPrice: money(approval.precio_minimo_referencia),
          agreedPrice: money(approval.precio_acordado_referencia),
          reason: approval.motivo,
        })),
        events: await this.logItems(tx, records, actor),
        eventsTotal: total,
        movements: movements.map((item) => this.moneyItem(item, actor)),
      };
    });
  }

  /**
   * Libro de dinero: cada movimiento de caja con fecha y hora de carga, quién
   * lo registró, a qué corresponde, a quién se rindió el efectivo, quién
   * confirmó la rendición y si fue reversado.
   */
  async moneyMovements(query: AuditMoneyQueryDto, actor: AuthenticatedUser) {
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const empty = {
        items: [],
        total: 0,
        page: query.page,
        limit: query.limit,
        totals: null,
        summary: null,
      };
      const and: Prisma.movimientos_cajaWhereInput[] = [];
      const operationId = await this.resolveOperationId(tx, query, actor);
      if (operationId === null) return empty;
      if (operationId)
        and.push({
          OR: [
            {
              ingresos_movimientos_caja_ingreso: { operacion_id: operationId },
            },
            { gastos: { operacion_id: operationId } },
          ],
        });
      if (query.actorId) {
        const personnel = await tx.personal.findMany({
          where: { usuario_id: query.actorId },
          select: { id: true },
        });
        if (personnel.length === 0) return empty;
        and.push({
          registrado_por_personal_id: { in: personnel.map((row) => row.id) },
        });
      }
      if (query.onlyReversals === 'true')
        and.push({
          OR: [
            { revierte_a_id: { not: null } },
            { other_movimientos_caja: { isNot: null } },
          ],
        });
      const search = query.search?.trim();
      if (search) {
        const contains = { contains: search, mode: 'insensitive' as const };
        and.push({
          OR: [
            { referencia: contains },
            { notas: contains },
            { ingresos_movimientos_caja_ingreso: { descripcion: contains } },
            {
              ingresos_movimientos_caja_ingreso: {
                clientes: { nombre_completo: contains },
              },
            },
            { gastos: { detalle: contains } },
            { personal: { nombre_completo: contains } },
          ],
        });
      }
      const where: Prisma.movimientos_cajaWhereInput = {
        AND: and,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
        cuentas_caja: {
          AND: [
            BranchScope.forActor(
              actor,
            ).whereSharedOrInScope<Prisma.cuentas_cajaWhereInput>() ?? {},
            query.branchId ? { sucursal_id: query.branchId } : {},
          ],
        },
        cuenta_caja_id: query.accountId,
        direccion: query.direction,
        tipo_movimiento: query.type,
        creado_en: range(query.from, query.to),
      };
      const canSeePurchases = actor.role.permissions.includes(PURCHASE_COSTS);
      // Totales de lo vigente: ni lo reversado ni sus reversas.
      const active: Prisma.movimientos_cajaWhereInput = {
        AND: [where, { revierte_a_id: null, other_movimientos_caja: null }],
      };
      const [total, items, sums, pending] = await Promise.all([
        tx.movimientos_caja.count({ where }),
        tx.movimientos_caja.findMany({
          where,
          include: moneyInclude,
          orderBy: [{ creado_en: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        canSeePurchases
          ? tx.movimientos_caja.groupBy({
              by: ['cuenta_caja_id', 'direccion'],
              where: active,
              _sum: { importe: true },
            })
          : Promise.resolve(null),
        // Efectivo cobrado que todavía no confirmó quien lo recibe.
        canSeePurchases
          ? tx.movimientos_caja.groupBy({
              by: ['cuenta_caja_id'],
              where: {
                AND: [
                  active,
                  {
                    direccion: 'CREDITO',
                    ingresos_movimientos_caja_ingreso: {
                      estado_rendicion: 'PENDIENTE_RENDICION',
                    },
                  },
                ],
              },
              _sum: { importe: true },
            })
          : Promise.resolve(null),
      ]);
      // Pesos y dólares no se suman: un total por moneda de la cuenta.
      let totals: Array<{
        currency: string;
        credit: string;
        debit: string;
      }> | null = null;
      // Resumen para el cierre: una fila por caja, con su sucursal y moneda.
      let summary: Array<{
        account: { id: string; name: string; type: string };
        branch: { id: string; code: string; name: string } | null;
        currency: string;
        credit: string;
        debit: string;
        pendingHandover: string;
      }> | null = null;
      if (sums) {
        const zero = new Prisma.Decimal(0);
        const accounts = await tx.cuentas_caja.findMany({
          where: { id: { in: sums.map((row) => row.cuenta_caja_id) } },
          select: {
            id: true,
            nombre: true,
            tipo_cuenta: true,
            moneda: true,
            sucursales: { select: { id: true, codigo: true, nombre: true } },
          },
        });
        const rows = accounts.map((account) => {
          const of = (direction: 'CREDITO' | 'DEBITO') =>
            sums.find(
              (row) =>
                row.cuenta_caja_id === account.id &&
                row.direccion === direction,
            )?._sum.importe ?? zero;
          return {
            account,
            credit: of('CREDITO'),
            debit: of('DEBITO'),
            pending:
              pending?.find((row) => row.cuenta_caja_id === account.id)?._sum
                .importe ?? zero,
          };
        });
        const byCurrency = new Map<
          string,
          { credit: Prisma.Decimal; debit: Prisma.Decimal }
        >();
        for (const row of rows) {
          const entry = byCurrency.get(row.account.moneda) ?? {
            credit: zero,
            debit: zero,
          };
          byCurrency.set(row.account.moneda, {
            credit: entry.credit.plus(row.credit),
            debit: entry.debit.plus(row.debit),
          });
        }
        totals = [...byCurrency.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([currency, entry]) => ({
            currency,
            credit: entry.credit.toString(),
            debit: entry.debit.toString(),
          }));
        summary = rows
          .sort(
            (left, right) =>
              (left.account.sucursales?.nombre ?? '').localeCompare(
                right.account.sucursales?.nombre ?? '',
                'es',
              ) ||
              left.account.nombre.localeCompare(right.account.nombre, 'es') ||
              left.account.moneda.localeCompare(right.account.moneda),
          )
          .map((row) => ({
            account: {
              id: row.account.id,
              name: row.account.nombre,
              type: row.account.tipo_cuenta,
            },
            branch: row.account.sucursales
              ? {
                  id: row.account.sucursales.id,
                  code: row.account.sucursales.codigo,
                  name: row.account.sucursales.nombre,
                }
              : null,
            currency: row.account.moneda,
            credit: row.credit.toString(),
            debit: row.debit.toString(),
            pendingHandover: row.pending.toString(),
          }));
      }
      return {
        items: items.map((item) => this.moneyItem(item, actor)),
        total,
        page: query.page,
        limit: query.limit,
        totals,
        summary,
      };
    });
  }

  private moneyItem(item: MoneyRecord, actor: AuthenticatedUser) {
    const sensitivePurchase =
      (Boolean(item.compra_proveedor_id) ||
        Boolean(item.movimientos_caja?.compra_proveedor_id)) &&
      !actor.role.permissions.includes(PURCHASE_COSTS);
    const income = item.ingresos_movimientos_caja_ingreso;
    const expense = item.gastos;
    const purchase = item.compras_proveedor;
    const settlement = item.liquidaciones_comisiones;
    const transfer =
      item.transferencias_caja_movimientos_caja_transferencia_idTotransferencias_caja;
    const branchScope = BranchScope.forActor(actor);
    const originBranchId = income?.sucursal_id ?? expense?.sucursal_id;
    // Cuenta compartida con un cobro de otra sucursal: se ve el movimiento,
    // no a qué venta ni a qué cliente corresponde.
    const originVisible =
      branchScope.allBranches ||
      !originBranchId ||
      branchScope.branchIds.includes(originBranchId);
    const operation = originVisible
      ? (income?.operaciones ?? expense?.operaciones ?? null)
      : null;
    let source: { kind: string; id: string | null; title: string };
    if (income)
      source = {
        kind: 'INCOME',
        id: income.id,
        title: [income.tipo_original, income.descripcion]
          .filter(Boolean)
          .join(' · '),
      };
    else if (settlement)
      source = {
        kind: 'COMMISSION',
        id: settlement.id,
        title: `Comisión de ${settlement.personal_liquidaciones_comisiones_personal_idTopersonal.nombre_completo}`,
      };
    else if (expense)
      source = {
        kind: 'EXPENSE',
        id: expense.id,
        title: [expense.categoria, expense.detalle].filter(Boolean).join(' · '),
      };
    else if (purchase)
      source = {
        kind: 'PURCHASE',
        id: purchase.id,
        title: [
          `Compra a ${purchase.proveedores.razon_social}`,
          purchase.numero_documento,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    else if (transfer)
      source = {
        kind: 'TRANSFER',
        id: transfer.id,
        title: `${transfer.cuentas_caja_transferencias_caja_cuenta_origen_idTocuentas_caja.nombre} → ${transfer.cuentas_caja_transferencias_caja_cuenta_destino_idTocuentas_caja.nombre}`,
      };
    else source = { kind: 'OTHER', id: null, title: 'Movimiento manual' };

    return {
      id: item.id,
      createdAt: item.creado_en,
      occurredAt: item.contabilizado_en,
      account: {
        id: item.cuentas_caja.id,
        code: item.cuentas_caja.codigo,
        name: item.cuentas_caja.nombre,
        type: item.cuentas_caja.tipo_cuenta,
        currency: item.cuentas_caja.moneda,
      },
      branch: item.cuentas_caja.sucursales
        ? {
            id: item.cuentas_caja.sucursales.id,
            code: item.cuentas_caja.sucursales.codigo,
            name: item.cuentas_caja.sucursales.nombre,
          }
        : null,
      type: item.tipo_movimiento,
      direction: item.direccion,
      amount: sensitivePurchase ? null : item.importe.toString(),
      reference: item.referencia,
      notes: item.notas,
      registeredBy: named(item.personal),
      source,
      client: originVisible
        ? (income?.clientes?.nombre_completo ?? null)
        : null,
      operation: operation
        ? {
            id: operation.id,
            number: operation.numero_operacion.toString(),
            client: operation.clientes.nombre_completo,
          }
        : null,
      paymentMethod: income?.medio_pago ?? null,
      handover: income?.rendido_a
        ? {
            to: named(income.rendido_a),
            status: income.estado_rendicion,
            confirmedAt: income.rendicion_confirmada_en,
            confirmedBy: named(income.rendicion_confirmada_por),
          }
        : null,
      reversalOfId: item.revierte_a_id,
      reversal: item.other_movimientos_caja
        ? {
            id: item.other_movimientos_caja.id,
            at: item.other_movimientos_caja.creado_en,
            by: named(item.other_movimientos_caja.personal),
            notes: item.other_movimientos_caja.notas,
          }
        : null,
    };
  }

  /**
   * `undefined`: no se filtró por venta. `null`: se pidió una venta que no
   * existe o que el usuario no puede ver (la respuesta es una página vacía).
   */
  private async resolveOperationId(
    tx: Tx,
    query: { operationId?: string; operationNumber?: number },
    actor: AuthenticatedUser,
  ): Promise<string | null | undefined> {
    if (!query.operationId && !query.operationNumber) return undefined;
    const operation = await tx.operaciones.findFirst({
      where: {
        id: query.operationId,
        numero_operacion: query.operationNumber
          ? BigInt(query.operationNumber)
          : undefined,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
        sucursal_id: BranchScope.forActor(actor).where(),
      },
      select: { id: true },
    });
    return operation?.id ?? null;
  }

  /** Eventos de la venta y de todo lo que cuelga de ella. */
  private async operationWhere(
    tx: Tx,
    operationId: string,
  ): Promise<Prisma.registros_auditoriaWhereInput[]> {
    const by = { where: { operacion_id: operationId }, select: { id: true } };
    const [incomes, expenses, vehiclePayments, credits] = await Promise.all([
      tx.ingresos.findMany(by),
      tx.gastos.findMany(by),
      tx.pagos_vehiculo.findMany(by),
      tx.operacion_creditos.findMany(by),
    ]);
    const installments = credits.length
      ? await tx.cuotas_credito.findMany({
          where: { operacion_credito_id: { in: credits.map((row) => row.id) } },
          select: { id: true },
        })
      : [];
    const related: Array<[string, Array<{ id: string }>]> = [
      ['ingresos', incomes],
      ['gastos', expenses],
      ['pagos_vehiculo', vehiclePayments],
      ['operacion_creditos', credits],
      ['cuotas_credito', installments],
    ];
    return [
      { entidad: 'operaciones', entidad_id: operationId },
      ...related
        .filter(([, rows]) => rows.length > 0)
        .map(([entidad, rows]) => ({
          entidad,
          entidad_id: { in: rows.map((row) => row.id) },
        })),
    ];
  }

  private async logItems(
    tx: Tx,
    records: LogRecord[],
    actor: AuthenticatedUser,
  ) {
    const subjects = await this.subjects(tx, records, actor);
    const allBranches = BranchScope.forActor(actor).allBranches;
    return records.map((record) => {
      const info = auditActionInfo(record.accion);
      const found = record.entidad_id
        ? (subjects.get(`${record.entidad}:${record.entidad_id}`) ?? null)
        : null;
      // Registro de otra sucursal: queda quién y cuándo, sin el detalle.
      const restricted =
        !allBranches &&
        !found &&
        !ORGANIZATION_WIDE_ENTITIES.has(record.entidad);
      return {
        id: record.id,
        createdAt: record.creado_en,
        action: record.accion,
        actionLabel: info.label,
        category: info.category,
        categoryLabel: AUDIT_CATEGORY_LABELS[info.category],
        entity: record.entidad,
        entityId: record.entidad_id,
        subject: found,
        restricted,
        metadata: restricted ? null : record.datos_nuevos,
        previousData: restricted ? null : record.datos_anteriores,
        ipAddress: record.direccion_ip,
        organization: {
          id: record.organizacion_id,
          code: record.organizaciones.codigo,
          name: record.organizaciones.nombre,
          type: record.organizaciones.tipo,
        },
        targetOrganization:
          record.organizacion_objetivo && record.organizacion_objetivo_id
            ? {
                id: record.organizacion_objetivo_id,
                code: record.organizacion_objetivo.codigo,
                name: record.organizacion_objetivo.nombre,
                type: record.organizacion_objetivo.tipo,
              }
            : null,
        actor: record.usuarios
          ? {
              id: record.usuarios.id,
              email: record.usuarios.correo,
              name: record.usuarios.personal?.nombre_completo ?? null,
              role: record.usuarios.roles?.nombre ?? null,
            }
          : null,
        branch: record.usuarios?.sucursales
          ? {
              id: record.usuarios.sucursales.id,
              code: record.usuarios.sucursales.codigo,
              name: record.usuarios.sucursales.nombre,
            }
          : null,
      };
    });
  }

  /**
   * Resuelve, con una consulta por tabla, a qué registro apunta cada evento
   * de la página. Un registro que ya no existe o una tabla que no está acá
   * deja el evento sin `subject` (se sigue viendo la acción y su id).
   */
  private async subjects(
    tx: Tx,
    records: LogRecord[],
    actor: AuthenticatedUser,
  ): Promise<Map<string, AuditSubject>> {
    const ids = new Map<string, Set<string>>();
    for (const record of records) {
      if (!record.entidad_id) continue;
      const set = ids.get(record.entidad) ?? new Set<string>();
      set.add(record.entidad_id);
      ids.set(record.entidad, set);
    }
    const result = new Map<string, AuditSubject>();
    const of = (entity: string) => [...(ids.get(entity) ?? [])];
    const put = (entity: string, id: string, value: AuditSubject) =>
      result.set(`${entity}:${id}`, value);
    const opFields = (
      operation: {
        id: string;
        numero_operacion: bigint;
      } | null,
    ) => ({
      operationId: operation?.id ?? null,
      operationNumber: operation?.numero_operacion.toString() ?? null,
    });
    const idIn = (entity: string) => ({ id: { in: of(entity) } });
    const branchScope = BranchScope.forActor(actor);
    const inScope = (branchId: string | null) =>
      branchScope.allBranches ||
      branchId === null ||
      branchScope.branchIds.includes(branchId);
    const branch = { sucursal_id: branchScope.where() };
    /** Sólo las ventas que el usuario puede ver. */
    const visibleOperations = (operationIds: string[]) =>
      tx.operaciones.findMany({
        where: { id: { in: operationIds }, ...branch },
        select: { id: true, numero_operacion: true },
      });
    const tasks: Array<Promise<void>> = [];
    const load = (entity: string, task: () => Promise<void>) => {
      if (of(entity).length > 0) tasks.push(task());
    };

    load('operaciones', async () => {
      const rows = await tx.operaciones.findMany({
        where: { ...idIn('operaciones'), ...branch },
        select: {
          id: true,
          numero_operacion: true,
          numero_boleto: true,
          precio_acordado: true,
          clientes: { select: { nombre_completo: true } },
        },
      });
      for (const row of rows)
        put(
          'operaciones',
          row.id,
          subject(`Venta N.º ${row.numero_operacion}`, {
            detail: [
              row.clientes.nombre_completo,
              row.numero_boleto ? `boleto ${row.numero_boleto}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            amount: money(row.precio_acordado),
            ...opFields(row),
          }),
        );
    });
    load('ingresos', async () => {
      const rows = await tx.ingresos.findMany({
        where: { ...idIn('ingresos'), ...branch },
        select: {
          id: true,
          tipo_original: true,
          descripcion: true,
          importe: true,
          clientes: { select: { nombre_completo: true } },
          rendido_a: { select: { nombre_completo: true } },
          operaciones: { select: { id: true, numero_operacion: true } },
        },
      });
      for (const row of rows)
        put(
          'ingresos',
          row.id,
          subject(`Ingreso: ${row.tipo_original}`, {
            detail:
              [
                row.descripcion,
                row.clientes?.nombre_completo,
                row.rendido_a
                  ? `rinde a ${row.rendido_a.nombre_completo}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || null,
            amount: money(row.importe),
            ...opFields(row.operaciones),
          }),
        );
    });
    load('gastos', async () => {
      const rows = await tx.gastos.findMany({
        where: idIn('gastos'),
        select: {
          id: true,
          sucursal_id: true,
          categoria: true,
          detalle: true,
          importe: true,
          operaciones: { select: { id: true, numero_operacion: true } },
        },
      });
      for (const row of rows.filter((item) => inScope(item.sucursal_id)))
        put(
          'gastos',
          row.id,
          subject(`Gasto: ${row.categoria}`, {
            detail: row.detalle || null,
            amount: money(row.importe),
            ...opFields(row.operaciones),
          }),
        );
    });
    load('compras_proveedor', async () => {
      const canSee = actor.role.permissions.includes(PURCHASE_COSTS);
      const rows = await tx.compras_proveedor.findMany({
        where: idIn('compras_proveedor'),
        select: {
          id: true,
          sucursal_id: true,
          numero_documento: true,
          importe_total: true,
          proveedores: { select: { razon_social: true } },
        },
      });
      for (const row of rows.filter((item) => inScope(item.sucursal_id)))
        put(
          'compras_proveedor',
          row.id,
          subject(`Compra a ${row.proveedores.razon_social}`, {
            detail: row.numero_documento,
            amount: canSee ? money(row.importe_total) : null,
          }),
        );
    });
    load('pagos_vehiculo', async () => {
      const rows = await tx.pagos_vehiculo.findMany({
        where: idIn('pagos_vehiculo'),
        select: {
          id: true,
          importe: true,
          estado: true,
          operacion_id: true,
          unidad_vehiculo_id: true,
        },
      });
      const [operations, units] = await Promise.all([
        visibleOperations(
          rows.flatMap((row) => (row.operacion_id ? [row.operacion_id] : [])),
        ),
        tx.unidades_vehiculos.findMany({
          where: {
            id: { in: rows.map((row) => row.unidad_vehiculo_id) },
            ...branch,
          },
          select: { id: true, vin_mostrado: true },
        }),
      ]);
      for (const row of rows) {
        const unit = units.find((item) => item.id === row.unidad_vehiculo_id);
        if (!unit) continue;
        put(
          'pagos_vehiculo',
          row.id,
          subject('Pago de patente/seguro', {
            detail: `${unit.vin_mostrado} · ${row.estado}`,
            amount: money(row.importe),
            ...opFields(
              operations.find((item) => item.id === row.operacion_id) ?? null,
            ),
          }),
        );
      }
    });
    const creditOperations = async (creditIds: string[]) => {
      const credits = await tx.operacion_creditos.findMany({
        where: { id: { in: creditIds } },
        select: { id: true, operacion_id: true, monto_total: true },
      });
      const operations = await visibleOperations(
        credits.map((row) => row.operacion_id),
      );
      // Un crédito cuya venta está fuera del alcance no se describe.
      return credits.flatMap((credit) => {
        const operation = operations.find(
          (item) => item.id === credit.operacion_id,
        );
        return operation ? [{ ...credit, operation }] : [];
      });
    };
    load('operacion_creditos', async () => {
      for (const row of await creditOperations(of('operacion_creditos')))
        put(
          'operacion_creditos',
          row.id,
          subject('Crédito propio', {
            amount: money(row.monto_total),
            ...opFields(row.operation),
          }),
        );
    });
    load('cuotas_credito', async () => {
      const rows = await tx.cuotas_credito.findMany({
        where: idIn('cuotas_credito'),
        select: {
          id: true,
          numero_cuota: true,
          monto: true,
          operacion_credito_id: true,
        },
      });
      const credits = await creditOperations(
        rows.map((row) => row.operacion_credito_id),
      );
      for (const row of rows) {
        const credit = credits.find(
          (item) => item.id === row.operacion_credito_id,
        );
        if (!credit) continue;
        put(
          'cuotas_credito',
          row.id,
          subject(`Cuota ${row.numero_cuota}`, {
            amount: money(row.monto),
            ...opFields(credit.operation),
          }),
        );
      }
    });
    load('transferencias_caja', async () => {
      const rows = await tx.transferencias_caja.findMany({
        where: idIn('transferencias_caja'),
        select: {
          id: true,
          importe: true,
          cuentas_caja_transferencias_caja_cuenta_origen_idTocuentas_caja: {
            select: { nombre: true, sucursal_id: true },
          },
          cuentas_caja_transferencias_caja_cuenta_destino_idTocuentas_caja: {
            select: { nombre: true, sucursal_id: true },
          },
        },
      });
      for (const row of rows.filter(
        (item) =>
          inScope(
            item.cuentas_caja_transferencias_caja_cuenta_origen_idTocuentas_caja
              .sucursal_id,
          ) &&
          inScope(
            item
              .cuentas_caja_transferencias_caja_cuenta_destino_idTocuentas_caja
              .sucursal_id,
          ),
      ))
        put(
          'transferencias_caja',
          row.id,
          subject('Transferencia entre cuentas', {
            detail: `${row.cuentas_caja_transferencias_caja_cuenta_origen_idTocuentas_caja.nombre} → ${row.cuentas_caja_transferencias_caja_cuenta_destino_idTocuentas_caja.nombre}`,
            amount: money(row.importe),
          }),
        );
    });
    load('liquidaciones_comisiones', async () => {
      const rows = await tx.liquidaciones_comisiones.findMany({
        where: { ...idIn('liquidaciones_comisiones'), ...branch },
        select: {
          id: true,
          importe_acordado: true,
          importe_sugerido: true,
          personal_liquidaciones_comisiones_personal_idTopersonal: {
            select: { nombre_completo: true },
          },
        },
      });
      for (const row of rows)
        put(
          'liquidaciones_comisiones',
          row.id,
          subject(
            `Comisión de ${row.personal_liquidaciones_comisiones_personal_idTopersonal.nombre_completo}`,
            { amount: money(row.importe_acordado ?? row.importe_sugerido) },
          ),
        );
    });
    load('cuentas_caja', async () => {
      const rows = await tx.cuentas_caja.findMany({
        where: idIn('cuentas_caja'),
        select: { id: true, nombre: true, sucursal_id: true },
      });
      for (const row of rows.filter((item) => inScope(item.sucursal_id)))
        put('cuentas_caja', row.id, subject(`Cuenta ${row.nombre}`));
    });
    load('clientes', async () => {
      const rows = await tx.clientes.findMany({
        where: idIn('clientes'),
        select: { id: true, nombre_completo: true, numero_documento: true },
      });
      for (const row of rows)
        put(
          'clientes',
          row.id,
          subject(`Cliente ${row.nombre_completo}`, {
            detail: row.numero_documento,
          }),
        );
    });
    load('usuarios', async () => {
      const rows = await tx.usuarios.findMany({
        where: idIn('usuarios'),
        select: {
          id: true,
          correo: true,
          personal: { select: { nombre_completo: true } },
        },
      });
      for (const row of rows)
        put(
          'usuarios',
          row.id,
          subject(`Usuario ${row.personal?.nombre_completo ?? row.correo}`, {
            detail: row.personal ? row.correo : null,
          }),
        );
    });
    load('roles', async () => {
      const rows = await tx.role.findMany({
        where: idIn('roles'),
        select: { id: true, nombre: true },
      });
      for (const row of rows)
        put('roles', row.id, subject(`Rol ${row.nombre}`));
    });
    load('unidades_vehiculos', async () => {
      const rows = await tx.unidades_vehiculos.findMany({
        where: { ...idIn('unidades_vehiculos'), ...branch },
        select: {
          id: true,
          vin_mostrado: true,
          versiones_vehiculos: { select: { nombre: true } },
        },
      });
      for (const row of rows)
        put(
          'unidades_vehiculos',
          row.id,
          subject(`Unidad ${row.vin_mostrado}`, {
            detail: row.versiones_vehiculos.nombre,
          }),
        );
    });
    load('proveedores', async () => {
      const rows = await tx.proveedores.findMany({
        where: idIn('proveedores'),
        select: { id: true, razon_social: true },
      });
      for (const row of rows)
        put('proveedores', row.id, subject(`Proveedor ${row.razon_social}`));
    });
    load('planes_credito', async () => {
      const rows = await tx.planes_credito.findMany({
        where: idIn('planes_credito'),
        select: { id: true, nombre: true },
      });
      for (const row of rows)
        put('planes_credito', row.id, subject(`Plan ${row.nombre}`));
    });

    await Promise.all(tasks);
    return result;
  }
}

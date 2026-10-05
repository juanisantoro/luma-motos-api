import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import { AuditQueryService } from './audit-query.service';
import { auditActionInfo, auditActionsOfCategory } from './audit.catalog';

const ORG = '11111111-1111-4111-8111-111111111111';
const OPERATION = '22222222-2222-4222-8222-222222222222';
const INCOME = '33333333-3333-4333-8333-333333333333';
const BRANCH = '44444444-4444-4444-8444-444444444444';

function actor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-id',
    email: 'admin@luma.test',
    name: 'Admin',
    active: true,
    globalAccess: false,
    organization: { id: ORG, code: 'LUMA', name: 'Luma', type: 'FRANQUICIA' },
    role: {
      id: 'role-id',
      code: 'ADMINISTRADOR',
      name: 'Administrador',
      system: true,
      permissions: ['auditoria.consultar', 'compras.costos.consultar'],
    },
    branch: null,
    branchScope: { allBranches: true, branches: [] },
    ...overrides,
  };
}

function logRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    accion: 'INCOME_CASH_HANDOVER_CONFIRMED',
    entidad: 'ingresos',
    entidad_id: INCOME,
    datos_anteriores: null,
    datos_nuevos: null,
    direccion_ip: '10.0.0.1',
    creado_en: new Date('2026-10-04T15:30:12.000Z'),
    organizacion_id: ORG,
    organizacion_objetivo_id: null,
    organizaciones: { codigo: 'LUMA', nombre: 'Luma', tipo: 'FRANQUICIA' },
    organizacion_objetivo: null,
    usuarios: {
      id: 'user-2',
      correo: 'caja@luma.test',
      personal: { nombre_completo: 'Carla Caja' },
      roles: { nombre: 'Administrativa' },
      sucursales: { id: BRANCH, codigo: 'SM', nombre: 'San Miguel' },
    },
    ...overrides,
  };
}

function movement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mov-1',
    creado_en: new Date('2026-10-04T15:30:12.000Z'),
    contabilizado_en: new Date('2026-10-04T03:00:00.000Z'),
    tipo_movimiento: 'INGRESO',
    direccion: 'CREDITO',
    importe: new Prisma.Decimal('150000.5'),
    referencia: null,
    notas: null,
    revierte_a_id: null,
    compra_proveedor_id: null,
    cuentas_caja: {
      id: 'acc-1',
      codigo: 'EFECTIVO_SM',
      nombre: 'Efectivo San Miguel',
      tipo_cuenta: 'EFECTIVO',
      moneda: 'ARS',
      sucursales: { id: BRANCH, codigo: 'SM', nombre: 'San Miguel' },
    },
    personal: { id: 'p-1', nombre_completo: 'Vera Vendedora' },
    other_movimientos_caja: null,
    movimientos_caja: null,
    ingresos_movimientos_caja_ingreso: {
      id: INCOME,
      tipo_original: 'SEÑA',
      descripcion: 'Seña Honda Wave',
      medio_pago: 'EFECTIVO',
      estado_rendicion: 'RENDIDO',
      rendicion_confirmada_en: new Date('2026-10-04T18:00:00.000Z'),
      rendido_a: { id: 'p-2', nombre_completo: 'Carla Caja' },
      rendicion_confirmada_por: { id: 'p-2', nombre_completo: 'Carla Caja' },
      clientes: { nombre_completo: 'Juan Pérez' },
      operaciones: {
        id: OPERATION,
        numero_operacion: 120n,
        clientes: { nombre_completo: 'Juan Pérez' },
      },
    },
    gastos: null,
    compras_proveedor: null,
    liquidaciones_comisiones: null,
    transferencias_caja_movimientos_caja_transferencia_idTotransferencias_caja:
      null,
    ...overrides,
  };
}

interface FindArgs {
  where: Record<string, unknown> & { AND: unknown[] };
  skip?: number;
  orderBy?: unknown;
}

function firstArg(mock: jest.Mock): FindArgs {
  const calls = mock.mock.calls as FindArgs[][];
  return calls[0][0];
}

describe('AuditQueryService', () => {
  const tx = {
    registros_auditoria: { count: jest.fn(), findMany: jest.fn() },
    operaciones: { findFirst: jest.fn(), findMany: jest.fn() },
    ingresos: { findMany: jest.fn() },
    gastos: { findMany: jest.fn() },
    pagos_vehiculo: { findMany: jest.fn() },
    operacion_creditos: { findMany: jest.fn() },
    cuotas_credito: { findMany: jest.fn() },
    movimientos_caja: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    personal: { findMany: jest.fn() },
    cuentas_caja: { findMany: jest.fn() },
  };
  const withTenant = jest.fn(
    (_scope: unknown, operation: (client: typeof tx) => unknown) =>
      Promise.resolve(operation(tx)),
  );
  let service: AuditQueryService;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const model of Object.values(tx))
      for (const mock of Object.values(model)) mock.mockResolvedValue([]);
    tx.registros_auditoria.count.mockResolvedValue(0);
    tx.movimientos_caja.count.mockResolvedValue(0);
    tx.operaciones.findFirst.mockResolvedValue(null);
    service = new AuditQueryService({
      withTenant,
    } as unknown as PrismaService);
  });

  it('names every catalogued action and falls back to the code', () => {
    expect(auditActionInfo('INCOME_CASH_HANDOVER_CONFIRMED')).toEqual({
      category: 'DINERO',
      label: 'Rendición de efectivo confirmada',
    });
    expect(auditActionInfo('SOMETHING_NEW')).toEqual({
      category: 'OTROS',
      label: 'SOMETHING_NEW',
    });
  });

  it('restricts the log to the caller organization and applies filters', async () => {
    await service.findLogs(
      {
        page: 2,
        limit: 50,
        category: 'DINERO',
        actorId: 'user-2',
        from: '2026-10-01T03:00:00.000Z',
        to: '2026-10-05T02:59:59.999Z',
      },
      actor(),
    );

    const args = firstArg(tx.registros_auditoria.findMany);
    expect(args.skip).toBe(50);
    expect(args.orderBy).toEqual([{ creado_en: 'desc' }, { id: 'desc' }]);
    expect(args.where.usuario_id).toBe('user-2');
    expect(args.where.creado_en).toEqual({
      gte: new Date('2026-10-01T03:00:00.000Z'),
      lte: new Date('2026-10-05T02:59:59.999Z'),
    });
    expect(args.where.AND).toEqual([
      {
        OR: [{ organizacion_id: ORG }, { organizacion_objetivo_id: ORG }],
      },
      { accion: { in: auditActionsOfCategory('DINERO') } },
    ]);
    expect(withTenant.mock.calls[0][0]).toEqual({
      organizationId: ORG,
      globalAccess: false,
    });
  });

  it('describes each event: label, who, when, ip and the record it touched', async () => {
    tx.registros_auditoria.count.mockResolvedValue(1);
    tx.registros_auditoria.findMany.mockResolvedValue([logRecord()]);
    tx.ingresos.findMany.mockResolvedValue([
      {
        id: INCOME,
        tipo_original: 'SEÑA',
        descripcion: 'Seña Honda Wave',
        importe: new Prisma.Decimal('150000.5'),
        clientes: { nombre_completo: 'Juan Pérez' },
        rendido_a: { nombre_completo: 'Carla Caja' },
        operaciones: { id: OPERATION, numero_operacion: 120n },
      },
    ]);

    const page = await service.findLogs({ page: 1, limit: 50 }, actor());

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      action: 'INCOME_CASH_HANDOVER_CONFIRMED',
      actionLabel: 'Rendición de efectivo confirmada',
      category: 'DINERO',
      categoryLabel: 'Dinero y caja',
      createdAt: new Date('2026-10-04T15:30:12.000Z'),
      ipAddress: '10.0.0.1',
      restricted: false,
      actor: {
        id: 'user-2',
        email: 'caja@luma.test',
        name: 'Carla Caja',
        role: 'Administrativa',
      },
      branch: { name: 'San Miguel' },
      subject: {
        title: 'Ingreso: SEÑA',
        detail: 'Seña Honda Wave · Juan Pérez · rinde a Carla Caja',
        amount: '150000.5',
        operationId: OPERATION,
        operationNumber: '120',
      },
    });
  });

  it('hides the detail of records from other branches to a branch-scoped user', async () => {
    const scoped = actor({
      branchScope: {
        allBranches: false,
        branches: [{ id: BRANCH, code: 'SM', name: 'San Miguel' }],
      },
    });
    tx.registros_auditoria.count.mockResolvedValue(2);
    tx.registros_auditoria.findMany.mockResolvedValue([
      logRecord({
        accion: 'INCOME_UPDATED',
        datos_nuevos: { amount: '900000', client: 'Otro Cliente' },
        datos_anteriores: { amount: '100' },
      }),
      logRecord({
        id: 'log-2',
        accion: 'CLIENT_UPDATED',
        entidad: 'clientes',
        entidad_id: null,
        datos_nuevos: { active: true },
      }),
    ]);
    // El ingreso es de otra sucursal: la consulta acotada no lo devuelve.
    tx.ingresos.findMany.mockResolvedValue([]);

    const page = await service.findLogs({ page: 1, limit: 50 }, scoped);

    expect(firstArg(tx.ingresos.findMany).where).toMatchObject({
      sucursal_id: { in: [BRANCH] },
    });
    expect(page.items[0]).toMatchObject({
      actionLabel: 'Ingreso modificado',
      actor: { name: 'Carla Caja' },
      restricted: true,
      subject: null,
      metadata: null,
      previousData: null,
    });
    expect(page.items[1]).toMatchObject({
      restricted: false,
      metadata: { active: true },
    });
  });

  it('returns an empty page when the operation number is not visible', async () => {
    const page = await service.findLogs(
      { page: 1, limit: 50, operationNumber: 999 },
      actor(),
    );

    expect(page).toEqual({ items: [], total: 0, page: 1, limit: 50 });
    expect(firstArg(tx.operaciones.findFirst).where).toMatchObject({
      numero_operacion: 999n,
      organizacion_id: ORG,
    });
    expect(tx.registros_auditoria.findMany).not.toHaveBeenCalled();
  });

  it('follows an operation through its incomes, expenses and installments', async () => {
    tx.operaciones.findFirst.mockResolvedValue({ id: OPERATION });
    tx.ingresos.findMany.mockResolvedValue([{ id: INCOME }]);
    tx.operacion_creditos.findMany.mockResolvedValue([{ id: 'credit-1' }]);
    tx.cuotas_credito.findMany.mockResolvedValue([{ id: 'quota-1' }]);

    await service.findLogs(
      { page: 1, limit: 50, operationNumber: 120 },
      actor(),
    );

    const where = firstArg(tx.registros_auditoria.findMany).where;
    expect(where.AND[1]).toEqual({
      OR: [
        { entidad: 'operaciones', entidad_id: OPERATION },
        { entidad: 'ingresos', entidad_id: { in: [INCOME] } },
        { entidad: 'operacion_creditos', entidad_id: { in: ['credit-1'] } },
        { entidad: 'cuotas_credito', entidad_id: { in: ['quota-1'] } },
      ],
    });
  });

  it('answers 404 for an operation outside the branch scope', async () => {
    const scoped = actor({
      branchScope: {
        allBranches: false,
        branches: [{ id: BRANCH, code: 'SM', name: 'San Miguel' }],
      },
    });

    await expect(service.operationTrace(OPERATION, scoped)).rejects.toThrow(
      NotFoundException,
    );
    expect(firstArg(tx.operaciones.findFirst).where).toMatchObject({
      id: OPERATION,
      organizacion_id: ORG,
      sucursal_id: { in: [BRANCH] },
    });
  });

  it('traces an operation with who requested and who decided the approval', async () => {
    tx.operaciones.findFirst.mockResolvedValue({
      id: OPERATION,
      numero_operacion: 120n,
      numero_boleto: 'B-77',
      fecha_operacion: new Date('2026-10-01T03:00:00.000Z'),
      estado_operacion: 'APROBADA',
      estado_entrega: 'PENDIENTE',
      entregado_en: null,
      precio_lista: new Prisma.Decimal('2000000'),
      precio_minimo: new Prisma.Decimal('1900000'),
      precio_acordado: new Prisma.Decimal('1850000'),
      creado_en: new Date('2026-10-01T14:00:00.000Z'),
      actualizado_en: new Date('2026-10-02T14:00:00.000Z'),
      clientes: { nombre_completo: 'Juan Pérez' },
      sucursales: { id: BRANCH, codigo: 'SM', nombre: 'San Miguel' },
      personal: { id: 'p-1', nombre_completo: 'Vera Vendedora' },
      versiones_vehiculos: { nombre: 'Wave 110' },
      unidades_vehiculos: null,
      aprobaciones_operacion: [
        {
          id: 'approval-1',
          decision: 'APROBADA',
          solicitado_en: new Date('2026-10-01T14:05:00.000Z'),
          decidido_en: new Date('2026-10-01T16:20:00.000Z'),
          precio_lista_referencia: new Prisma.Decimal('2000000'),
          precio_minimo_referencia: new Prisma.Decimal('1900000'),
          precio_acordado_referencia: new Prisma.Decimal('1850000'),
          motivo: 'Cliente frecuente',
          personal_aprobaciones_operacion_solicitado_por_personal_idTopersonal:
            { id: 'p-1', nombre_completo: 'Vera Vendedora' },
          personal_aprobaciones_operacion_decidido_por_personal_idTopersonal: {
            id: 'p-9',
            nombre_completo: 'Gerardo Gerente',
          },
        },
      ],
    });
    tx.registros_auditoria.count.mockResolvedValue(1);
    tx.registros_auditoria.findMany.mockResolvedValue([
      logRecord({
        accion: 'SALES_OPERATION_APPROVED',
        entidad: 'operaciones',
        entidad_id: OPERATION,
      }),
    ]);
    tx.movimientos_caja.findMany.mockResolvedValue([movement()]);

    const trace = await service.operationTrace(OPERATION, actor());

    expect(trace.operation).toMatchObject({
      number: '120',
      ticketNumber: 'B-77',
      client: 'Juan Pérez',
      agreedPrice: '1850000',
      createdBy: { fullName: 'Vera Vendedora' },
    });
    expect(trace.approvals[0]).toMatchObject({
      decision: 'APROBADA',
      requestedBy: { fullName: 'Vera Vendedora' },
      requestedAt: new Date('2026-10-01T14:05:00.000Z'),
      decidedBy: { fullName: 'Gerardo Gerente' },
      decidedAt: new Date('2026-10-01T16:20:00.000Z'),
      agreedPrice: '1850000',
      reason: 'Cliente frecuente',
    });
    expect(trace.events[0].actionLabel).toBe('Venta aprobada');
    expect(trace.eventsTotal).toBe(1);
    expect(firstArg(tx.registros_auditoria.findMany).orderBy).toEqual([
      { creado_en: 'asc' },
      { id: 'asc' },
    ]);
    expect(trace.movements).toHaveLength(1);
  });

  it('lists money movements with who registered, the handover and totals', async () => {
    tx.movimientos_caja.count.mockResolvedValue(1);
    tx.movimientos_caja.findMany.mockResolvedValue([movement()]);
    tx.movimientos_caja.groupBy.mockResolvedValueOnce([
      {
        cuenta_caja_id: 'acc-1',
        direccion: 'CREDITO',
        _sum: { importe: new Prisma.Decimal('150000.5') },
      },
      {
        cuenta_caja_id: 'acc-usd',
        direccion: 'CREDITO',
        _sum: { importe: new Prisma.Decimal('800') },
      },
      {
        cuenta_caja_id: 'acc-usd',
        direccion: 'DEBITO',
        _sum: { importe: new Prisma.Decimal('50') },
      },
    ]);
    // Efectivo cobrado y todavía sin confirmar por quien lo recibe.
    tx.movimientos_caja.groupBy.mockResolvedValueOnce([
      {
        cuenta_caja_id: 'acc-1',
        _sum: { importe: new Prisma.Decimal('20000') },
      },
    ]);
    tx.cuentas_caja.findMany.mockResolvedValue([
      {
        id: 'acc-usd',
        nombre: 'Caja Lucas dólares',
        tipo_cuenta: 'SOCIO',
        moneda: 'USD',
        sucursales: { id: BRANCH, codigo: 'SM', nombre: 'San Miguel' },
      },
      {
        id: 'acc-1',
        nombre: 'Caja Lucas',
        tipo_cuenta: 'SOCIO',
        moneda: 'ARS',
        sucursales: { id: BRANCH, codigo: 'SM', nombre: 'San Miguel' },
      },
    ]);

    const page = await service.moneyMovements({ page: 1, limit: 50 }, actor());

    // Pesos y dólares no se mezclan en un mismo total.
    expect(page.totals).toEqual([
      { currency: 'ARS', credit: '150000.5', debit: '0' },
      { currency: 'USD', credit: '800', debit: '50' },
    ]);
    // Una fila por caja, con su sucursal, para el cierre.
    expect(page.summary).toEqual([
      {
        account: { id: 'acc-1', name: 'Caja Lucas', type: 'SOCIO' },
        branch: { id: BRANCH, code: 'SM', name: 'San Miguel' },
        currency: 'ARS',
        credit: '150000.5',
        debit: '0',
        pendingHandover: '20000',
      },
      {
        account: { id: 'acc-usd', name: 'Caja Lucas dólares', type: 'SOCIO' },
        branch: { id: BRANCH, code: 'SM', name: 'San Miguel' },
        currency: 'USD',
        credit: '800',
        debit: '50',
        pendingHandover: '0',
      },
    ]);
    expect(page.items[0]).toMatchObject({
      createdAt: new Date('2026-10-04T15:30:12.000Z'),
      amount: '150000.5',
      direction: 'CREDITO',
      account: { name: 'Efectivo San Miguel', currency: 'ARS' },
      registeredBy: { fullName: 'Vera Vendedora' },
      source: { kind: 'INCOME', title: 'SEÑA · Seña Honda Wave' },
      operation: { id: OPERATION, number: '120', client: 'Juan Pérez' },
      paymentMethod: 'EFECTIVO',
      handover: {
        to: { fullName: 'Carla Caja' },
        status: 'RENDIDO',
        confirmedAt: new Date('2026-10-04T18:00:00.000Z'),
        confirmedBy: { fullName: 'Carla Caja' },
      },
      reversal: null,
    });
    const where = firstArg(tx.movimientos_caja.findMany).where;
    expect(where.organizacion_id).toBe(ORG);
    expect(where.cuentas_caja).toEqual({ AND: [{}, {}] });
  });

  it('scopes money movements to the branches of the user and hides purchase amounts', async () => {
    const scoped = actor({
      role: {
        id: 'role-id',
        code: 'GERENTE',
        name: 'Gerente',
        system: true,
        permissions: ['auditoria.consultar'],
      },
      branchScope: {
        allBranches: false,
        branches: [{ id: BRANCH, code: 'SM', name: 'San Miguel' }],
      },
    });
    tx.movimientos_caja.count.mockResolvedValue(1);
    tx.movimientos_caja.findMany.mockResolvedValue([
      movement({
        tipo_movimiento: 'EGRESO',
        direccion: 'DEBITO',
        compra_proveedor_id: 'purchase-1',
        ingresos_movimientos_caja_ingreso: null,
        compras_proveedor: {
          id: 'purchase-1',
          numero_documento: 'FC-1',
          proveedores: { razon_social: 'Honda' },
        },
        other_movimientos_caja: {
          id: 'mov-2',
          creado_en: new Date('2026-10-04T19:00:00.000Z'),
          notas: 'Cargado dos veces',
          personal: { id: 'p-9', nombre_completo: 'Gerardo Gerente' },
        },
      }),
    ]);

    const page = await service.moneyMovements(
      { page: 1, limit: 50, branchId: BRANCH },
      scoped,
    );

    // Alcance del usuario y, además, la sucursal pedida en el filtro.
    expect(firstArg(tx.movimientos_caja.findMany).where.cuentas_caja).toEqual({
      AND: [
        { OR: [{ sucursal_id: null }, { sucursal_id: { in: [BRANCH] } }] },
        { sucursal_id: BRANCH },
      ],
    });
    expect(tx.movimientos_caja.groupBy).not.toHaveBeenCalled();
    expect(page.totals).toBeNull();
    expect(page.items[0]).toMatchObject({
      amount: null,
      source: { kind: 'PURCHASE', title: 'Compra a Honda · FC-1' },
      reversal: {
        at: new Date('2026-10-04T19:00:00.000Z'),
        by: { fullName: 'Gerardo Gerente' },
        notes: 'Cargado dos veces',
      },
    });
  });
});

import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CashService } from '../cash/cash.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ServiceOrdersService } from './service-orders.service';

const ORG = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
const SM = '0b7a4d7e-3f7e-4a67-b0a5-0d8c1f6a5a04';
const DV = '0b7a4d7e-3f7e-4a67-b0a5-0d8c1f6a5a05';
const ORDER = '7d5cc401-544e-4651-9bd6-52495887fecd';
const TYPE = '0b7a4d7e-3f7e-4a67-b0a5-0d8c1f6a5a06';
const ACCOUNT = '0b7a4d7e-3f7e-4a67-b0a5-0d8c1f6a5a03';
const KEY = '0b7a4d7e-3f7e-4a67-b0a5-0d8c1f6a5a07';
const ROSA = 'personal-rosa';
const MECHANIC = 'personal-mecanico';

function actor(
  code: string,
  permissions: string[],
  branches = [{ id: SM, code: 'SM', name: 'San Miguel' }],
): AuthenticatedUser {
  return {
    id: `user-${code}`,
    email: `${code}@luma.test`,
    name: code,
    active: true,
    globalAccess: false,
    organization: { id: ORG, code: 'LUMA', name: 'Luma', type: 'CASA_CENTRAL' },
    role: { id: 'role', code, name: code, system: true, permissions },
    branch: branches[0] ?? null,
    branchScope: { allBranches: false, branches },
  };
}

const rosa = actor('ADMINISTRATIVA', [
  'service.consultar',
  'service.gestionar',
  'service.cobrar',
]);
const mechanic = actor('MECANICO', ['service.consultar', 'service.trabajar']);

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER,
    organizacion_id: ORG,
    sucursal_id: SM,
    numero: 7,
    estado: 'RECIBIDA',
    fecha_recepcion: new Date('2026-10-12T00:00:00.000Z'),
    cliente_id: null,
    cliente_nombre: 'Marta Gómez',
    cliente_telefono: '1155550000',
    cliente_correo: null,
    cliente_documento: null,
    cliente_direccion: null,
    cliente_localidad: null,
    unidad_vehiculo_id: null,
    moto_dominio: 'A123BCD',
    moto_chasis: null,
    moto_motor: null,
    moto_modelo: 'Gilera Smash',
    moto_anio: null,
    km_actual: 1050,
    km_proximo_service: null,
    tipo_service_id: TYPE,
    tipo_service_nombre: '1º service',
    observaciones_recepcion: null,
    tareas: [
      {
        descripcion: 'Cambio de aceite de motor',
        realizada: null,
        observacion: null,
      },
      { descripcion: 'Revisión de bujía', realizada: null, observacion: null },
    ],
    aceite: {},
    repuestos: [],
    diagnostico: null,
    mecanico_personal_id: null,
    terminada_en: null,
    importe: null,
    ingreso_id: null,
    entregada_en: null,
    entregada_por_personal_id: null,
    estado_entrega: null,
    observaciones_entrega: null,
    cancelada_motivo: null,
    cancelada_en: null,
    version_fila: 3,
    creado_por_personal_id: ROSA,
    creado_en: new Date('2026-10-12T13:00:00.000Z'),
    actualizado_en: new Date('2026-10-12T13:00:00.000Z'),
    ...overrides,
  };
}

function errorCode(error: unknown) {
  expect(error).toBeInstanceOf(HttpException);
  return ((error as HttpException).getResponse() as { code?: string }).code;
}

describe('ServiceOrdersService', () => {
  let stored: ReturnType<typeof order>;
  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    ordenes_service: {
      aggregate: jest.fn(),
      create: jest.fn<Promise<unknown>, [{ data: Record<string, unknown> }]>(),
      findFirst: jest.fn(),
      findMany: jest.fn<
        Promise<unknown>,
        [{ where: Record<string, unknown>; orderBy?: unknown }]
      >(),
      count: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    tipos_service: { findFirst: jest.fn() },
    tipos_ingreso: { findFirst: jest.fn() },
    clientes: { findFirst: jest.fn() },
    ingresos: {
      create: jest.fn<Promise<unknown>, [{ data: Record<string, unknown> }]>(),
      update: jest.fn<Promise<unknown>, [{ data: Record<string, unknown> }]>(),
    },
    movimientos_caja: { findFirst: jest.fn() },
    personal: { findMany: jest.fn(), findFirst: jest.fn() },
    sucursales: { findMany: jest.fn() },
  };
  const audit = {
    execute: jest.fn((_event: unknown, work: (client: typeof tx) => unknown) =>
      work(tx),
    ),
  };
  const cash = {
    actorPersonnelId: jest.fn(),
    registerEntityMovement: jest.fn(),
    settledAmount: jest.fn(),
  };
  const prisma = {
    withTenant: jest.fn(
      (_scope: unknown, work: (client: typeof tx) => unknown) => work(tx),
    ),
  };
  let service: ServiceOrdersService;

  beforeEach(() => {
    jest.clearAllMocks();
    stored = order();
    tx.ordenes_service.findFirst.mockImplementation(() =>
      Promise.resolve(stored),
    );
    tx.ordenes_service.updateMany.mockImplementation(
      (args: {
        where: { version_fila: number };
        data: Record<string, unknown>;
      }) => {
        if (args.where.version_fila !== stored.version_fila)
          return Promise.resolve({ count: 0 });
        const data = { ...args.data };
        delete data.version_fila;
        stored = { ...stored, ...data, version_fila: stored.version_fila + 1 };
        return Promise.resolve({ count: 1 });
      },
    );
    tx.ordenes_service.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve(stored),
    );
    tx.personal.findMany.mockResolvedValue([
      { id: ROSA, nombre_completo: 'Rosa Vargas' },
      { id: MECHANIC, nombre_completo: 'Pedro Mecánico' },
    ]);
    tx.sucursales.findMany.mockResolvedValue([
      { id: SM, codigo: 'SM', nombre: 'San Miguel' },
    ]);
    cash.actorPersonnelId.mockResolvedValue(ROSA);
    service = new ServiceOrdersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      cash as unknown as CashService,
    );
  });

  it('numbers a new order after the last one and copies the checklist of its service type', async () => {
    tx.tipos_service.findFirst.mockResolvedValue({
      id: TYPE,
      nombre: '1º service',
      tareas: ['Cambio de aceite de motor', 'Revisión de bujía'],
    });
    tx.ordenes_service.aggregate.mockResolvedValue({ _max: { numero: 6 } });
    tx.ordenes_service.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve(order({ ...args.data, id: ORDER })),
    );

    const created = await service.create(
      {
        clientName: 'Marta Gómez',
        plate: 'a123bcd',
        currentKm: 1050,
        serviceTypeId: TYPE,
      },
      rosa,
    );

    // El número se toma bajo un bloqueo, para que dos altas no lo repitan.
    expect(tx.$executeRaw).toHaveBeenCalled();
    const data = tx.ordenes_service.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      numero: 7,
      sucursal_id: SM,
      moto_dominio: 'A123BCD',
      tipo_service_nombre: '1º service',
      creado_por_personal_id: ROSA,
    });
    expect(data.tareas).toEqual([
      {
        descripcion: 'Cambio de aceite de motor',
        realizada: null,
        observacion: null,
      },
      { descripcion: 'Revisión de bujía', realizada: null, observacion: null },
    ]);
    expect(created.receivedBy).toEqual({ id: ROSA, fullName: 'Rosa Vargas' });
  });

  it('asks for the plate or the chassis', async () => {
    const error: unknown = await service
      .create(
        { clientName: 'Marta', currentKm: 10, serviceTypeOther: 'frenos' },
        rosa,
      )
      .catch((reason: unknown) => reason);
    expect(errorCode(error)).toBe('VEHICLE_REQUIRED');
  });

  it('does not let the mechanic sign while a task is not marked yes or no', async () => {
    cash.actorPersonnelId.mockResolvedValue(MECHANIC);
    const error: unknown = await service
      .finish(
        ORDER,
        {
          expectedVersion: 3,
          tasks: [
            { description: 'Cambio de aceite de motor', done: true },
            { description: 'Revisión de bujía' },
          ],
        },
        mechanic,
      )
      .catch((reason: unknown) => reason);
    expect(errorCode(error)).toBe('SERVICE_TASKS_PENDING');
    expect(tx.ordenes_service.updateMany).not.toHaveBeenCalled();
  });

  it('signs the order with the mechanic and keeps oil, parts and next service', async () => {
    cash.actorPersonnelId.mockResolvedValue(MECHANIC);

    const signed = await service.finish(
      ORDER,
      {
        expectedVersion: 3,
        tasks: [
          { description: 'Cambio de aceite de motor', done: true },
          {
            description: 'Revisión de bujía',
            done: false,
            notes: 'En buen estado',
          },
        ],
        oil: { type: 'Motul', viscosity: '10W40', liters: 1, filter: true },
        parts: [
          {
            code: 'FA-1',
            description: 'Filtro de aceite',
            quantity: 1,
            unitPrice: '8500',
          },
        ],
        nextServiceKm: 4000,
      },
      mechanic,
    );

    expect(signed).toMatchObject({
      status: 'TERMINADA',
      signedBy: { id: MECHANIC, fullName: 'Pedro Mecánico' },
      nextServiceKm: 4000,
      oil: { viscosity: '10W40', filter: true },
      parts: [{ description: 'Filtro de aceite', unitPrice: '8500' }],
      tasks: [
        { description: 'Cambio de aceite de motor', done: true, notes: null },
        {
          description: 'Revisión de bujía',
          done: false,
          notes: 'En buen estado',
        },
      ],
    });
  });

  it('rejects a change made on an old version', async () => {
    const error: unknown = await service
      .saveWork(ORDER, { expectedVersion: 2, tasks: [] }, mechanic)
      .catch((reason: unknown) => reason);
    expect(errorCode(error)).toBe('STALE_VERSION');
  });

  it('hides orders of other branches', async () => {
    stored = order({ sucursal_id: DV });
    const error: unknown = await service
      .findOne(ORDER, mechanic)
      .catch((reason: unknown) => reason);
    expect(errorCode(error)).toBe('SERVICE_ORDER_NOT_FOUND');
  });

  it('gives the mechanic the queue of his branch, oldest first', async () => {
    tx.ordenes_service.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3);
    tx.ordenes_service.findMany.mockResolvedValue([stored]);

    const home = await service.workshop(mechanic);

    expect(home).toMatchObject({ waiting: 2, inProgress: 1, finishedToday: 3 });
    expect(home.orders.map((item) => item.number)).toEqual([7]);
    const query = tx.ordenes_service.findMany.mock.calls[0]?.[0];
    expect(query?.where).toMatchObject({
      organizacion_id: ORG,
      sucursal_id: { in: [SM] },
      estado: { in: ['RECIBIDA', 'EN_TALLER'] },
    });
    expect(query?.orderBy).toEqual([{ numero: 'asc' }]);
  });

  describe('delivery', () => {
    beforeEach(() => {
      stored = order({
        estado: 'TERMINADA',
        mecanico_personal_id: MECHANIC,
        terminada_en: new Date('2026-10-12T15:00:00.000Z'),
      });
      tx.movimientos_caja.findFirst.mockResolvedValue(null);
      tx.tipos_ingreso.findFirst.mockResolvedValue({ nombre: 'Service' });
      tx.ingresos.create.mockResolvedValue({ id: 'income-1' });
      cash.settledAmount.mockResolvedValue(new Prisma.Decimal(45000));
    });

    const input = {
      expectedVersion: 3,
      idempotencyKey: KEY,
      amount: '45000',
      accountId: ACCOUNT,
      paymentMethod: 'TRANSFERENCIA_BANCARIA' as const,
      vehicleCondition: 'BUENO' as const,
    };

    it('collects the service as a "Service" income in the chosen cash account', async () => {
      const delivered = await service.deliver(ORDER, input, rosa);

      const income = tx.ingresos.create.mock.calls[0][0].data;
      expect(income).toMatchObject({
        sucursal_id: SM,
        tipo_original: 'Service',
        importe: new Prisma.Decimal(45000),
        moneda: 'ARS',
        tipo_vehiculo: 'MOTO',
        medio_pago: 'TRANSFERENCIA_BANCARIA',
      });
      expect(cash.registerEntityMovement).toHaveBeenCalledWith(
        tx,
        rosa,
        ORG,
        'ARS',
        expect.objectContaining({
          accountId: ACCOUNT,
          amount: '45000.00',
          idempotencyKey: KEY,
        }),
        { ingreso_id: 'income-1' },
        'INGRESO',
        'CREDITO',
      );
      expect(tx.ingresos.update.mock.calls[0][0].data).toEqual({
        estado_registro: 'PAGADO',
      });
      expect(delivered).toMatchObject({
        status: 'ENTREGADA',
        delivery: {
          amount: '45000.00',
          incomeId: 'income-1',
          vehicleCondition: 'BUENO',
        },
      });
    });

    it('delivers without an income when nothing is charged', async () => {
      const delivered = await service.deliver(
        ORDER,
        {
          expectedVersion: 3,
          idempotencyKey: KEY,
          amount: '0',
          vehicleCondition: 'OPTIMO',
        },
        rosa,
      );
      expect(tx.ingresos.create).not.toHaveBeenCalled();
      expect(delivered.delivery).toMatchObject({
        amount: '0.00',
        incomeId: null,
      });
    });

    it('does not charge twice when the same request is repeated', async () => {
      await service.deliver(ORDER, input, rosa);
      tx.movimientos_caja.findFirst.mockResolvedValue({ id: 'movement-1' });

      const repeated = await service.deliver(ORDER, input, rosa);

      expect(tx.ingresos.create).toHaveBeenCalledTimes(1);
      expect(repeated.status).toBe('ENTREGADA');
    });

    it('only delivers an order the mechanic signed', async () => {
      stored = order({ estado: 'EN_TALLER' });
      const error: unknown = await service
        .deliver(ORDER, input, rosa)
        .catch((reason: unknown) => reason);
      expect(errorCode(error)).toBe('SERVICE_ORDER_NOT_FINISHED');
    });

    it('does not show the amount to the mechanic', async () => {
      await service.deliver(ORDER, input, rosa);
      const seen = await service.findOne(ORDER, mechanic);
      expect(seen.delivery).not.toHaveProperty('amount');
      expect(seen.delivery).not.toHaveProperty('incomeId');
    });
  });
});

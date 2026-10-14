import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CashService } from '../cash/cash.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ServiceRemindersService } from './service-reminders.service';

const org = '3b83b9bb-b6b5-4587-b51f-ab77626a55d3';
const sm = '8d34898d-c999-4112-86e7-664cce2bf635';

const actor = {
  id: 'user-1',
  organization: { id: org },
  globalAccess: false,
  role: { permissions: ['sucursales.todas'] },
  branchScope: { allBranches: true, branches: [] },
} as unknown as AuthenticatedUser;

function sold(unit: string, deliveredAt: string) {
  return {
    unit_id: unit,
    operation_id: `op-${unit}`,
    operation_number: BigInt(100),
    branch_id: sm,
    branch_name: 'San Miguel',
    delivered_at: new Date(deliveredAt),
    client_id: 'client-1',
    client_name: 'Ana Pérez',
    client_phone: '11 5555-0000',
    brand: 'Honda',
    model: 'Wave',
    version: 'SIN ESPECIFICAR',
    vin: `VIN-${unit}`,
    plate: null,
  };
}

function setup(
  rows: ReturnType<typeof sold>[],
  orders: Array<{
    unidad_vehiculo_id: string;
    estado: string;
    terminada_en: Date | null;
    fecha_recepcion: Date;
  }> = [],
  resolved: unknown[] = [],
) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue(rows),
    ordenes_service: { findMany: jest.fn().mockResolvedValue(orders) },
    tipos_service: {
      findMany: jest.fn().mockResolvedValue([
        { nombre: '1º service', orden: 1 },
        { nombre: '2º service', orden: 2 },
      ]),
    },
    avisos_service: { findMany: jest.fn().mockResolvedValue(resolved) },
    personal: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'person-1', nombre_completo: 'Rosa' }]),
    },
  };
  const prisma = {
    withTenant: jest.fn(
      (_scope: unknown, work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
    ),
  } as unknown as PrismaService;
  return new ServiceRemindersService(
    prisma,
    {} as AuditService,
    {} as CashService,
  );
}

describe('ServiceRemindersService', () => {
  beforeEach(() =>
    jest.useFakeTimers().setSystemTime(new Date('2026-10-14T12:00:00-03:00')),
  );
  afterEach(() => jest.useRealTimers());

  it('asks for the 1st service 30 days after the delivery, a week ahead', async () => {
    const service = setup([
      // Entregada el 16/09 (hora argentina) → 1º service el 16/10.
      sold('a', '2026-09-16T23:30:00-03:00'),
      // Toca el 31/10: más de una semana, todavía no.
      sold('b', '2026-10-01T10:00:00-03:00'),
      // Vencido hace 32 días: ya no sale.
      sold('c', '2026-08-13T10:00:00-03:00'),
      // Vencido hace 10 días: sale.
      sold('d', '2026-09-04T10:00:00-03:00'),
    ]);

    const { items } = await service.list(actor, {});

    expect(
      items.map((item) => [item.unitId, item.dueDate, item.daysToDue]),
    ).toEqual([
      ['d', '2026-10-04', -10],
      ['a', '2026-10-16', 2],
    ]);
    expect(items[1]).toMatchObject({
      stage: 'PRIMER_SERVICE',
      serviceName: '1º service',
      deliveredAt: '2026-09-16',
      vehicle: { brand: 'Honda', model: 'Wave', version: null },
      resolution: null,
    });
  });

  it('asks for the yearly service a year after the last one, and skips motos in the workshop', async () => {
    const service = setup(
      [
        sold('a', '2025-09-01T10:00:00-03:00'),
        sold('b', '2026-09-14T10:00:00-03:00'),
      ],
      [
        {
          unidad_vehiculo_id: 'a',
          estado: 'ENTREGADA',
          terminada_en: new Date('2025-10-20T12:00:00-03:00'),
          fecha_recepcion: new Date('2025-10-20T00:00:00Z'),
        },
        {
          unidad_vehiculo_id: 'b',
          estado: 'RECIBIDA',
          terminada_en: null,
          fecha_recepcion: new Date('2026-10-13T00:00:00Z'),
        },
      ],
    );

    const { items } = await service.list(actor, {});

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      unitId: 'a',
      stage: 'ANUAL',
      dueDate: '2026-10-20',
      serviceName: '2º service',
      servicesDone: 1,
      lastServiceDate: '2025-10-20',
    });
  });

  it('separates pending reminders from the ones already resolved', async () => {
    const service = setup(
      [sold('a', '2026-09-16T10:00:00-03:00')],
      [],
      [
        {
          unidad_vehiculo_id: 'a',
          etapa: 'PRIMER_SERVICE',
          vence_el: new Date('2026-10-16T00:00:00Z'),
          estado: 'CONTACTADO',
          canal: 'WHATSAPP',
          nota: null,
          registrado_por_personal_id: 'person-1',
          registrado_en: new Date('2026-10-14T15:00:00Z'),
        },
      ],
    );

    expect((await service.list(actor, {})).items).toEqual([]);
    const resolved = await service.list(actor, { status: 'RESOLVED' });
    expect(resolved.items[0]?.resolution).toEqual({
      status: 'CONTACTADO',
      channel: 'WHATSAPP',
      note: null,
      at: '2026-10-14T15:00:00.000Z',
      by: 'Rosa',
    });
  });
});

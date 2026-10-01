import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CashService } from '../cash/cash.service';
import type { PrismaService } from '../prisma/prisma.service';
import { VehiclePaymentsService } from './vehicle-payments.service';

// Fase 5: búsqueda por número de boleto, asignación del pago de patente a la
// operación del boleto y situación de la patente en cada fila.

const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
const operationId = '7d5cc401-544e-4651-9bd6-52495887fecd';
const unitId = 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2';
const conceptId = '0b7a4d7e-3f7e-4a67-b0a5-0d8c1f6a5a01';
const providerId = '0b7a4d7e-3f7e-4a67-b0a5-0d8c1f6a5a02';

const actor: AuthenticatedUser = {
  id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
  email: 'administrativa@luma.test',
  name: 'Administrativa',
  active: true,
  globalAccess: false,
  organization: {
    id: organizationId,
    code: 'LUMA',
    name: 'Luma',
    type: 'CASA_CENTRAL',
  },
  role: {
    id: '4bd1189b-2bb1-4258-889b-4500de5eeade',
    code: 'ADMINISTRATIVA',
    name: 'Administrativa',
    system: true,
    permissions: ['sucursales.todas', 'pagos_vehiculo.gestionar'],
  },
  branch: null,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    fecha: new Date('2026-09-20T00:00:00.000Z'),
    estado: 'PAGADO',
    observaciones: null,
    creado_en: new Date('2026-09-20T12:00:00.000Z'),
    actualizado_en: new Date('2026-09-20T12:00:00.000Z'),
    concepto_id: conceptId,
    concepto_nombre: 'Patente',
    proveedor_id: providerId,
    proveedor_nombre: 'Gestoría',
    importe: new Prisma.Decimal(60000),
    unidad_vehiculo_id: unitId,
    vin_mostrado: 'VIN123',
    patente: null,
    version_id: 'version',
    version_nombre: '110',
    modelo_nombre: 'Wave',
    marca_nombre: 'Honda',
    tipo_vehiculo: 'MOTO',
    operacion_id: operationId,
    numero_operacion: BigInt(42),
    numero_boleto: 'B-0001',
    estado_operacion: 'APROBADA',
    modalidad_patentamiento: 'PAGA_CLIENTE',
    patente_estimada_desde: new Date('2026-09-11T00:00:00.000Z'),
    patente_estimada_hasta: new Date('2026-09-18T00:00:00.000Z'),
    patente_recibida_en: null,
    operacion_patente: null,
    cobro_patente_cubierto: false,
    ...overrides,
  };
}

function sqlText(query: Prisma.Sql) {
  return query.strings.join('?');
}

describe('VehiclePaymentsService (fase 5)', () => {
  function listService(rows: unknown[]) {
    const queryRaw = jest
      .fn<Promise<unknown>, [Prisma.Sql]>()
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([{ count: BigInt(rows.length) }]);
    const prisma = {
      withTenant: jest.fn(
        (
          _scope: unknown,
          work: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) =>
          work({ $queryRaw: queryRaw } as unknown as Prisma.TransactionClient),
      ),
    } as unknown as PrismaService;
    return {
      service: new VehiclePaymentsService(
        prisma,
        {} as AuditService,
        {} as CashService,
      ),
      queryRaw,
    };
  }

  it('searches by ticket number besides VIN, plate, vehicle and operation', async () => {
    const { service, queryRaw } = listService([]);
    await service.findAll(
      { vehicleType: 'MOTO', page: 1, limit: 20, search: 'B-0001' },
      actor,
    );
    const listSql = queryRaw.mock.calls[0][0];
    expect(sqlText(listSql)).toContain('o.numero_boleto ILIKE');
    expect(listSql.values).toContain('%B-0001%');
    expect(sqlText(queryRaw.mock.calls[1][0])).toContain(
      'o.numero_boleto ILIKE',
    );
  });

  it('returns the ticket and the patent situation of the linked operation', async () => {
    const { service } = listService([
      row(),
      row({
        id: 'payment-2',
        patente_recibida_en: new Date('2026-09-25T00:00:00.000Z'),
        operacion_patente: 'A123BCD',
      }),
      row({
        id: 'payment-3',
        patente_recibida_en: new Date('2026-09-25T00:00:00.000Z'),
        operacion_patente: 'A123BCD',
        cobro_patente_cubierto: true,
      }),
      row({
        id: 'payment-4',
        operacion_id: null,
        numero_operacion: null,
        numero_boleto: null,
        estado_operacion: null,
      }),
    ]);
    const page = await service.findAll(
      { vehicleType: 'MOTO', page: 1, limit: 20 },
      actor,
    );
    expect(page.items[0]?.operation).toMatchObject({
      number: '42',
      ticketNumber: 'B-0001',
      licensing: {
        mode: 'PAGA_CLIENTE',
        estimatedTo: '2026-09-18',
        overdue: true,
        plate: { status: 'EN_TRAMITE_VENCIDA', number: null },
      },
    });
    expect(page.items[1]?.operation?.licensing?.plate).toEqual({
      status: 'RECIBIDA_COBRO_PENDIENTE',
      number: 'A123BCD',
      receivedAt: '2026-09-25',
    });
    expect(page.items[2]?.operation?.licensing?.plate.status).toBe(
      'RECIBIDA_COBRADA',
    );
    expect(page.items[3]?.operation).toBeNull();
  });

  describe('create linked to the operation of a ticket', () => {
    function createService(operation: { id: string } | null) {
      const queryRaw = jest
        .fn<Promise<unknown>, [Prisma.Sql]>()
        .mockImplementation((query) => {
          const text = sqlText(query);
          if (text.includes('EXISTS'))
            return Promise.resolve([{ exists: true }]);
          if (text.includes('INSERT INTO pagos_vehiculo'))
            return Promise.resolve([{ id: 'payment-new' }]);
          return Promise.resolve([row({ id: 'payment-new' })]);
        });
      const tx = {
        $queryRaw: queryRaw,
        unidades_vehiculos: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: unitId, sucursal_id: 'branch' }),
        },
        operaciones: { findFirst: jest.fn().mockResolvedValue(operation) },
      } as unknown as Prisma.TransactionClient;
      const audit = {
        execute: jest.fn(
          (
            _event: unknown,
            work: (client: Prisma.TransactionClient) => Promise<unknown>,
          ) => work(tx),
        ),
      } as unknown as AuditService;
      const cash = {
        actorPersonnelId: jest.fn().mockResolvedValue('staff-1'),
      } as unknown as CashService;
      return {
        service: new VehiclePaymentsService({} as PrismaService, audit, cash),
        queryRaw,
      };
    }

    const input = {
      conceptId,
      unitId,
      operationId,
      providerId,
      amount: 60000,
      paymentDate: '2026-09-20',
      status: 'PAGADO' as const,
    };

    it('stores the operation of the ticket with the patent payment', async () => {
      const { service, queryRaw } = createService({ id: operationId });
      const created = await service.create(input, actor);
      const insert = queryRaw.mock.calls
        .map((call) => call[0])
        .find((query) => sqlText(query).includes('INSERT INTO pagos_vehiculo'));
      expect(insert?.values).toEqual(
        expect.arrayContaining([
          organizationId,
          conceptId,
          unitId,
          operationId,
        ]),
      );
      expect(created.operation).toMatchObject({
        id: operationId,
        ticketNumber: 'B-0001',
      });
    });

    it('rejects an operation of another organization', async () => {
      const { service } = createService(null);
      await expect(service.create(input, actor)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

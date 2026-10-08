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
const accountId = '0b7a4d7e-3f7e-4a67-b0a5-0d8c1f6a5a03';
const branchId = '0b7a4d7e-3f7e-4a67-b0a5-0d8c1f6a5a04';
const payerAccount = {
  id: accountId,
  nombre: 'Caja Juan',
  moneda: 'ARS',
  sucursal_id: null,
  responsable_nombre: 'Juan Capdevila',
  responsable: 'Juan Capdevila',
  // Es del usuario que opera: puede pagar y devolver desde ella.
  propia: true,
};

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
    moneda: 'ARS',
    sucursal_id: branchId,
    sucursal_nombre: 'San Miguel',
    cuenta_caja_id: accountId,
    cuenta_nombre: 'Caja Juan',
    cuenta_responsable: 'Juan Capdevila',
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
    function createService(
      operation: { id: string } | null,
      {
        accounts = [payerAccount],
        unitType = 'MOTO',
      }: { accounts?: unknown[]; unitType?: string } = {},
    ) {
      const queryRaw = jest
        .fn<Promise<unknown>, [Prisma.Sql]>()
        .mockImplementation((query) => {
          const text = sqlText(query);
          if (text.includes('EXISTS'))
            return Promise.resolve([{ exists: true }]);
          if (text.includes('INSERT INTO pagos_vehiculo'))
            return Promise.resolve([{ id: 'payment-new' }]);
          if (text.includes('FROM cuentas_caja cc'))
            return Promise.resolve(accounts);
          if (text.includes('FROM conceptos_pago_vehiculo WHERE id'))
            return Promise.resolve([{ nombre: 'Patente' }]);
          return Promise.resolve([row({ id: 'payment-new' })]);
        });
      const movementsCreate = jest
        .fn<Promise<{ id: string }>, [Prisma.movimientos_cajaCreateArgs]>()
        .mockResolvedValue({ id: 'movement-1' });
      const tx = {
        $queryRaw: queryRaw,
        unidades_vehiculos: {
          findFirst: jest.fn().mockResolvedValue({
            id: unitId,
            sucursal_id: branchId,
            versiones_vehiculos: {
              modelos_vehiculos: { tipo_vehiculo: unitType },
            },
          }),
        },
        operaciones: { findFirst: jest.fn().mockResolvedValue(operation) },
        movimientos_caja: { create: movementsCreate },
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
        movementsCreate,
      };
    }

    const input = {
      conceptId,
      vehicleType: 'MOTO' as const,
      accountId,
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

    function insertOf(queryRaw: jest.Mock<Promise<unknown>, [Prisma.Sql]>) {
      return queryRaw.mock.calls
        .map((call) => call[0])
        .find((query) => sqlText(query).includes('INSERT INTO pagos_vehiculo'));
    }

    it('debits the administrator cash account when it is created as paid', async () => {
      const { service, queryRaw, movementsCreate } = createService({
        id: operationId,
      });
      await service.create(input, actor);

      expect(movementsCreate).toHaveBeenCalledTimes(1);
      expect(movementsCreate.mock.calls[0][0].data).toMatchObject({
        cuenta_caja_id: accountId,
        tipo_movimiento: 'AJUSTE',
        direccion: 'DEBITO',
        notas: 'Gasto de motos: Patente',
      });
      expect(
        (
          movementsCreate.mock.calls[0][0].data.importe as Prisma.Decimal
        ).toFixed(2),
      ).toBe('60000.00');
      expect(insertOf(queryRaw)?.values).toEqual(
        expect.arrayContaining([accountId, 'movement-1', 'ARS', branchId]),
      );
    });

    it('does not touch the cash account while the expense is pending', async () => {
      const { service, queryRaw, movementsCreate } = createService({
        id: operationId,
      });
      await service.create({ ...input, status: 'PENDIENTE' }, actor);

      expect(movementsCreate).not.toHaveBeenCalled();
      expect(insertOf(queryRaw)?.values).toContain(accountId);
    });

    it('accepts an expense without unit nor provider in the user branch', async () => {
      const { service, queryRaw } = createService(null);
      await service.create(
        {
          conceptId,
          vehicleType: 'MOTO',
          accountId,
          branchId,
          amount: 15000,
          paymentDate: '2026-10-01',
          notes: 'Lavado de motos',
        },
        actor,
      );

      const values = insertOf(queryRaw)?.values ?? [];
      expect(values).toEqual(
        expect.arrayContaining([branchId, 'MOTO', 'Lavado de motos']),
      );
      expect(
        values.filter((value) => value === null).length,
      ).toBeGreaterThanOrEqual(3);
    });

    it('rejects a unit of the other vehicle type', async () => {
      const { service } = createService(null, { unitType: 'AUTO' });
      await expect(
        service.create({ ...input, operationId: undefined }, actor),
      ).rejects.toThrow('La unidad elegida es un auto');
    });

    it('saves an expense without cash account and does not move money', async () => {
      const { service, queryRaw, movementsCreate } = createService(null);
      await service.create(
        { ...input, operationId: undefined, accountId: undefined },
        actor,
      );
      expect(movementsCreate).not.toHaveBeenCalled();
      expect(insertOf(queryRaw)?.values).toEqual(
        expect.arrayContaining(['PAGADO', 'ARS']),
      );
      expect(
        queryRaw.mock.calls.some(([query]) =>
          sqlText(query).includes('FROM cuentas_caja cc'),
        ),
      ).toBe(false);
    });

    it("rejects paying from someone else's cash account", async () => {
      const { service, movementsCreate } = createService(
        { id: operationId },
        { accounts: [{ ...payerAccount, propia: false }] },
      );
      await expect(service.create(input, actor)).rejects.toThrow(
        'Sólo Juan Capdevila puede pagar desde Caja Juan',
      );
      expect(movementsCreate).not.toHaveBeenCalled();
    });

    it('rejects a cash account that is not an administrator one', async () => {
      const { service, movementsCreate } = createService(
        { id: operationId },
        { accounts: [] },
      );
      await expect(service.create(input, actor)).rejects.toThrow(
        'no es de un administrador',
      );
      expect(movementsCreate).not.toHaveBeenCalled();
    });
  });

  describe('update keeps the cash debit in line with the expense', () => {
    const paid = {
      organizacion_id: organizationId,
      estado: 'PAGADO',
      importe: new Prisma.Decimal(60000),
      fecha: new Date('2026-09-20T00:00:00.000Z'),
      cuenta_caja_id: accountId,
      movimiento_caja_id: 'movement-1',
      moneda: 'ARS',
      tipo_vehiculo: 'MOTO',
      concepto_nombre: 'Patente',
    };

    function updateService(
      state: Record<string, unknown>,
      cashAccount: Record<string, unknown> = payerAccount,
    ) {
      const queryRaw = jest
        .fn<Promise<unknown>, [Prisma.Sql]>()
        .mockImplementation((query) => {
          const text = sqlText(query);
          if (text.includes('FOR UPDATE OF p')) return Promise.resolve([state]);
          if (text.includes('FROM cuentas_caja cc'))
            return Promise.resolve([
              query.values.includes('0b7a4d7e-3f7e-4a67-b0a5-0d8c1f6a5a09')
                ? {
                    ...payerAccount,
                    id: '0b7a4d7e-3f7e-4a67-b0a5-0d8c1f6a5a09',
                    moneda: 'USD',
                  }
                : cashAccount,
            ]);
          return Promise.resolve([row()]);
        });
      const executeRaw = jest
        .fn<Promise<number>, [Prisma.Sql]>()
        .mockResolvedValue(1);
      const movementsCreate = jest
        .fn<Promise<{ id: string }>, [Prisma.movimientos_cajaCreateArgs]>()
        .mockResolvedValueOnce({ id: 'movement-2' })
        .mockResolvedValueOnce({ id: 'movement-3' });
      const tx = {
        $queryRaw: queryRaw,
        $executeRaw: executeRaw,
        movimientos_caja: { create: movementsCreate },
      } as unknown as Prisma.TransactionClient;
      const prisma = {
        withTenant: jest.fn(
          (
            _scope: unknown,
            work: (client: Prisma.TransactionClient) => Promise<unknown>,
          ) => work(tx),
        ),
      } as unknown as PrismaService;
      const audit = { record: jest.fn() } as unknown as AuditService;
      const cash = {
        actorPersonnelId: jest.fn().mockResolvedValue('staff-1'),
      } as unknown as CashService;
      return {
        service: new VehiclePaymentsService(prisma, audit, cash),
        executeRaw,
        movementsCreate,
      };
    }

    function updateValues(
      executeRaw: jest.Mock<Promise<number>, [Prisma.Sql]>,
    ) {
      return executeRaw.mock.calls[0][0].values;
    }

    it('gives the money back to the cash account when it goes back to pending', async () => {
      const { service, executeRaw, movementsCreate } = updateService(paid);
      await service.update('payment-1', { status: 'PENDIENTE' }, actor);

      expect(movementsCreate).toHaveBeenCalledTimes(1);
      expect(movementsCreate.mock.calls[0][0].data).toMatchObject({
        cuenta_caja_id: accountId,
        tipo_movimiento: 'INGRESO',
        direccion: 'CREDITO',
        revierte_a_id: 'movement-1',
      });
      expect(updateValues(executeRaw)).toContain('PENDIENTE');
      expect(updateValues(executeRaw)).not.toContain('movement-1');
    });

    it('replaces the debit when the amount of a paid expense changes', async () => {
      const { service, executeRaw, movementsCreate } = updateService(paid);
      await service.update('payment-1', { amount: 70000 }, actor);

      expect(movementsCreate).toHaveBeenCalledTimes(2);
      expect(movementsCreate.mock.calls[0][0].data.revierte_a_id).toBe(
        'movement-1',
      );
      expect(movementsCreate.mock.calls[1][0].data).toMatchObject({
        tipo_movimiento: 'AJUSTE',
        direccion: 'DEBITO',
      });
      expect(
        (
          movementsCreate.mock.calls[1][0].data.importe as Prisma.Decimal
        ).toFixed(2),
      ).toBe('70000.00');
      expect(updateValues(executeRaw)).toContain('movement-3');
    });

    it('leaves the cash account alone when only the notes change', async () => {
      const { service, executeRaw, movementsCreate } = updateService(paid);
      await service.update('payment-1', { notes: 'Pagado en efectivo' }, actor);

      expect(movementsCreate).not.toHaveBeenCalled();
      expect(updateValues(executeRaw)).toContain('movement-1');
    });

    it('does not debit again an expense that was paid before cash accounts existed', async () => {
      const { service, executeRaw, movementsCreate } = updateService({
        ...paid,
        cuenta_caja_id: null,
        movimiento_caja_id: null,
      });
      await service.update('payment-1', { notes: 'Pagado en 2025' }, actor);
      expect(movementsCreate).not.toHaveBeenCalled();
      expect(updateValues(executeRaw)).toContain('PAGADO');

      await expect(
        service.update('payment-1', { accountId }, actor),
      ).rejects.toThrow('volvelo a pendiente');
      expect(movementsCreate).not.toHaveBeenCalled();
    });

    it('asks for the amount when the new cash account is in another currency', async () => {
      const { service, movementsCreate } = updateService(paid);
      await expect(
        service.update(
          'payment-1',
          { accountId: '0b7a4d7e-3f7e-4a67-b0a5-0d8c1f6a5a09' },
          actor,
        ),
      ).rejects.toThrow('indicá el importe en esa moneda');
      expect(movementsCreate).not.toHaveBeenCalled();
    });

    it('rejects paying with a future date', async () => {
      const { service, movementsCreate } = updateService({
        ...paid,
        estado: 'PENDIENTE',
        movimiento_caja_id: null,
      });
      await expect(
        service.update(
          'payment-1',
          { status: 'PAGADO', paymentDate: '2999-01-01' },
          actor,
        ),
      ).rejects.toThrow('posterior a hoy');
      expect(movementsCreate).not.toHaveBeenCalled();
    });

    it('asks for an amount before paying an old expense loaded in zero', async () => {
      const { service, movementsCreate } = updateService({
        ...paid,
        estado: 'PENDIENTE',
        movimiento_caja_id: null,
        importe: new Prisma.Decimal(0),
      });
      await expect(
        service.update('payment-1', { status: 'PAGADO' }, actor),
      ).rejects.toThrow('cargá el importe');
      expect(movementsCreate).not.toHaveBeenCalled();
    });

    it('marks as paid without touching any cash account when it has none', async () => {
      const { service, executeRaw, movementsCreate } = updateService({
        ...paid,
        estado: 'PENDIENTE',
        cuenta_caja_id: null,
        movimiento_caja_id: null,
      });
      await service.update('payment-1', { status: 'PAGADO' }, actor);
      expect(movementsCreate).not.toHaveBeenCalled();
      expect(updateValues(executeRaw)).toContain('PAGADO');
    });

    it('only the owner of the cash account can give the money back', async () => {
      const { service, movementsCreate } = updateService(paid, {
        ...payerAccount,
        propia: false,
      });
      await expect(
        service.update('payment-1', { status: 'PENDIENTE' }, actor),
      ).rejects.toThrow('sólo Juan Capdevila puede cambiarlo');
      expect(movementsCreate).not.toHaveBeenCalled();
    });

    it('only the owner of the cash account can pay from it', async () => {
      const { service, movementsCreate } = updateService(
        { ...paid, estado: 'PENDIENTE', movimiento_caja_id: null },
        { ...payerAccount, propia: false },
      );
      await expect(
        service.update('payment-1', { status: 'PAGADO' }, actor),
      ).rejects.toThrow('Sólo Juan Capdevila puede pagar desde Caja Juan');
      expect(movementsCreate).not.toHaveBeenCalled();
    });
  });
});

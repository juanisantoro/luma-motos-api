import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedAuditEvent } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from './sales.service';

describe('SalesService', () => {
  const operationId = '7d5cc401-544e-4651-9bd6-52495887fecd';
  const unitId = 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2';
  const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
  const actor: AuthenticatedUser = {
    id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
    email: 'admin@luma.test',
    name: null,
    active: true,
    globalAccess: false,
    organization: {
      id: organizationId,
      code: 'LUMA',
      name: 'Luma',
      type: 'CASA_CENTRAL',
    },
    role: { code: 'ADMINISTRADOR', name: 'Administrador', permissions: [] },
    branch: null,
  };

  function service(transaction: Prisma.TransactionClient) {
    const execute = jest
      .fn<
        Promise<unknown>,
        [
          AuthenticatedAuditEvent,
          (client: Prisma.TransactionClient) => Promise<unknown>,
        ]
      >()
      .mockImplementation((_event, work) => work(transaction));
    return new SalesService(
      {} as PrismaService,
      { execute } as unknown as AuditService,
    );
  }

  function queryService(transaction: Prisma.TransactionClient) {
    return new SalesService(
      {
        withTenant: jest
          .fn()
          .mockImplementation(
            (
              _scope: unknown,
              work: (client: Prisma.TransactionClient) => Promise<unknown>,
            ) => work(transaction),
          ),
      } as unknown as PrismaService,
      {} as AuditService,
    );
  }

  function operation(status: string, rowVersion = 2) {
    return {
      id: operationId,
      organizacion_id: organizationId,
      estado_operacion: status,
      version_fila: rowVersion,
      unidad_vehiculo_id: unitId,
      version_id: '4de88c4c-3382-4f9b-ae60-98147159c977',
      condicion: 'NUEVO',
      sucursal_id: '84e778cc-7616-4792-b6db-d89f100bb6f1',
      cliente_id: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
      precio_acordado: new Prisma.Decimal(100),
    };
  }

  function completeOperation(status: string) {
    const base = operation(status);
    return {
      ...base,
      numero_operacion: BigInt(42),
      fecha_operacion: new Date('2026-08-29T00:00:00.000Z'),
      estado_entrega: 'NO_PROGRAMADA',
      estado_documentacion: 'NO_INICIADA',
      precio_lista: new Prisma.Decimal(120),
      precio_minimo: new Prisma.Decimal(110),
      moneda: 'ARS',
      notas: null,
      creado_en: new Date('2026-08-29T10:00:00.000Z'),
      actualizado_en: new Date('2026-08-29T10:00:00.000Z'),
      clientes: {
        id: base.cliente_id,
        nombre_completo: 'Cliente',
        activo: true,
      },
      sucursales: {
        id: base.sucursal_id,
        codigo: 'CASA',
        nombre: 'Casa',
      },
      versiones_vehiculos: {
        id: base.version_id,
        nombre: 'Full',
        modelos_vehiculos: {
          id: '31b5de9b-9bc2-4777-bb78-9c7267b73aca',
          nombre: 'Model',
          tipo_vehiculo: 'MOTO',
          marcas_vehiculos: {
            id: '22b5de9b-9bc2-4777-bb78-9c7267b73aca',
            nombre: 'Brand',
          },
        },
      },
      unidades_vehiculos: {
        id: unitId,
        vin_mostrado: 'ABC123456',
        patente: null,
        estado_inventario: 'RESERVADO',
        sucursal_id: base.sucursal_id,
      },
      asignaciones_personal_operacion: [
        {
          personal: {
            id: '11b5de9b-9bc2-4777-bb78-9c7267b73aca',
            nombre_completo: 'Vendedor',
          },
        },
      ],
      reservas_stock: [],
      aprobaciones_operacion: [],
    };
  }

  it('rejects stale row versions before changing workflow state', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
      operaciones: {
        findFirst: jest.fn().mockResolvedValue(operation('BORRADOR', 3)),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      service(transaction).submit(operationId, { expectedVersion: 2 }, actor),
    ).rejects.toThrow(
      new ConflictException('Sales operation was modified by another request'),
    );
  });

  it('clears optional notes when PATCH explicitly sends null', async () => {
    const current = { ...completeOperation('BORRADOR'), notas: 'Anterior' };
    const updated = { ...current, notas: null, version_fila: 3 };
    const update = jest
      .fn<Promise<unknown>, [Prisma.operacionesUpdateArgs]>()
      .mockResolvedValue({});
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
      operaciones: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(updated),
        update,
      },
      reservas_stock: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as Prisma.TransactionClient;

    await expect(
      service(transaction).update(
        operationId,
        { expectedVersion: 2, notes: null },
        actor,
      ),
    ).resolves.toMatchObject({ notes: null, rowVersion: 3 });
    expect(update.mock.calls[0]?.[0].data).toMatchObject({ notas: null });
  });

  it('serializes by unit and rejects a second active reservation', async () => {
    const reservationFind = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'a5ed870b-c3b0-4dcb-8cc8-905e1a0126b9',
        operacion_id: '5aa5ed61-7428-4650-9af1-f93d26466321',
        unidad_vehiculo_id: unitId,
        estado: 'ACTIVO',
        vence_en: new Date(Date.now() + 60_000),
      });
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ id: operationId }])
      .mockResolvedValueOnce([{ id: unitId }])
      .mockResolvedValueOnce([{ id: 'a5ed870b-c3b0-4dcb-8cc8-905e1a0126b9' }]);
    const transaction = {
      $queryRaw: queryRaw,
      operaciones: {
        findFirst: jest.fn().mockResolvedValue(operation('BORRADOR')),
      },
      reservas_stock: { findFirst: reservationFind },
      unidades_vehiculos: {
        findFirst: jest.fn().mockResolvedValue({
          id: unitId,
          version_id: operation('BORRADOR').version_id,
          condicion: 'NUEVO',
          sucursal_id: operation('BORRADOR').sucursal_id,
          estado_inventario: 'RESERVADO',
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      service(transaction).reserve(
        operationId,
        { unitId, expectedVersion: 2 },
        actor,
      ),
    ).rejects.toThrow(
      new ConflictException(
        'The inventory unit is already reserved by another operation',
      ),
    );
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });

  it('detaches a displaced operation when recycling an expired reservation', async () => {
    const displacedOperationId = '5aa5ed61-7428-4650-9af1-f93d26466321';
    const expiredReservation = {
      id: 'a5ed870b-c3b0-4dcb-8cc8-905e1a0126b9',
      operacion_id: displacedOperationId,
      unidad_vehiculo_id: unitId,
      estado: 'ACTIVO',
      vence_en: new Date(Date.now() - 60_000),
      organizacion_id: organizationId,
    };
    const current = operation('BORRADOR');
    const completed = {
      ...completeOperation('BORRADOR'),
      version_fila: 3,
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
      operaciones: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(completed),
        update: jest.fn().mockResolvedValue({}),
        updateMany,
      },
      reservas_stock: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(expiredReservation),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
      unidades_vehiculos: {
        findFirst: jest.fn().mockResolvedValue({
          id: unitId,
          version_id: current.version_id,
          condicion: current.condicion,
          sucursal_id: current.sucursal_id,
          estado_inventario: 'RESERVADO',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      personal: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: '11b5de9b-9bc2-4777-bb78-9c7267b73aca' }),
      },
      movimientos_inventario: {
        create: jest.fn().mockResolvedValue({}),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      service(transaction).reserve(
        operationId,
        { unitId, expectedVersion: 2 },
        actor,
      ),
    ).resolves.toMatchObject({ id: operationId, rowVersion: 3 });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: displacedOperationId,
        organizacion_id: organizationId,
        unidad_vehiculo_id: unitId,
      },
      data: {
        unidad_vehiculo_id: null,
        version_fila: { increment: 1 },
      },
    });
  });

  it('requires an active reservation before submission', async () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: operationId }])
        .mockResolvedValueOnce([{ id: unitId }])
        .mockResolvedValueOnce([]),
      operaciones: {
        findFirst: jest.fn().mockResolvedValue(operation('BORRADOR')),
      },
      reservas_stock: { findFirst: jest.fn().mockResolvedValue(null) },
      unidades_vehiculos: {
        findFirst: jest.fn().mockResolvedValue({
          id: unitId,
          estado_inventario: 'RESERVADO',
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      service(transaction).submit(operationId, { expectedVersion: 2 }, actor),
    ).rejects.toThrow(
      new ConflictException(
        'The operation requires an active stock reservation',
      ),
    );
  });

  it('does not close until the payment plan matches the agreed price', async () => {
    const reservation = {
      id: 'a5ed870b-c3b0-4dcb-8cc8-905e1a0126b9',
      operacion_id: operationId,
      unidad_vehiculo_id: unitId,
      estado: 'ACTIVO',
      vence_en: new Date(Date.now() + 60_000),
      organizacion_id: organizationId,
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
      operaciones: {
        findFirst: jest.fn().mockResolvedValue(operation('APROBADA')),
      },
      reservas_stock: { findFirst: jest.fn().mockResolvedValue(reservation) },
      unidades_vehiculos: {
        findFirst: jest.fn().mockResolvedValue({
          id: unitId,
          version_id: operation('APROBADA').version_id,
          condicion: 'NUEVO',
          sucursal_id: operation('APROBADA').sucursal_id,
          estado_inventario: 'RESERVADO',
        }),
      },
      componentes_pago_operacion: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { importe_esperado: new Prisma.Decimal(90) },
        }),
      },
      reservas_stock_update: jest.fn(),
    } as unknown as Prisma.TransactionClient;

    await expect(
      service(transaction).close(operationId, { expectedVersion: 2 }, actor),
    ).rejects.toThrow(
      new ConflictException(
        'Payment plan total must equal the agreed price before closing',
      ),
    );
  });

  it('approves a submitted operation without consuming its reservation', async () => {
    const reservation = {
      id: 'a5ed870b-c3b0-4dcb-8cc8-905e1a0126b9',
      operacion_id: operationId,
      unidad_vehiculo_id: unitId,
      estado: 'ACTIVO',
      cantidad: 1,
      vence_en: new Date(Date.now() + 60_000),
      liberado_en: null,
      motivo_liberacion: null,
      organizacion_id: organizationId,
    };
    const approval = {
      id: '6aa5ed61-7428-4650-9af1-f93d26466321',
      decision: 'PENDIENTE',
      solicitado_en: new Date(),
      decidido_en: null,
      motivo: null,
      precio_lista_referencia: new Prisma.Decimal(120),
      precio_minimo_referencia: new Prisma.Decimal(110),
      precio_acordado_referencia: new Prisma.Decimal(100),
    };
    const pending = {
      ...completeOperation('PENDIENTE_APROBACION'),
      reservas_stock: [reservation],
      aprobaciones_operacion: [approval],
    };
    const approved = {
      ...pending,
      estado_operacion: 'APROBADA',
      version_fila: 3,
      aprobaciones_operacion: [
        {
          ...approval,
          decision: 'APROBADA',
          decidido_en: new Date(),
        },
      ],
    };
    const reservationUpdate = jest.fn();
    const unitUpdate = jest.fn();
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
      operaciones: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(pending)
          .mockResolvedValueOnce(approved),
        update: jest.fn().mockResolvedValue({}),
      },
      aprobaciones_operacion: {
        findFirst: jest.fn().mockResolvedValue(approval),
        update: jest.fn().mockResolvedValue({}),
      },
      personal: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: '11b5de9b-9bc2-4777-bb78-9c7267b73aca' }),
      },
      reservas_stock: {
        findFirst: jest.fn().mockResolvedValue(reservation),
        update: reservationUpdate,
      },
      unidades_vehiculos: {
        findFirst: jest.fn().mockResolvedValue({
          id: unitId,
          estado_inventario: 'RESERVADO',
        }),
        update: unitUpdate,
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      service(transaction).approve(operationId, { expectedVersion: 2 }, actor),
    ).resolves.toMatchObject({ status: 'APROBADA', rowVersion: 3 });
    expect(reservationUpdate).not.toHaveBeenCalled();
    expect(unitUpdate).not.toHaveBeenCalled();
  });

  it('rejects reservations longer than the bounded commercial window', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
      operaciones: {
        findFirst: jest.fn().mockResolvedValue(operation('BORRADOR')),
      },
      reservas_stock: { findFirst: jest.fn().mockResolvedValue(null) },
      unidades_vehiculos: {
        findFirst: jest.fn().mockResolvedValue({
          id: unitId,
          version_id: operation('BORRADOR').version_id,
          condicion: 'NUEVO',
          sucursal_id: operation('BORRADOR').sucursal_id,
          estado_inventario: 'EN_STOCK',
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      service(transaction).reserve(
        operationId,
        {
          unitId,
          expectedVersion: 2,
          expiresAt: new Date(
            Date.now() + 31 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
        actor,
      ),
    ).rejects.toThrow(
      new BadRequestException('Reservation expiry cannot exceed 30 days'),
    );
  });

  it('lists active personnel eligible for the selected sales branch', async () => {
    const count = jest.fn().mockResolvedValue(1);
    const findMany = jest
      .fn<
        Promise<
          Array<{
            id: string;
            codigo_empleado: string;
            nombre_completo: string;
          }>
        >,
        [Prisma.personalFindManyArgs]
      >()
      .mockResolvedValue([
        {
          id: '11b5de9b-9bc2-4777-bb78-9c7267b73aca',
          codigo_empleado: 'VEN-01',
          nombre_completo: 'Vendedora Demo',
        },
      ]);
    const transaction = {
      sucursales: { findFirst: jest.fn().mockResolvedValue({ id: unitId }) },
      personal: { count, findMany },
    } as unknown as Prisma.TransactionClient;

    await expect(
      queryService(transaction).sellers(
        { branchId: unitId, search: 'demo', page: 1, limit: 50 },
        actor,
      ),
    ).resolves.toEqual({
      items: [
        {
          id: '11b5de9b-9bc2-4777-bb78-9c7267b73aca',
          employeeCode: 'VEN-01',
          fullName: 'Vendedora Demo',
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      organizacion_id: organizationId,
      estado: 'ACTIVO',
    });
  });

  it('previews the branch-specific effective price policy', async () => {
    const validFrom = new Date('2026-08-01T00:00:00.000Z');
    const transaction = {
      sucursales: { findFirst: jest.fn().mockResolvedValue({ id: unitId }) },
      versiones_vehiculos: {
        findUnique: jest.fn().mockResolvedValue({
          alcance: 'GLOBAL',
          organizacion_propietaria_id: null,
          catalogo_organizaciones: [],
        }),
      },
      politicas_precios_vehiculos: {
        findFirst: jest.fn().mockResolvedValue({
          id: '21b5de9b-9bc2-4777-bb78-9c7267b73aca',
          version_id: '4de88c4c-3382-4f9b-ae60-98147159c977',
          sucursal_id: unitId,
          organizacion_id: organizationId,
          moneda: 'ARS',
          precio_lista: new Prisma.Decimal(120),
          precio_minimo: new Prisma.Decimal(110),
          vigente_desde: validFrom,
          vigente_hasta: null,
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      queryService(transaction).pricePolicy(
        {
          branchId: unitId,
          versionId: '4de88c4c-3382-4f9b-ae60-98147159c977',
        },
        actor,
      ),
    ).resolves.toEqual({
      id: '21b5de9b-9bc2-4777-bb78-9c7267b73aca',
      versionId: '4de88c4c-3382-4f9b-ae60-98147159c977',
      branchId: unitId,
      organizationId,
      currency: 'ARS',
      listPrice: '120',
      minimumPrice: '110',
      validFrom,
      validUntil: null,
      scope: 'BRANCH',
    });
  });

  it('resolves mine against the actor personnel id server-side', async () => {
    const personnelId = '11b5de9b-9bc2-4777-bb78-9c7267b73aca';
    const findMany = jest
      .fn<Promise<unknown[]>, [Prisma.operacionesFindManyArgs]>()
      .mockResolvedValue([]);
    const transaction = {
      personal: {
        findFirst: jest.fn().mockResolvedValue({ id: personnelId }),
      },
      operaciones: {
        count: jest.fn().mockResolvedValue(0),
        findMany,
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      queryService(transaction).findAll(
        { mine: true, page: 1, limit: 50 },
        actor,
      ),
    ).resolves.toEqual({ items: [], total: 0, page: 1, limit: 50 });
    expect(
      findMany.mock.calls[0]?.[0].where?.asignaciones_personal_operacion,
    ).toEqual({
      some: {
        personal_id: personnelId,
        rol_asignacion: 'VENDEDOR',
      },
    });
  });
});

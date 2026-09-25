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
  const availabilityId = 'a5ed870b-c3b0-4dcb-8cc8-905e1a0126b9';
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
    role: {
      id: '4bd1189b-2bb1-4258-889b-4500de5eeade',
      code: 'ADMINISTRADOR',
      name: 'Administrador',
      system: true,
      permissions: ['sucursales.todas'],
    },
    branch: null,
  };

  // Presenting an operation also reads patent payments (pagos_vehiculo);
  // tests that don't care about licensing get empty defaults.
  function withLicensingDefaults(transaction: Prisma.TransactionClient) {
    return Object.assign(
      {
        conceptos_pago_vehiculo: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        pagos_vehiculo: { findMany: jest.fn().mockResolvedValue([]) },
      },
      transaction,
    ) as Prisma.TransactionClient;
  }

  function service(rawTransaction: Prisma.TransactionClient) {
    const transaction = withLicensingDefaults(rawTransaction);
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

  function queryService(rawTransaction: Prisma.TransactionClient) {
    const transaction = withLicensingDefaults(rawTransaction);
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
      documentacion_entregada_en: null,
      precio_lista: new Prisma.Decimal(120),
      precio_minimo: new Prisma.Decimal(110),
      moneda: 'ARS',
      plataforma_pago: 'EFECTIVO',
      monto_credito: null,
      respaldo_garante: null,
      debe: 'NO',
      notas: null,
      creado_en: new Date('2026-08-29T10:00:00.000Z'),
      actualizado_en: new Date('2026-08-29T10:00:00.000Z'),
      clientes: {
        id: base.cliente_id,
        tipo_documento: 'DNI',
        numero_documento: '12345678',
        nombre_completo: 'Cliente',
        telefono: '1122334455',
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
        origen_adquisicion: 'COMPRA',
        proveedores: null,
      },
      asignaciones_personal_operacion: [
        {
          rol_asignacion: 'VENDEDOR',
          personal: {
            id: '11b5de9b-9bc2-4777-bb78-9c7267b73aca',
            nombre_completo: 'Vendedor',
          },
        },
      ],
      reservas_stock: [],
      aprobaciones_operacion: [],
      componentes_pago_operacion: [],
      obligaciones_operacion: [],
      solicitudes_abastecimiento: [],
      personal: {
        id: '11b5de9b-9bc2-4777-bb78-9c7267b73aca',
        nombre_completo: 'Administrador',
      },
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

  it('creates and links a new inline client in the operation transaction', async () => {
    const clientId = '904e2a34-8285-48fa-b64c-24a80d94f9cb';
    const createdOperation = completeOperation('BORRADOR');
    const clientCreate = jest
      .fn<Promise<unknown>, [Prisma.clientesCreateArgs]>()
      .mockResolvedValue({ id: clientId });
    const operationCreate = jest
      .fn<Promise<unknown>, [Prisma.operacionesCreateArgs]>()
      .mockResolvedValue(operation('BORRADOR'));
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      sucursales: { findFirst: jest.fn().mockResolvedValue({ id: 'branch' }) },
      clientes: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: clientCreate,
      },
      versiones_vehiculos: {
        findUnique: jest.fn().mockResolvedValue({
          alcance: 'GLOBAL',
          organizacion_propietaria_id: null,
          catalogo_organizaciones: [],
          modelos_vehiculos: { tipo_vehiculo: 'MOTO' },
        }),
      },
      personal: {
        findFirst: jest.fn().mockResolvedValue({
          id: '11b5de9b-9bc2-4777-bb78-9c7267b73aca',
        }),
      },
      politicas_precios_vehiculos: {
        findFirst: jest.fn().mockResolvedValue({
          precio_lista: new Prisma.Decimal(100),
          precio_minimo: new Prisma.Decimal(90),
          moneda: 'ARS',
        }),
      },
      operaciones: {
        create: operationCreate,
        findFirst: jest.fn().mockResolvedValue(createdOperation),
      },
      asignaciones_personal_operacion: {
        create: jest.fn().mockResolvedValue({}),
      },
      disponibilidad_proveedor: {
        findFirst: jest.fn().mockResolvedValue({
          id: availabilityId,
          proveedor_id: '0a44e64e-351e-4d9b-9150-5f20e34e4d61',
          vence_en: null,
          cantidad_informada: 1,
        }),
      },
      proveedores: {
        findFirst: jest.fn().mockResolvedValue({
          id: '0a44e64e-351e-4d9b-9150-5f20e34e4d61',
        }),
      },
      reservas_stock: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
      },
      solicitudes_abastecimiento: {
        create: jest.fn().mockResolvedValue({}),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      service(transaction).create(
        {
          vehicleType: 'MOTO',
          branchId: operation('BORRADOR').sucursal_id,
          client: {
            documentType: 'DNI',
            documentNumber: '12.345.678',
            fullName: 'Cliente Nuevo',
            phone: '1122334455',
          },
          versionId: operation('BORRADOR').version_id,
          condition: 'NUEVO',
          supplierAvailabilityId: availabilityId,
          agreedPrice: 100,
          paymentPlatform: 'EFECTIVO',
          licensingMode: 'BONIFICADA',
          submit: false,
        },
        actor,
      ),
    ).resolves.toMatchObject({ client: { id: clientId } });
    expect(clientCreate.mock.calls[0]?.[0].data).toMatchObject({
      documento_normalizado: '12345678',
      nombre_normalizado: 'cliente nuevo',
    });
    expect(operationCreate.mock.calls[0]?.[0].data).toMatchObject({
      cliente_id: clientId,
      incluye_casco: false,
      modalidad_patentamiento: 'BONIFICADA',
      importe_patentamiento: undefined,
    });
  });

  it('requires exactly one reservable inventory source', async () => {
    const transaction = {
      sucursales: { findFirst: jest.fn().mockResolvedValue({ id: 'branch' }) },
      clientes: {
        findFirst: jest.fn().mockResolvedValue({
          id: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
        }),
      },
      versiones_vehiculos: {
        findUnique: jest.fn().mockResolvedValue({
          alcance: 'GLOBAL',
          organizacion_propietaria_id: null,
          catalogo_organizaciones: [],
          modelos_vehiculos: { tipo_vehiculo: 'MOTO' },
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      service(transaction).create(
        {
          vehicleType: 'MOTO',
          branchId: operation('BORRADOR').sucursal_id,
          clientId: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
          versionId: operation('BORRADOR').version_id,
          condition: 'NUEVO',
          agreedPrice: 100,
          paymentPlatform: 'EFECTIVO',
          licensingMode: 'BONIFICADA',
          submit: false,
        },
        actor,
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'Exactly one of unitId or supplierAvailabilityId is required',
      ),
    );
  });

  it('submits a below-list operation for approval', async () => {
    const current = {
      ...completeOperation('BORRADOR'),
      reservas_stock: [
        {
          id: 'a5ed870b-c3b0-4dcb-8cc8-905e1a0126b9',
          operacion_id: operationId,
          unidad_vehiculo_id: unitId,
          disponibilidad_proveedor_id: null,
          estado: 'ACTIVO',
          vence_en: new Date(Date.now() + 60_000),
        },
      ],
    };
    const update = jest
      .fn<Promise<unknown>, [Prisma.operacionesUpdateArgs]>()
      .mockResolvedValue({});
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
      operaciones: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce({
            ...current,
            estado_operacion: 'PENDIENTE_APROBACION',
            version_fila: 3,
          }),
        update,
      },
      unidades_vehiculos: {
        findFirst: jest.fn().mockResolvedValue({
          id: unitId,
          estado_inventario: 'RESERVADO',
        }),
      },
      reservas_stock: {
        findFirst: jest.fn().mockResolvedValue(current.reservas_stock[0]),
      },
      clientes: {
        findFirst: jest.fn().mockResolvedValue({ id: current.cliente_id }),
      },
      politicas_precios_vehiculos: {
        findFirst: jest.fn().mockResolvedValue({
          precio_lista: new Prisma.Decimal(120),
          precio_minimo: new Prisma.Decimal(90),
          moneda: 'ARS',
        }),
      },
      personal: {
        findFirst: jest.fn().mockResolvedValue({
          id: '11b5de9b-9bc2-4777-bb78-9c7267b73aca',
        }),
      },
      aprobaciones_operacion: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as Prisma.TransactionClient;

    await expect(
      service(transaction).submit(operationId, { expectedVersion: 2 }, actor),
    ).resolves.toMatchObject({ status: 'PENDIENTE_APROBACION' });
    expect(update.mock.calls[0]?.[0].data).toMatchObject({
      estado_operacion: 'PENDIENTE_APROBACION',
    });
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
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ id: operationId }])
      .mockResolvedValueOnce([{ id: unitId }])
      .mockResolvedValueOnce([{ id: expiredReservation.id }])
      .mockResolvedValueOnce([{ id: displacedOperationId }]);
    const transaction = {
      $queryRaw: queryRaw,
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
    expect(queryRaw).toHaveBeenCalledTimes(4);
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
            usuario_id: string | null;
            codigo_empleado: string;
            nombre_completo: string;
            sucursales: { id: string; codigo: string; nombre: string };
            acceso_personal_sucursal: Array<{
              sucursales: { id: string; codigo: string; nombre: string };
            }>;
          }>
        >,
        [Prisma.personalFindManyArgs]
      >()
      .mockResolvedValue([
        {
          id: '11b5de9b-9bc2-4777-bb78-9c7267b73aca',
          usuario_id: null,
          codigo_empleado: 'VEN-01',
          nombre_completo: 'Vendedora Demo',
          sucursales: {
            id: unitId,
            codigo: 'SAN_MIGUEL',
            nombre: 'San Miguel',
          },
          acceso_personal_sucursal: [],
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
          isCurrentUser: false,
          branch: {
            id: unitId,
            code: 'SAN_MIGUEL',
            name: 'San Miguel',
          },
          branches: [
            {
              id: unitId,
              code: 'SAN_MIGUEL',
              name: 'San Miguel',
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      organizacion_id: organizationId,
      estado: 'ACTIVO',
      OR: [
        { sucursal_principal_id: unitId },
        {
          acceso_personal_sucursal: {
            some: { sucursal_id: unitId },
          },
        },
      ],
    });
  });

  it('lists organization-wide assignees when branchId is omitted', async () => {
    const branchLookup = jest.fn();
    const findMany = jest
      .fn<
        Promise<
          Array<{
            id: string;
            usuario_id: string | null;
            codigo_empleado: string;
            nombre_completo: string;
            sucursales: { id: string; codigo: string; nombre: string };
            acceso_personal_sucursal: [];
          }>
        >,
        [Prisma.personalFindManyArgs]
      >()
      .mockResolvedValue([
        {
          id: '11b5de9b-9bc2-4777-bb78-9c7267b73aca',
          usuario_id: null,
          codigo_empleado: 'VEN-01',
          nombre_completo: 'Vendedora Demo',
          sucursales: {
            id: unitId,
            codigo: 'SAN_MIGUEL',
            nombre: 'San Miguel',
          },
          acceso_personal_sucursal: [],
        },
      ]);
    const transaction = {
      sucursales: { findFirst: branchLookup },
      personal: {
        count: jest.fn().mockResolvedValue(1),
        findMany,
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      queryService(transaction).sellers(
        { page: 1, limit: 50, organizationId },
        actor,
      ),
    ).resolves.toMatchObject({
      total: 1,
      items: [
        {
          fullName: 'Vendedora Demo',
          branch: {
            id: unitId,
            code: 'SAN_MIGUEL',
            name: 'San Miguel',
          },
          branches: [
            {
              id: unitId,
              code: 'SAN_MIGUEL',
              name: 'San Miguel',
            },
          ],
        },
      ],
    });
    expect(branchLookup).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      organizacion_id: organizationId,
      estado: 'ACTIVO',
      OR: [
        { sucursal_principal_id: { not: null } },
        { acceso_personal_sucursal: { some: {} } },
      ],
    });
  });

  it('rejects cross-tenant assignee lookups even for global actors', async () => {
    const withTenant = jest.fn();
    const globalActor = { ...actor, globalAccess: true };
    const lookupService = new SalesService(
      { withTenant } as unknown as PrismaService,
      {} as AuditService,
    );

    await expect(
      lookupService.sellers(
        {
          page: 1,
          limit: 50,
          organizationId: 'a0c86b26-5943-4555-9112-bf0c65df0c21',
        },
        globalActor,
      ),
    ).rejects.toThrow(
      'Assignee lookups are restricted to the authenticated organization',
    );
    expect(withTenant).not.toHaveBeenCalled();
  });

  it.each([
    ['sellerId', 'INVALID_OPERATION_SELLER'],
    ['contactId', 'INVALID_OPERATION_CONTACT'],
  ] as const)(
    'rejects a cross-tenant %s before writing the operation',
    async (field, code) => {
      const update = jest.fn();
      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: {
          findFirst: jest.fn().mockResolvedValue(completeOperation('BORRADOR')),
          update,
        },
        reservas_stock: { findFirst: jest.fn().mockResolvedValue(null) },
        personal: { findFirst: jest.fn().mockResolvedValue(null) },
      } as unknown as Prisma.TransactionClient;

      try {
        await service(transaction).update(
          operationId,
          {
            expectedVersion: 2,
            [field]: 'a0c86b26-5943-4555-9112-bf0c65df0c21',
          },
          actor,
        );
        throw new Error('Expected assignee validation to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
          statusCode: 400,
          code,
        });
      }
      expect(update).not.toHaveBeenCalled();
    },
  );

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
        // A "mine" query now matches either seller-like assignment role
        // (VENDEDOR or CALLCENTER), not only VENDEDOR - see CALLCENTER role
        // support in the session report.
        rol_asignacion: { in: ['VENDEDOR', 'CALLCENTER'] },
      },
    });
  });
  describe('helmet and licensing', () => {
    function licensedOperation(status: string, overrides = {}) {
      return {
        ...completeOperation(status),
        numero_boleto: 'B-0001',
        incluye_casco: true,
        modalidad_patentamiento: 'PAGA_CLIENTE',
        importe_patentamiento: new Prisma.Decimal(85000),
        patente_estimada_desde: new Date('2026-09-11T00:00:00.000Z'),
        patente_estimada_hasta: new Date('2026-09-18T00:00:00.000Z'),
        ingresos_financieros: [],
        ...overrides,
      };
    }

    function createTransaction(
      operationCreate: jest.Mock,
      created: ReturnType<typeof completeOperation>,
    ) {
      return {
        $queryRaw: jest.fn().mockResolvedValue([]),
        $executeRaw: jest.fn().mockResolvedValue(1),
        sucursales: {
          findFirst: jest.fn().mockResolvedValue({ id: 'branch' }),
        },
        clientes: {
          findFirst: jest.fn().mockResolvedValue({
            id: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
            activo: true,
          }),
        },
        versiones_vehiculos: {
          findUnique: jest.fn().mockResolvedValue({
            alcance: 'GLOBAL',
            organizacion_propietaria_id: null,
            catalogo_organizaciones: [],
            modelos_vehiculos: { tipo_vehiculo: 'MOTO' },
          }),
        },
        personal: {
          findFirst: jest.fn().mockResolvedValue({
            id: '11b5de9b-9bc2-4777-bb78-9c7267b73aca',
          }),
        },
        politicas_precios_vehiculos: {
          findFirst: jest.fn().mockResolvedValue({
            precio_lista: new Prisma.Decimal(100),
            precio_minimo: new Prisma.Decimal(90),
            moneda: 'ARS',
          }),
        },
        operaciones: {
          create: operationCreate,
          findFirst: jest.fn().mockResolvedValue(created),
        },
        asignaciones_personal_operacion: {
          create: jest.fn().mockResolvedValue({}),
        },
        disponibilidad_proveedor: {
          findFirst: jest.fn().mockResolvedValue({
            id: availabilityId,
            proveedor_id: '0a44e64e-351e-4d9b-9150-5f20e34e4d61',
            vence_en: null,
            cantidad_informada: 1,
          }),
        },
        proveedores: {
          findFirst: jest.fn().mockResolvedValue({
            id: '0a44e64e-351e-4d9b-9150-5f20e34e4d61',
          }),
        },
        reservas_stock: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({}),
        },
        solicitudes_abastecimiento: {
          create: jest.fn().mockResolvedValue({}),
        },
      } as unknown as Prisma.TransactionClient;
    }

    const baseCreate = {
      vehicleType: 'MOTO' as const,
      branchId: '84e778cc-7616-4792-b6db-d89f100bb6f1',
      clientId: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
      versionId: '4de88c4c-3382-4f9b-ae60-98147159c977',
      condition: 'NUEVO' as const,
      supplierAvailabilityId: availabilityId,
      agreedPrice: 100,
      paymentPlatform: 'EFECTIVO' as const,
      submit: false,
    };

    it('persists helmet, licensing mode, amount and the estimated window on create', async () => {
      const operationCreate = jest
        .fn<Promise<unknown>, [Prisma.operacionesCreateArgs]>()
        .mockResolvedValue(operation('BORRADOR'));
      const created = licensedOperation('BORRADOR');

      await expect(
        service(createTransaction(operationCreate, created)).create(
          {
            ...baseCreate,
            // Friday: +10 business days = Fri 11/09, +15 = Fri 18/09.
            operationDate: '2026-08-28',
            includesHelmet: true,
            licensingMode: 'PAGA_CLIENTE',
            licensingAmount: 85000,
            ticketNumber: ' B-0001 ',
          },
          actor,
        ),
      ).resolves.toMatchObject({
        ticketNumber: 'B-0001',
        includesHelmet: true,
        licensing: {
          mode: 'PAGA_CLIENTE',
          amount: '85000',
          estimatedFrom: '2026-09-11',
          estimatedTo: '2026-09-18',
          status: 'COBRO_PENDIENTE',
        },
      });
      expect(operationCreate.mock.calls[0]?.[0].data).toMatchObject({
        numero_boleto: 'B-0001',
        incluye_casco: true,
        modalidad_patentamiento: 'PAGA_CLIENTE',
        importe_patentamiento: 85000,
        patente_estimada_desde: new Date('2026-09-11T00:00:00.000Z'),
        patente_estimada_hasta: new Date('2026-09-18T00:00:00.000Z'),
      });
    });

    it('rejects a licensing amount when the patent is bonified', async () => {
      const operationCreate = jest.fn();
      await expect(
        service(
          createTransaction(operationCreate, licensedOperation('BORRADOR')),
        ).create(
          {
            ...baseCreate,
            licensingMode: 'BONIFICADA',
            licensingAmount: 1000,
          },
          actor,
        ),
      ).rejects.toMatchObject({
        response: { code: 'LICENSING_AMOUNT_NOT_ALLOWED' },
      });
      expect(operationCreate).not.toHaveBeenCalled();
    });

    it('recomputes the estimated window when the operation date changes', async () => {
      const current = licensedOperation('BORRADOR');
      const update = jest
        .fn<Promise<unknown>, [Prisma.operacionesUpdateArgs]>()
        .mockResolvedValue({});
      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: {
          findFirst: jest.fn().mockResolvedValue(current),
          update,
        },
        reservas_stock: { findFirst: jest.fn().mockResolvedValue(null) },
      } as unknown as Prisma.TransactionClient;

      await service(transaction).update(
        operationId,
        { expectedVersion: 2, operationDate: '2026-09-07' },
        actor,
      );
      expect(update.mock.calls[0]?.[0].data).toMatchObject({
        patente_estimada_desde: new Date('2026-09-21T00:00:00.000Z'),
        patente_estimada_hasta: new Date('2026-09-28T00:00:00.000Z'),
      });
    });

    it('clears the amount when PATCH switches the draft to BONIFICADA', async () => {
      const current = licensedOperation('BORRADOR');
      const update = jest
        .fn<Promise<unknown>, [Prisma.operacionesUpdateArgs]>()
        .mockResolvedValue({});
      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: {
          findFirst: jest.fn().mockResolvedValue(current),
          update,
        },
        reservas_stock: { findFirst: jest.fn().mockResolvedValue(null) },
      } as unknown as Prisma.TransactionClient;

      await service(transaction).update(
        operationId,
        {
          expectedVersion: 2,
          licensingMode: 'BONIFICADA',
          includesHelmet: false,
        },
        actor,
      );
      expect(update.mock.calls[0]?.[0].data).toMatchObject({
        modalidad_patentamiento: 'BONIFICADA',
        importe_patentamiento: null,
        incluye_casco: false,
      });
    });

    it('does not let PATCH change licensing on an approved operation', async () => {
      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: {
          findFirst: jest.fn().mockResolvedValue(licensedOperation('APROBADA')),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        service(transaction).update(
          operationId,
          { expectedVersion: 2, licensingMode: 'BONIFICADA' },
          actor,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('manages licensing of an approved operation without touching its status', async () => {
      const current = licensedOperation('APROBADA', {
        modalidad_patentamiento: 'BONIFICADA',
        importe_patentamiento: null,
        patente_estimada_desde: null,
        patente_estimada_hasta: null,
      });
      const updated = licensedOperation('APROBADA', { version_fila: 3 });
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
      } as unknown as Prisma.TransactionClient;

      await expect(
        service(transaction).updateLicensing(
          operationId,
          { expectedVersion: 2, mode: 'PAGA_CLIENTE', amount: 85000 },
          actor,
        ),
      ).resolves.toMatchObject({
        status: 'APROBADA',
        licensing: { mode: 'PAGA_CLIENTE', amount: '85000' },
      });
      const data = update.mock.calls[0]?.[0].data;
      expect(data).toMatchObject({
        modalidad_patentamiento: 'PAGA_CLIENTE',
        importe_patentamiento: 85000,
        // Historical operation without a window gets one from its date.
        patente_estimada_desde: new Date('2026-09-11T00:00:00.000Z'),
        patente_estimada_hasta: new Date('2026-09-18T00:00:00.000Z'),
      });
      expect(data).not.toHaveProperty('estado_operacion');
    });

    it('rejects stale versions and cancelled operations when managing licensing', async () => {
      const stale = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: {
          findFirst: jest.fn().mockResolvedValue(licensedOperation('APROBADA')),
        },
      } as unknown as Prisma.TransactionClient;
      await expect(
        service(stale).updateLicensing(
          operationId,
          { expectedVersion: 1, mode: 'BONIFICADA' },
          actor,
        ),
      ).rejects.toThrow(ConflictException);

      const cancelled = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: {
          findFirst: jest
            .fn()
            .mockResolvedValue(licensedOperation('CANCELADA')),
        },
      } as unknown as Prisma.TransactionClient;
      await expect(
        service(cancelled).updateLicensing(
          operationId,
          { expectedVersion: 2, mode: 'BONIFICADA' },
          actor,
        ),
      ).rejects.toMatchObject({
        response: { code: 'LICENSING_OPERATION_CANCELLED' },
      });
    });

    it('blocks BONIFICADA once a patent collection from the client exists', async () => {
      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: {
          findFirst: jest.fn().mockResolvedValue(
            licensedOperation('APROBADA', {
              ingresos_financieros: [
                {
                  id: 'income-1',
                  importe: new Prisma.Decimal(85000),
                  estado_registro: 'PENDIENTE',
                  fecha_ingreso: new Date('2026-09-15T00:00:00.000Z'),
                },
              ],
            }),
          ),
          update: jest.fn(),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        service(transaction).updateLicensing(
          operationId,
          { expectedVersion: 2, mode: 'BONIFICADA' },
          actor,
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'LICENSING_COLLECTION_REGISTERED',
          details: { incomeIds: ['income-1'] },
        },
      });
    });

    it('reports collection and payment status from linked incomes and vehicle payments', async () => {
      const bonified = licensedOperation('APROBADA', {
        id: operationId,
        modalidad_patentamiento: 'BONIFICADA',
        importe_patentamiento: null,
      });
      const paymentsFindMany = jest
        .fn<Promise<unknown[]>, [Prisma.pagos_vehiculoFindManyArgs]>()
        .mockResolvedValue([
          {
            id: 'payment-1',
            operacion_id: operationId,
            importe: new Prisma.Decimal(60000),
            estado: 'PAGADO',
            fecha: new Date('2026-09-12T00:00:00.000Z'),
          },
        ]);
      const transaction = {
        operaciones: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([bonified]),
        },
        conceptos_pago_vehiculo: {
          findUnique: jest.fn().mockResolvedValue({ id: 'concept-patente' }),
        },
        pagos_vehiculo: { findMany: paymentsFindMany },
      } as unknown as Prisma.TransactionClient;

      const result = await queryService(transaction).findAll(
        { vehicleType: 'MOTO', page: 1, limit: 50 },
        actor,
      );
      expect(result.items[0]).toMatchObject({
        ticketNumber: 'B-0001',
        licensing: {
          mode: 'BONIFICADA',
          status: 'PAGADO',
          payment: {
            status: 'PAGADO',
            amount: '60000.00',
            paymentIds: ['payment-1'],
          },
          collection: { status: 'SIN_REGISTRAR' },
        },
      });
      expect(paymentsFindMany.mock.calls[0]?.[0].where).toEqual({
        concepto_id: 'concept-patente',
        operacion_id: { in: [operationId] },
      });
    });

    it('filters by licensing mode, undefined mode, overdue window and ticket number', async () => {
      const findMany = jest
        .fn<Promise<unknown[]>, [Prisma.operacionesFindManyArgs]>()
        .mockResolvedValue([]);
      const transaction = {
        operaciones: { count: jest.fn().mockResolvedValue(0), findMany },
      } as unknown as Prisma.TransactionClient;
      const query = queryService(transaction);

      await query.findAll(
        {
          vehicleType: 'MOTO',
          licensingMode: 'PAGA_CLIENTE',
          search: 'B-0001',
          page: 1,
          limit: 50,
        },
        actor,
      );
      const byMode = findMany.mock.calls[0]?.[0].where;
      expect(byMode?.modalidad_patentamiento).toBe('PAGA_CLIENTE');
      expect(byMode?.OR).toContainEqual({
        numero_boleto: { contains: 'B-0001', mode: 'insensitive' },
      });

      await query.findAll(
        {
          vehicleType: 'MOTO',
          licensingMode: 'SIN_DEFINIR',
          page: 1,
          limit: 50,
        },
        actor,
      );
      expect(
        findMany.mock.calls[1]?.[0].where?.modalidad_patentamiento,
      ).toBeNull();

      await query.findAll(
        { vehicleType: 'MOTO', licensingOverdue: true, page: 1, limit: 50 },
        actor,
      );
      const overdue = (
        findMany.mock.calls[2]?.[0].where?.AND as Prisma.operacionesWhereInput[]
      )[0];
      expect(overdue).toMatchObject({
        estado_operacion: {
          in: ['PENDIENTE_APROBACION', 'APROBADA', 'CERRADA'],
        },
        patente_estimada_hasta: { lt: expect.any(Date) as Date },
        OR: [
          { unidad_vehiculo_id: null },
          { unidades_vehiculos: { patente: null } },
        ],
      });
    });
  });
});

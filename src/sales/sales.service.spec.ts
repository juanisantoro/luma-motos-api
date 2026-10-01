import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedAuditEvent } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CashService } from '../cash/cash.service';
import { BranchScope } from '../branch-scope/branch-scope';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService, trackingTotals } from './sales.service';

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

  function service(
    rawTransaction: Prisma.TransactionClient,
    cash = {} as CashService,
  ) {
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
      cash,
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
      {} as CashService,
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

  it('rejects combining a stock unit and a supplier availability', async () => {
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
          unitId,
          supplierAvailabilityId: availabilityId,
          agreedPrice: 100,
          paymentPlatform: 'EFECTIVO',
          licensingMode: 'BONIFICADA',
          submit: false,
        },
        actor,
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'unitId and supplierAvailabilityId cannot be combined',
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
      {} as CashService,
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

    const sellerActor: AuthenticatedUser = {
      ...actor,
      role: {
        ...actor.role,
        code: 'VENDEDOR',
        name: 'Vendedor',
        permissions: ['ventas.gestionar'],
      },
      branch: {
        id: '84e778cc-7616-4792-b6db-d89f100bb6f1',
        code: 'CASA',
        name: 'Casa',
      },
    };
    // personal.findFirst in createTransaction resolves this id for the actor.
    const ownPersonnelId = '11b5de9b-9bc2-4777-bb78-9c7267b73aca';

    it('lets a seller send their own personnel id as sellerId', async () => {
      const operationCreate = jest
        .fn<Promise<unknown>, [Prisma.operacionesCreateArgs]>()
        .mockResolvedValue(operation('BORRADOR'));
      const assignmentCreate = jest
        .fn<
          Promise<unknown>,
          [Prisma.asignaciones_personal_operacionCreateArgs]
        >()
        .mockResolvedValue({});
      const transaction = {
        ...createTransaction(operationCreate, licensedOperation('BORRADOR')),
        asignaciones_personal_operacion: { create: assignmentCreate },
      } as unknown as Prisma.TransactionClient;

      await expect(
        service(transaction).create(
          {
            ...baseCreate,
            sellerId: ownPersonnelId,
            licensingMode: 'BONIFICADA',
          },
          sellerActor,
        ),
      ).resolves.toMatchObject({ id: operationId });
      expect(operationCreate).toHaveBeenCalled();
      expect(assignmentCreate.mock.calls[0]?.[0]).toMatchObject({
        data: { personal_id: ownPersonnelId },
      });
    });

    it('forbids a seller from assigning another seller', async () => {
      const operationCreate = jest.fn();
      await expect(
        service(
          createTransaction(operationCreate, licensedOperation('BORRADOR')),
        ).create(
          {
            ...baseCreate,
            sellerId: '21b5de9b-9bc2-4777-bb78-9c7267b73aca',
            licensingMode: 'BONIFICADA',
          },
          sellerActor,
        ),
      ).rejects.toThrow(
        new ForbiddenException(
          'Sellers cannot assign operations to another seller',
        ),
      );
      expect(operationCreate).not.toHaveBeenCalled();
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

    describe('patent collection from the grid', () => {
      const accountId = 'b1c2d3e4-0000-4000-8000-000000000001';
      const idempotencyKey = 'c1c2d3e4-0000-4000-8000-000000000002';

      function collectionSetup(
        current: ReturnType<typeof licensedOperation>,
        repeated: { ingreso_id: string | null } | null = null,
      ) {
        const incomeCreate = jest
          .fn<Promise<unknown>, [Prisma.ingresosCreateArgs]>()
          .mockResolvedValue({ id: 'income-new' });
        const incomeUpdate = jest
          .fn<Promise<unknown>, [Prisma.ingresosUpdateArgs]>()
          .mockResolvedValue({});
        const registerEntityMovement = jest.fn().mockResolvedValue({});
        const settledAmount = jest
          .fn()
          .mockResolvedValue(new Prisma.Decimal(85000));
        const transaction = {
          $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
          operaciones: { findFirst: jest.fn().mockResolvedValue(current) },
          movimientos_caja: {
            findFirst: jest.fn().mockResolvedValue(repeated),
          },
          tipos_ingreso: {
            findFirst: jest.fn().mockResolvedValue({ nombre: 'Patente' }),
          },
          ingresos: { create: incomeCreate, update: incomeUpdate },
        } as unknown as Prisma.TransactionClient;
        const cash = {
          registerEntityMovement,
          settledAmount,
        } as unknown as CashService;
        return {
          sales: service(transaction, cash),
          incomeCreate,
          incomeUpdate,
          registerEntityMovement,
        };
      }

      it('creates the Patente income and its cash movement in one step', async () => {
        const setup = collectionSetup(licensedOperation('APROBADA'));

        await setup.sales.collectLicensing(
          operationId,
          {
            idempotencyKey,
            accountId,
            amount: '85000',
            collectionDate: '2026-09-20',
          },
          actor,
        );

        expect(setup.incomeCreate.mock.calls[0]?.[0].data).toMatchObject({
          tipo_original: 'Patente',
          operacion_id: operationId,
          unidad_vehiculo_id: unitId,
          importe: new Prisma.Decimal(85000),
          referencia: 'B-0001',
          fecha_ingreso: new Date('2026-09-20T00:00:00.000Z'),
          estado_registro: 'PENDIENTE',
        });
        expect(setup.registerEntityMovement).toHaveBeenCalledWith(
          expect.anything(),
          actor,
          organizationId,
          'ARS',
          expect.objectContaining({
            idempotencyKey,
            accountId,
            amount: '85000.00',
            reference: 'B-0001',
            occurredAt: '2026-09-20T12:00:00.000-03:00',
          }),
          { ingreso_id: 'income-new' },
          'INGRESO',
          'CREDITO',
        );
        expect(setup.incomeUpdate.mock.calls[0]?.[0].data).toEqual({
          estado_registro: 'PAGADO',
        });
      });

      it('only collects when the client pays the patent', async () => {
        const setup = collectionSetup(
          licensedOperation('APROBADA', {
            modalidad_patentamiento: 'BONIFICADA',
            importe_patentamiento: null,
          }),
        );
        await expect(
          setup.sales.collectLicensing(
            operationId,
            { idempotencyKey, accountId, amount: '85000' },
            actor,
          ),
        ).rejects.toMatchObject({
          response: { code: 'LICENSING_COLLECTION_NOT_ALLOWED' },
        });
        expect(setup.incomeCreate).not.toHaveBeenCalled();
      });

      it('does not duplicate the income when the same request is retried', async () => {
        const setup = collectionSetup(
          licensedOperation('APROBADA', {
            ingresos_financieros: [
              {
                id: 'income-previous',
                importe: new Prisma.Decimal(85000),
                estado_registro: 'PAGADO',
                fecha_ingreso: new Date('2026-09-20T00:00:00.000Z'),
              },
            ],
          }),
          { ingreso_id: 'income-previous' },
        );
        await expect(
          setup.sales.collectLicensing(
            operationId,
            { idempotencyKey, accountId, amount: '85000' },
            actor,
          ),
        ).resolves.toMatchObject({ licensing: { status: 'COBRADO' } });
        expect(setup.incomeCreate).not.toHaveBeenCalled();
        expect(setup.registerEntityMovement).not.toHaveBeenCalled();
      });

      it('rejects a zero amount before opening a transaction', async () => {
        const setup = collectionSetup(licensedOperation('APROBADA'));
        await expect(
          setup.sales.collectLicensing(
            operationId,
            { idempotencyKey, accountId, amount: '0' },
            actor,
          ),
        ).rejects.toMatchObject({ response: { code: 'INVALID_AMOUNT' } });
      });
    });

    describe('fase 5 - llegada de la patente', () => {
      const accountId = 'b1c2d3e4-0000-4000-8000-000000000001';
      const idempotencyKey = 'c1c2d3e4-0000-4000-8000-000000000003';
      const collector: AuthenticatedUser = {
        ...actor,
        role: {
          ...actor.role,
          permissions: [
            'sucursales.todas',
            'ventas.patentamiento.gestionar',
            'ingresos.cobrar',
          ],
        },
      };

      function plateSetup(
        current: ReturnType<typeof licensedOperation>,
        duplicated: { id: string; vin_mostrado: string } | null = null,
      ) {
        const operationUpdate = jest
          .fn<Promise<unknown>, [Prisma.operacionesUpdateArgs]>()
          .mockResolvedValue({});
        const unitUpdate = jest
          .fn<Promise<unknown>, [Prisma.unidades_vehiculosUpdateArgs]>()
          .mockResolvedValue({});
        const incomeCreate = jest
          .fn<Promise<unknown>, [Prisma.ingresosCreateArgs]>()
          .mockResolvedValue({ id: 'income-plate' });
        const registerEntityMovement = jest.fn().mockResolvedValue({});
        const reloaded = {
          ...current,
          patente_recibida_en: new Date('2026-09-17T00:00:00.000Z'),
          version_fila: current.version_fila + 1,
        };
        const transaction = {
          $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
          operaciones: {
            findFirst: jest
              .fn()
              .mockResolvedValueOnce(current)
              .mockResolvedValue(reloaded),
            update: operationUpdate,
          },
          unidades_vehiculos: {
            findFirst: jest.fn().mockResolvedValue(duplicated),
            update: unitUpdate,
          },
          movimientos_caja: { findFirst: jest.fn().mockResolvedValue(null) },
          tipos_ingreso: {
            findFirst: jest.fn().mockResolvedValue({ nombre: 'Patente' }),
          },
          personal: {
            findFirst: jest.fn().mockResolvedValue({ id: 'staff-1' }),
          },
          ingresos: {
            create: incomeCreate,
            update: jest.fn().mockResolvedValue({}),
          },
        } as unknown as Prisma.TransactionClient;
        const cash = {
          registerEntityMovement,
          settledAmount: jest.fn().mockResolvedValue(new Prisma.Decimal(85000)),
          actorPersonnelId: jest.fn().mockResolvedValue('staff-1'),
        } as unknown as CashService;
        return {
          sales: service(transaction, cash),
          operationUpdate,
          unitUpdate,
          incomeCreate,
          registerEntityMovement,
        };
      }

      it('BONIFICADA: stores the plate on the unit and the reception date, charging nothing', async () => {
        const setup = plateSetup(
          licensedOperation('APROBADA', {
            modalidad_patentamiento: 'BONIFICADA',
            importe_patentamiento: null,
          }),
        );

        const result = await setup.sales.registerLicensePlate(
          operationId,
          {
            expectedVersion: 2,
            licensePlate: ' a123 bcd ',
            receivedAt: '2026-09-17',
          },
          actor,
        );

        expect(setup.unitUpdate.mock.calls[0]?.[0]).toMatchObject({
          where: {
            id_organizacion_id: { id: unitId, organizacion_id: organizationId },
          },
          data: { patente: 'A123 BCD', patente_normalizada: 'A123BCD' },
        });
        expect(setup.operationUpdate.mock.calls[0]?.[0].data).toEqual({
          patente_recibida_en: new Date('2026-09-17T00:00:00.000Z'),
          version_fila: { increment: 1 },
        });
        expect(setup.incomeCreate).not.toHaveBeenCalled();
        expect(result.licensing.plate).toMatchObject({
          status: 'RECIBIDA',
          receivedAt: '2026-09-17',
        });
      });

      it('PAGA_CLIENTE without collection leaves the plate received with the collection pending', async () => {
        const setup = plateSetup(licensedOperation('APROBADA'));
        const result = await setup.sales.registerLicensePlate(
          operationId,
          {
            expectedVersion: 2,
            licensePlate: 'A123BCD',
            receivedAt: '2026-09-17',
          },
          actor,
        );
        expect(setup.incomeCreate).not.toHaveBeenCalled();
        expect(result.licensing.plate.status).toBe('RECIBIDA_COBRO_PENDIENTE');
      });

      it('PAGA_CLIENTE registers the client collection in the same step', async () => {
        const setup = plateSetup(licensedOperation('APROBADA'));
        await setup.sales.registerLicensePlate(
          operationId,
          {
            expectedVersion: 2,
            licensePlate: 'A123BCD',
            receivedAt: '2026-09-17',
            collection: {
              idempotencyKey,
              accountId,
              amount: '85000',
              collectionDate: '2026-09-17',
              paymentMethod: 'TRANSFERENCIA_BANCARIA',
            },
          },
          collector,
        );
        expect(setup.incomeCreate.mock.calls[0]?.[0].data).toMatchObject({
          tipo_original: 'Patente',
          operacion_id: operationId,
          referencia: 'B-0001',
          importe: new Prisma.Decimal(85000),
        });
        expect(setup.registerEntityMovement).toHaveBeenCalledWith(
          expect.anything(),
          collector,
          organizationId,
          'ARS',
          expect.objectContaining({ idempotencyKey, accountId }),
          { ingreso_id: 'income-plate' },
          'INGRESO',
          'CREDITO',
        );
      });

      it('requires ingresos.cobrar to collect and PAGA_CLIENTE to accept a collection', async () => {
        const collection = { idempotencyKey, accountId, amount: '85000' };
        await expect(
          plateSetup(licensedOperation('APROBADA')).sales.registerLicensePlate(
            operationId,
            { expectedVersion: 2, licensePlate: 'A123BCD', collection },
            actor,
          ),
        ).rejects.toThrow(ForbiddenException);

        const bonified = plateSetup(
          licensedOperation('APROBADA', {
            modalidad_patentamiento: 'BONIFICADA',
            importe_patentamiento: null,
          }),
        );
        await expect(
          bonified.sales.registerLicensePlate(
            operationId,
            { expectedVersion: 2, licensePlate: 'A123BCD', collection },
            collector,
          ),
        ).rejects.toMatchObject({
          response: { code: 'LICENSING_COLLECTION_NOT_ALLOWED' },
        });
        expect(bonified.unitUpdate).not.toHaveBeenCalled();
      });

      it('validates state, mode, unit, dates and duplicated plates', async () => {
        const register = (
          current: ReturnType<typeof licensedOperation>,
          input: Partial<{ licensePlate: string; receivedAt: string }> = {},
          duplicated: { id: string; vin_mostrado: string } | null = null,
        ) =>
          plateSetup(current, duplicated).sales.registerLicensePlate(
            operationId,
            { expectedVersion: 2, licensePlate: 'A123BCD', ...input },
            actor,
          );

        await expect(
          register(licensedOperation('BORRADOR')),
        ).rejects.toMatchObject({
          response: { code: 'LICENSE_PLATE_NOT_ALLOWED' },
        });
        await expect(
          register(
            licensedOperation('APROBADA', {
              modalidad_patentamiento: null,
              importe_patentamiento: null,
            }),
          ),
        ).rejects.toMatchObject({
          response: { code: 'LICENSING_MODE_REQUIRED' },
        });
        await expect(
          register(
            licensedOperation('APROBADA', {
              unidad_vehiculo_id: null,
              unidades_vehiculos: null,
            }),
          ),
        ).rejects.toMatchObject({
          response: { code: 'OPERATION_UNIT_REQUIRED' },
        });
        await expect(
          register(licensedOperation('APROBADA'), { receivedAt: '2026-08-01' }),
        ).rejects.toMatchObject({
          response: { code: 'LICENSE_PLATE_RECEIVED_BEFORE_OPERATION' },
        });
        await expect(
          register(licensedOperation('APROBADA'), { receivedAt: '2999-01-01' }),
        ).rejects.toMatchObject({
          response: { code: 'LICENSE_PLATE_RECEIVED_IN_FUTURE' },
        });
        await expect(
          register(licensedOperation('APROBADA'), { licensePlate: 'AB-1' }),
        ).rejects.toMatchObject({
          response: { code: 'INVALID_LICENSE_PLATE' },
        });
        await expect(
          register(
            licensedOperation('APROBADA'),
            {},
            { id: 'other-unit', vin_mostrado: 'VIN-OTRO' },
          ),
        ).rejects.toMatchObject({
          response: {
            code: 'LICENSE_PLATE_IN_USE',
            details: { unitId: 'other-unit', vin: 'VIN-OTRO' },
          },
        });
      });

      it('rejects a stale version', async () => {
        await expect(
          plateSetup(licensedOperation('APROBADA')).sales.registerLicensePlate(
            operationId,
            { expectedVersion: 1, licensePlate: 'A123BCD' },
            actor,
          ),
        ).rejects.toThrow(ConflictException);
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
        // Fase 5: a registered arrival also stops the reminder.
        patente_recibida_en: null,
        OR: [
          { unidad_vehiculo_id: null },
          { unidades_vehiculos: { patente: null } },
        ],
      });
    });

    it('fase 5: filters received PAGA_CLIENTE plates with the collection pending', async () => {
      const findMany = jest
        .fn<Promise<unknown[]>, [Prisma.operacionesFindManyArgs]>()
        .mockResolvedValue([]);
      const queryRaw = jest
        .fn<Promise<unknown>, [Prisma.Sql]>()
        .mockResolvedValue([{ id: 'pending-1' }]);
      const query = queryService({
        $queryRaw: queryRaw,
        operaciones: { count: jest.fn().mockResolvedValue(0), findMany },
      } as unknown as Prisma.TransactionClient);

      await query.findAll(
        {
          vehicleType: 'MOTO',
          licensingCollectionPending: true,
          page: 1,
          limit: 50,
        },
        actor,
      );
      const and = findMany.mock.calls[0]?.[0].where
        ?.AND as Prisma.operacionesWhereInput[];
      expect(and).toContainEqual({ id: { in: ['pending-1'] } });
      const sql = queryRaw.mock.calls[0][0].strings.join('?');
      expect(sql).toContain(`o."modalidad_patentamiento" = 'PAGA_CLIENTE'`);
      expect(sql).toContain(
        `o."patente_recibida_en" IS NOT NULL OR u."patente" IS NOT NULL`,
      );
      expect(sql).toContain(`i."estado_registro" <> 'ANULADO'`);
    });

    it('fase 5: counts overdue plates and pending collections for the dashboard', async () => {
      const count = jest
        .fn<Promise<number>, [Prisma.operacionesCountArgs]>()
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2);
      const query = queryService({
        $queryRaw: jest
          .fn()
          .mockResolvedValue([{ id: 'pending-1' }, { id: 'pending-2' }]),
        operaciones: { count },
      } as unknown as Prisma.TransactionClient);
      const branchActor: AuthenticatedUser = {
        ...actor,
        role: { ...actor.role, permissions: [] },
        branch: { id: 'branch-1', code: 'SM', name: 'San Miguel' },
      };

      await expect(
        query.licensingAlerts(branchActor, BranchScope.forActor(branchActor)),
      ).resolves.toEqual({ overdue: 3, receivedPendingCollection: 2 });
      const [overdueArgs, pendingArgs] = count.mock.calls.map(
        (call) => call[0].where?.AND as Prisma.operacionesWhereInput[],
      );
      expect(overdueArgs?.[0]).toMatchObject({
        organizacion_id: organizationId,
        sucursal_id: { in: ['branch-1'] },
      });
      expect(overdueArgs?.[1]).toMatchObject({ patente_recibida_en: null });
      expect(pendingArgs?.[1]).toEqual({
        id: { in: ['pending-1', 'pending-2'] },
      });
    });
  });

  describe('fase 4 - ingresos vinculados y seguimiento', () => {
    const componentId = 'd0c0a0b0-0000-4000-8000-00000000c001';
    const tradeInComponentId = 'd0c0a0b0-0000-4000-8000-00000000c002';
    const accountId = 'b1c2d3e4-0000-4000-8000-000000000001';
    const idempotencyKey = 'c1c2d3e4-0000-4000-8000-000000000009';
    const recipientId = 'e0e0e0e0-0000-4000-8000-0000000000e1';
    const actorPersonnelId = '11b5de9b-9bc2-4777-bb78-9c7267b73aca';

    function planOperation(overrides = {}) {
      return {
        ...completeOperation('APROBADA'),
        numero_boleto: 'B-0042',
        incluye_casco: false,
        modalidad_patentamiento: null,
        importe_patentamiento: null,
        patente_estimada_desde: null,
        patente_estimada_hasta: null,
        ingresos_financieros: [],
        componentes_pago_operacion: [
          {
            id: componentId,
            tipo_componente: 'EFECTIVO',
            importe_esperado: new Prisma.Decimal(60),
            fecha_vencimiento: null,
            financiera_id: null,
            consulta_crediticia_id: null,
            vehiculo_tomado_id: null,
            estado_pago: 'PENDIENTE',
            notas: null,
          },
          {
            id: tradeInComponentId,
            tipo_componente: 'TOMA_PARTE_PAGO',
            importe_esperado: new Prisma.Decimal(40),
            fecha_vencimiento: null,
            financiera_id: null,
            consulta_crediticia_id: null,
            vehiculo_tomado_id: 'aaaaaaaa-0000-4000-8000-000000000001',
            estado_pago: 'PENDIENTE',
            notas: null,
          },
        ],
        ...overrides,
      };
    }

    function collectionSetup(collectedBefore: string[] = []) {
      const current = planOperation();
      const incomeCreate = jest
        .fn<Promise<unknown>, [Prisma.ingresosCreateArgs]>()
        .mockResolvedValue({ id: 'income-new' });
      const incomeUpdate = jest.fn().mockResolvedValue({});
      const componentUpdate = jest.fn().mockResolvedValue({});
      const registerEntityMovement = jest.fn().mockResolvedValue({});
      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: { findFirst: jest.fn().mockResolvedValue(current) },
        movimientos_caja: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue(
            collectedBefore.map((amount) => ({
              importe: new Prisma.Decimal(amount),
            })),
          ),
        },
        tipos_ingreso: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ nombre: 'Cobro de operación' }),
        },
        personal: {
          findFirst: jest.fn().mockResolvedValue({ id: recipientId }),
        },
        componentes_pago_operacion: {
          findFirst: jest.fn().mockResolvedValue({
            importe_esperado: new Prisma.Decimal(60),
            estado_pago: 'PENDIENTE',
          }),
          update: componentUpdate,
        },
        ingresos: { create: incomeCreate, update: incomeUpdate },
      } as unknown as Prisma.TransactionClient;
      const cash = {
        registerEntityMovement,
        settledAmount: jest.fn().mockResolvedValue(new Prisma.Decimal(60)),
        actorPersonnelId: jest.fn().mockResolvedValue(actorPersonnelId),
      } as unknown as CashService;
      return {
        sales: service(transaction, cash),
        incomeCreate,
        registerEntityMovement,
        componentUpdate,
      };
    }

    it('creates the income linked to operation, client, ticket and component', async () => {
      const setup = collectionSetup();

      await setup.sales.collectPaymentComponent(
        operationId,
        componentId,
        {
          idempotencyKey,
          accountId,
          amount: '60',
          collectionDate: '2026-09-20',
          handoverToId: recipientId,
        },
        actor,
      );

      expect(setup.incomeCreate.mock.calls[0]?.[0].data).toMatchObject({
        operacion_id: operationId,
        cliente_id: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
        componente_pago_id: componentId,
        referencia: 'B-0042',
        tipo_original: 'Cobro de operación',
        importe: new Prisma.Decimal(60),
        medio_pago: 'EFECTIVO',
        cobrado_por_personal_id: actorPersonnelId,
        rendido_a_personal_id: recipientId,
        estado_rendicion: 'PENDIENTE_RENDICION',
      });
      expect(setup.registerEntityMovement).toHaveBeenCalledWith(
        expect.anything(),
        actor,
        organizationId,
        'ARS',
        expect.objectContaining({ amount: '60.00', reference: 'B-0042' }),
        { ingreso_id: 'income-new' },
        'INGRESO',
        'CREDITO',
      );
    });

    it('requires the handover recipient when the component is cash', async () => {
      const setup = collectionSetup();

      await expect(
        setup.sales.collectPaymentComponent(
          operationId,
          componentId,
          { idempotencyKey, accountId, amount: '60' },
          actor,
        ),
      ).rejects.toMatchObject({
        response: { code: 'HANDOVER_RECIPIENT_REQUIRED' },
      });
      expect(setup.incomeCreate).not.toHaveBeenCalled();
    });

    it('does not collect more than the component amount', async () => {
      const setup = collectionSetup(['50']);

      await expect(
        setup.sales.collectPaymentComponent(
          operationId,
          componentId,
          {
            idempotencyKey,
            accountId,
            amount: '20',
            paymentMethod: 'TRANSFERENCIA_BANCARIA',
          },
          actor,
        ),
      ).rejects.toMatchObject({ response: { code: 'OVERPAYMENT' } });
      expect(setup.incomeCreate).not.toHaveBeenCalled();
    });

    it('does not collect trade-in components', async () => {
      const setup = collectionSetup();

      await expect(
        setup.sales.collectPaymentComponent(
          operationId,
          tradeInComponentId,
          { idempotencyKey, accountId, amount: '40' },
          actor,
        ),
      ).rejects.toMatchObject({
        response: { code: 'COMPONENT_NOT_COLLECTIBLE' },
      });
    });

    it('blocks replacing a plan with component incomes', async () => {
      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: {
          findFirst: jest.fn().mockResolvedValue(planOperation()),
        },
        cobranzas: { count: jest.fn().mockResolvedValue(0) },
        ingresos: { count: jest.fn().mockResolvedValue(1) },
      } as unknown as Prisma.TransactionClient;

      await expect(
        service(transaction).replacePaymentPlan(
          operationId,
          {
            expectedVersion: 2,
            components: [{ type: 'EFECTIVO', amount: 100 }],
          },
          actor,
        ),
      ).rejects.toThrow(
        new ConflictException(
          'Payment plan with collections cannot be replaced',
        ),
      );
    });

    it('builds the tracking row with collected, balance and pending cash', async () => {
      const movement = (amount: string) => ({
        importe: new Prisma.Decimal(amount),
        cuentas_caja: {
          id: accountId,
          codigo: 'CAJA',
          nombre: 'Caja',
          tipo_cuenta: 'CAJA',
        },
        personal: { id: actorPersonnelId, nombre_completo: 'Vendedor' },
      });
      const income = (overrides: Record<string, unknown>) => ({
        id: 'income',
        operacion_id: operationId,
        fecha_ingreso: new Date('2026-09-20T00:00:00.000Z'),
        tipo_original: 'Cobro de operación',
        componente_pago_id: componentId,
        medio_pago: 'EFECTIVO',
        importe: new Prisma.Decimal(30),
        referencia: 'B-0042',
        estado_rendicion: 'PENDIENTE_RENDICION',
        rendicion_confirmada_en: null,
        version_fila: 0,
        personal: { id: actorPersonnelId, nombre_completo: 'Vendedor' },
        rendido_a: { id: recipientId, nombre_completo: 'Lucas' },
        rendicion_confirmada_por: null,
        movimientos_caja: [movement('30')],
        ...overrides,
      });
      const incomes = [
        income({ id: 'income-1' }),
        income({
          id: 'income-2',
          estado_rendicion: 'RENDIDO',
          rendicion_confirmada_en: new Date('2026-09-21T12:00:00.000Z'),
          rendicion_confirmada_por: {
            id: recipientId,
            nombre_completo: 'Lucas',
          },
        }),
        income({
          id: 'income-patente',
          tipo_original: 'Patente',
          componente_pago_id: null,
          medio_pago: 'TRANSFERENCIA_BANCARIA',
          estado_rendicion: null,
          rendido_a: null,
          importe: new Prisma.Decimal(85),
          movimientos_caja: [movement('85')],
        }),
      ];
      const findMany = jest.fn().mockResolvedValue([planOperation()]);
      const transaction = {
        operaciones: {
          count: jest.fn().mockResolvedValue(1),
          findMany,
        },
        ingresos: { findMany: jest.fn().mockResolvedValue(incomes) },
        operacion_creditos: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as Prisma.TransactionClient;

      const result = await queryService(transaction).tracking(
        { vehicleType: 'MOTO', page: 1, limit: 50 },
        actor,
      );

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        ticketNumber: 'B-0042',
        client: { fullName: 'Cliente' },
        seller: { fullName: 'Vendedor' },
        agreedPrice: '100',
        collectedAmount: '60',
        balanceAmount: '40',
        pendingHandoverAmount: '30',
        pendingHandoverCount: 1,
        fulfillment: { status: 'PENDIENTE_ASIGNACION' },
      });
      expect(result.items[0]?.paymentComponents[0]).toMatchObject({
        id: componentId,
        collectedAmount: '60',
        balanceAmount: '0',
        collectible: true,
      });
      expect(result.items[0]?.paymentComponents[1]).toMatchObject({
        collectible: false,
      });
      expect(result.items[0]?.incomes).toHaveLength(3);
      expect(result.items[0]?.incomes[2]).toMatchObject({
        isLicensing: true,
        handover: null,
      });
    });

    it('filters the grid by cash still pending handover', async () => {
      const candidates = [
        { id: operationId, precio_acordado: new Prisma.Decimal(100) },
        {
          id: 'f0000000-0000-4000-8000-000000000002',
          precio_acordado: new Prisma.Decimal(100),
        },
      ];
      const findMany = jest
        .fn<Promise<unknown[]>, [Prisma.operacionesFindManyArgs]>()
        .mockResolvedValueOnce(candidates)
        .mockResolvedValueOnce([]);
      const transaction = {
        operaciones: { findMany },
        operacion_creditos: { findMany: jest.fn().mockResolvedValue([]) },
        ingresos: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'income-1',
              operacion_id: 'f0000000-0000-4000-8000-000000000002',
              tipo_original: 'Cobro de operación',
              estado_rendicion: 'PENDIENTE_RENDICION',
              importe: new Prisma.Decimal(10),
              movimientos_caja: [{ importe: new Prisma.Decimal(10) }],
            },
          ]),
        },
      } as unknown as Prisma.TransactionClient;

      const result = await queryService(transaction).tracking(
        { vehicleType: 'MOTO', page: 1, limit: 50, withPendingCash: true },
        actor,
      );

      expect(result.total).toBe(1);
      expect(findMany.mock.calls[1]?.[0]).toMatchObject({
        where: { id: { in: ['f0000000-0000-4000-8000-000000000002'] } },
      });
    });
  });

  describe('fase 4 - financieras y crédito propio', () => {
    const financingId = 'd0c0a0b0-0000-4000-8000-00000000f001';
    const ownCreditId = 'd0c0a0b0-0000-4000-8000-00000000f002';
    const personnelId = '11b5de9b-9bc2-4777-bb78-9c7267b73aca';

    function financing(overrides: Record<string, unknown> = {}) {
      return {
        id: financingId,
        tipo_componente: 'FINANCIACION',
        importe_esperado: new Prisma.Decimal(1000),
        fecha_vencimiento: null,
        financiera_id: 'fin-1',
        consulta_crediticia_id: null,
        vehiculo_tomado_id: null,
        estado_pago: 'PENDIENTE',
        notas: null,
        financiera_pago_informado_en: null,
        financiera_pago_notas: null,
        financiera_pago_informado_por: null,
        financieras_componentes_pago_operacion_financiera_id_organizacion_idTofinancieras:
          {
            id: 'fin-1',
            razon_social: 'Credicuotas',
            es_credito_propio: false,
          },
        ...overrides,
      };
    }

    function operationWith(components: unknown[]) {
      return {
        ...completeOperation('APROBADA'),
        precio_acordado: new Prisma.Decimal(1500),
        numero_boleto: 'B-0077',
        incluye_casco: false,
        modalidad_patentamiento: null,
        importe_patentamiento: null,
        patente_estimada_desde: null,
        patente_estimada_hasta: null,
        ingresos_financieros: [],
        componentes_pago_operacion: components,
      };
    }

    function markSetup(component: ReturnType<typeof financing>) {
      const componentUpdate = jest.fn().mockResolvedValue({});
      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: {
          findFirst: jest.fn().mockResolvedValue(operationWith([component])),
        },
        componentes_pago_operacion: {
          update: componentUpdate,
          findFirst: jest.fn().mockResolvedValue({
            importe_esperado: new Prisma.Decimal(1000),
            estado_pago: 'PENDIENTE',
            financiera_pago_informado_en: new Date(),
          }),
        },
        movimientos_caja: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as Prisma.TransactionClient;
      const cash = {
        actorPersonnelId: jest.fn().mockResolvedValue(personnelId),
      } as unknown as CashService;
      return { sales: service(transaction, cash), componentUpdate };
    }

    it('marks that the financiera paid, without an amount, and closes the component', async () => {
      const setup = markSetup(financing());

      await setup.sales.markFinancingPayment(
        operationId,
        financingId,
        { notes: 'Liquidación semanal 12' },
        actor,
      );

      expect(setup.componentUpdate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: {
            financiera_pago_informado_en: expect.any(Date) as Date,
            financiera_pago_informado_por_personal_id: personnelId,
            financiera_pago_notas: 'Liquidación semanal 12',
          },
        }),
      );
      // syncComponentPaymentStatus keeps it PAGADO whatever net came in.
      expect(setup.componentUpdate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ data: { estado_pago: 'PAGADO' } }),
      );
    });

    it('does not mark twice nor own-credit financing', async () => {
      await expect(
        markSetup(
          financing({ financiera_pago_informado_en: new Date() }),
        ).sales.markFinancingPayment(operationId, financingId, {}, actor),
      ).rejects.toMatchObject({
        response: { code: 'FINANCING_ALREADY_MARKED' },
      });

      await expect(
        markSetup(
          financing({
            financieras_componentes_pago_operacion_financiera_id_organizacion_idTofinancieras:
              {
                id: 'own',
                razon_social: 'Crédito personal',
                es_credito_propio: true,
              },
          }),
        ).sales.markFinancingPayment(operationId, financingId, {}, actor),
      ).rejects.toMatchObject({
        response: { code: 'OWN_CREDIT_COLLECTED_BY_INSTALLMENTS' },
      });
    });

    it('reverts the mark and recomputes the status from collections', async () => {
      const setup = markSetup(
        financing({ financiera_pago_informado_en: new Date('2026-09-20') }),
      );

      await setup.sales.revertFinancingPayment(
        operationId,
        financingId,
        { reason: 'Se marcó en la operación equivocada' },
        actor,
      );

      expect(setup.componentUpdate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: {
            financiera_pago_informado_en: null,
            financiera_pago_informado_por_personal_id: null,
            financiera_pago_notas: null,
          },
        }),
      );
    });

    it('closes the balance with the net when the financiera paid, and leaves own credit to installments', () => {
      const income = {
        componente_pago_id: financingId,
        cuota_credito_id: null,
        tipo_original: 'Cobro de operación',
        estado_rendicion: null,
        movimientos_caja: [{ importe: new Prisma.Decimal(920) }],
      };
      const installmentIncome = {
        componente_pago_id: null,
        cuota_credito_id: 'cuota-1',
        tipo_original: 'Cuota crédito',
        estado_rendicion: null,
        movimientos_caja: [{ importe: new Prisma.Decimal(120) }],
      };
      const cash = {
        componente_pago_id: 'cash',
        cuota_credito_id: null,
        tipo_original: 'Cobro de operación',
        estado_rendicion: null,
        movimientos_caja: [{ importe: new Prisma.Decimal(300) }],
      };
      const components = [
        { ...financing(), financiera_pago_informado_en: new Date() },
        {
          ...financing({ id: ownCreditId }),
          importe_esperado: new Prisma.Decimal(200),
          financieras_componentes_pago_operacion_financiera_id_organizacion_idTofinancieras:
            { es_credito_propio: true },
        },
        {
          id: 'cash',
          tipo_componente: 'EFECTIVO',
          importe_esperado: new Prisma.Decimal(300),
          estado_pago: 'PAGADO',
          financiera_pago_informado_en: null,
          financieras_componentes_pago_operacion_financiera_id_organizacion_idTofinancieras:
            null,
        },
      ];

      const totals = trackingTotals(
        new Prisma.Decimal(1500),
        [income, installmentIncome, cash] as never,
        components as never,
      );

      // 920 net + 300 cash; the installment (with interest) stays apart.
      expect(totals.collected.toString()).toBe('1220');
      // 80 the financiera kept + 200 own credit collected by installments.
      expect(totals.waived.toString()).toBe('280');
      expect(totals.balance.toString()).toBe('0');
    });

    it('keeps the financing in the balance while the financiera has not paid', () => {
      const totals = trackingTotals(new Prisma.Decimal(1000), [], [
        financing(),
      ] as never);
      expect(totals.balance.toString()).toBe('1000');
    });

    it('rejects collecting own-credit financing directly', async () => {
      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: {
          findFirst: jest.fn().mockResolvedValue(
            operationWith([
              financing({
                financieras_componentes_pago_operacion_financiera_id_organizacion_idTofinancieras:
                  {
                    id: 'own',
                    razon_social: 'Crédito personal',
                    es_credito_propio: true,
                  },
              }),
            ]),
          ),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        service(transaction).collectPaymentComponent(
          operationId,
          financingId,
          {
            idempotencyKey: 'c1c2d3e4-0000-4000-8000-000000000031',
            accountId: 'b1c2d3e4-0000-4000-8000-000000000001',
            amount: '100',
          },
          actor,
        ),
      ).rejects.toMatchObject({
        response: { code: 'OWN_CREDIT_COLLECTED_BY_INSTALLMENTS' },
      });
    });
  });
});

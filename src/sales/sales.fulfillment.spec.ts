import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedAuditEvent } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CashService } from '../cash/cash.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SalesService } from './sales.service';

// Fase 3: the seller sells version + condition; the administrativa assigns a
// stock unit or orders it from a supplier chosen per request.
describe('SalesService fulfillment (fase 3)', () => {
  const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
  const branchId = '84e778cc-7616-4792-b6db-d89f100bb6f1';
  const versionId = '4de88c4c-3382-4f9b-ae60-98147159c977';
  const operationId = '7d5cc401-544e-4651-9bd6-52495887fecd';
  const otherOperationId = '8e6dd512-6396-4a0c-9e2b-63a50e2b0f11';
  const unitId = 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2';
  const supplierA = '0a44e64e-351e-4d9b-9150-5f20e34e4d61';
  const supplierB = '1b55f75f-462f-4e0c-a261-6f31f45f5e72';
  const personnelId = '11b5de9b-9bc2-4777-bb78-9c7267b73aca';

  const administrativa: AuthenticatedUser = {
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
      permissions: [
        'ventas.asignar_unidad',
        'abastecimiento.gestionar',
        'inventario.gestionar',
      ],
    },
    branch: { id: branchId, code: 'SM', name: 'San Miguel' },
  };

  type Supply = {
    id: string;
    estado: string;
    unidad_vehiculo_recibida_id?: string | null;
    proveedor_id?: string;
  };

  function operationRecord(
    overrides: Record<string, unknown> = {},
    supplies: Supply[] = [],
  ) {
    return {
      id: operationId,
      numero_operacion: BigInt(42),
      organizacion_id: organizationId,
      sucursal_id: branchId,
      cliente_id: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
      version_id: versionId,
      condicion: 'NUEVO',
      unidad_vehiculo_id: null,
      fecha_operacion: new Date('2026-09-25T00:00:00.000Z'),
      estado_operacion: 'PENDIENTE_APROBACION',
      estado_entrega: 'NO_PROGRAMADA',
      estado_documentacion: 'NO_INICIADA',
      documentacion_entregada_en: null,
      debe: 'NO',
      precio_lista: new Prisma.Decimal(100),
      precio_minimo: new Prisma.Decimal(90),
      precio_acordado: new Prisma.Decimal(100),
      moneda: 'ARS',
      plataforma_pago: 'EFECTIVO',
      monto_credito: null,
      respaldo_garante: null,
      numero_boleto: null,
      color_deseado: 'Rojo',
      incluye_casco: false,
      modalidad_patentamiento: 'BONIFICADA',
      importe_patentamiento: null,
      patente_estimada_desde: null,
      patente_estimada_hasta: null,
      notas: null,
      version_fila: 3,
      creado_en: new Date('2026-09-25T10:00:00.000Z'),
      actualizado_en: new Date('2026-09-25T10:00:00.000Z'),
      clientes: {
        id: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
        tipo_documento: 'DNI',
        numero_documento: '12345678',
        nombre_completo: 'Cliente',
        telefono: null,
        activo: true,
      },
      sucursales: { id: branchId, codigo: 'SM', nombre: 'San Miguel' },
      versiones_vehiculos: {
        id: versionId,
        nombre: '110 S',
        modelos_vehiculos: {
          id: 'model-1',
          nombre: 'Wave',
          tipo_vehiculo: 'MOTO',
          marcas_vehiculos: { id: 'brand-1', nombre: 'Honda' },
        },
      },
      unidades_vehiculos: null,
      asignaciones_personal_operacion: [],
      reservas_stock: [],
      aprobaciones_operacion: [],
      componentes_pago_operacion: [],
      obligaciones_operacion: [],
      vehiculos_tomados_parte_pago: [],
      solicitudes_abastecimiento: supplies.map((supply) => ({
        referencia_proveedor: null,
        notas: null,
        solicitado_en: new Date('2026-09-25T12:00:00.000Z'),
        pedido_en: new Date('2026-09-25T12:00:00.000Z'),
        despachado_en: null,
        recibido_en: null,
        unidad_vehiculo_recibida_id: null,
        proveedores: {
          id: supply.proveedor_id ?? supplierA,
          razon_social: supply.proveedor_id === supplierB ? 'Prov B' : 'Prov A',
        },
        sucursales: { id: branchId, codigo: 'SM', nombre: 'San Miguel' },
        ...supply,
      })),
      personal: null,
      ingresos_financieros: [],
      ...overrides,
    };
  }

  function salesService(transaction: Record<string, unknown>) {
    const tx = {
      conceptos_pago_vehiculo: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      pagos_vehiculo: { findMany: jest.fn().mockResolvedValue([]) },
      personal: { findFirst: jest.fn().mockResolvedValue({ id: personnelId }) },
      ...transaction,
    } as unknown as Prisma.TransactionClient;
    const execute = jest
      .fn<
        Promise<unknown>,
        [
          AuthenticatedAuditEvent,
          (client: Prisma.TransactionClient) => Promise<unknown>,
        ]
      >()
      .mockImplementation((_event, work) => work(tx));
    return new SalesService(
      {} as PrismaService,
      { execute } as unknown as AuditService,
      {} as CashService,
    );
  }

  describe('sale without stock', () => {
    it('creates the operation with version, condition and desired color only', async () => {
      const operationCreate = jest
        .fn<Promise<unknown>, [Prisma.operacionesCreateArgs]>()
        .mockResolvedValue({ id: operationId });
      const reservationCreate = jest.fn();
      const supplyCreate = jest.fn();
      const sales = salesService({
        $queryRaw: jest.fn().mockResolvedValue([{ exists: true }]),
        sucursales: {
          findFirst: jest.fn().mockResolvedValue({ id: branchId }),
        },
        clientes: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'client', activo: true }),
        },
        versiones_vehiculos: {
          findUnique: jest.fn().mockResolvedValue({
            alcance: 'GLOBAL',
            organizacion_propietaria_id: null,
            catalogo_organizaciones: [],
            modelos_vehiculos: { tipo_vehiculo: 'MOTO' },
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
          findFirst: jest
            .fn()
            .mockResolvedValue(
              operationRecord({ estado_operacion: 'BORRADOR' }),
            ),
        },
        asignaciones_personal_operacion: {
          create: jest.fn().mockResolvedValue({}),
        },
        reservas_stock: { create: reservationCreate },
        solicitudes_abastecimiento: { create: supplyCreate },
      });

      const result = await sales.create(
        {
          vehicleType: 'MOTO',
          branchId,
          clientId: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
          versionId,
          condition: 'NUEVO',
          color: 'Rojo',
          agreedPrice: 100,
          paymentPlatform: 'EFECTIVO',
          licensingMode: 'BONIFICADA',
        },
        administrativa,
      );

      expect(operationCreate.mock.calls[0]?.[0].data).toMatchObject({
        version_id: versionId,
        condicion: 'NUEVO',
        color_deseado: 'Rojo',
      });
      expect(reservationCreate).not.toHaveBeenCalled();
      expect(supplyCreate).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        requestedColor: 'Rojo',
        fulfillment: { status: 'PENDIENTE_ASIGNACION', supplier: null },
      });
    });

    it('submits and approves an operation that has no unit yet', async () => {
      const update = jest
        .fn<Promise<unknown>, [Prisma.operacionesUpdateArgs]>()
        .mockResolvedValue({});
      const draft = operationRecord({ estado_operacion: 'BORRADOR' });
      const sales = salesService({
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: {
          findFirst: jest.fn().mockResolvedValue(draft),
          update,
        },
        reservas_stock: { findFirst: jest.fn().mockResolvedValue(null) },
        clientes: { findFirst: jest.fn().mockResolvedValue({ id: 'client' }) },
        politicas_precios_vehiculos: {
          findFirst: jest.fn().mockResolvedValue({
            precio_lista: new Prisma.Decimal(100),
            precio_minimo: new Prisma.Decimal(90),
            moneda: 'ARS',
          }),
        },
        solicitudes_abastecimiento: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      });

      await sales.submit(operationId, { expectedVersion: 3 }, administrativa);
      expect(update.mock.calls[0]?.[0].data).toMatchObject({
        estado_operacion: 'APROBADA',
      });
    });

    it('does not close an operation without a physical unit', async () => {
      const sales = salesService({
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: {
          findFirst: jest
            .fn()
            .mockResolvedValue(
              operationRecord({ estado_operacion: 'APROBADA' }),
            ),
        },
      });
      await expect(
        sales.close(operationId, { expectedVersion: 3 }, administrativa),
      ).rejects.toMatchObject({
        response: { code: 'OPERATION_UNIT_REQUIRED' },
      });
    });
  });

  describe('sale source by vehicle type and condition', () => {
    function createService() {
      const operationCreate = jest.fn();
      const sales = salesService({
        $queryRaw: jest.fn().mockResolvedValue([{ exists: true }]),
        sucursales: {
          findFirst: jest.fn().mockResolvedValue({ id: branchId }),
        },
        clientes: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'client', activo: true }),
        },
        versiones_vehiculos: {
          findUnique: jest.fn().mockResolvedValue({
            alcance: 'GLOBAL',
            organizacion_propietaria_id: null,
            catalogo_organizaciones: [],
            modelos_vehiculos: { tipo_vehiculo: 'AUTO' },
          }),
        },
        operaciones: { create: operationCreate },
      });
      return { sales, operationCreate };
    }
    const base = {
      branchId,
      clientId: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
      versionId,
      agreedPrice: 100,
      paymentPlatform: 'EFECTIVO' as const,
      licensingMode: 'BONIFICADA' as const,
    };

    it('requires a stock unit for a used motorcycle', async () => {
      const { sales, operationCreate } = createService();
      await expect(
        sales.create(
          { ...base, vehicleType: 'MOTO', condition: 'USADO' },
          administrativa,
        ),
      ).rejects.toMatchObject({
        response: { code: 'USED_MOTO_REQUIRES_STOCK_UNIT' },
      });
      expect(operationCreate).not.toHaveBeenCalled();
    });

    it('keeps cars on stock unit or supplier availability', async () => {
      const { sales, operationCreate } = createService();
      await expect(
        sales.create(
          { ...base, vehicleType: 'AUTO', condition: 'NUEVO' },
          administrativa,
        ),
      ).rejects.toThrow(
        'Exactly one of unitId or supplierAvailabilityId is required',
      );
      expect(operationCreate).not.toHaveBeenCalled();
    });

    it('still requires a reservation or supply request to submit a car', async () => {
      const draft = operationRecord({
        estado_operacion: 'BORRADOR',
        versiones_vehiculos: {
          id: versionId,
          nombre: 'Drive',
          modelos_vehiculos: {
            id: 'model-2',
            nombre: 'Cronos',
            tipo_vehiculo: 'AUTO',
            marcas_vehiculos: { id: 'brand-2', nombre: 'Fiat' },
          },
        },
      });
      const sales = salesService({
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: { findFirst: jest.fn().mockResolvedValue(draft) },
        reservas_stock: { findFirst: jest.fn().mockResolvedValue(null) },
        solicitudes_abastecimiento: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      });
      await expect(
        sales.submit(operationId, { expectedVersion: 3 }, administrativa),
      ).rejects.toThrow(
        'The operation requires an active stock reservation or supply request',
      );
    });

    it('does not use the assignment tray for cars', async () => {
      const carOperation = operationRecord({
        versiones_vehiculos: {
          id: versionId,
          nombre: 'Drive',
          modelos_vehiculos: {
            id: 'model-2',
            nombre: 'Cronos',
            tipo_vehiculo: 'AUTO',
            marcas_vehiculos: { id: 'brand-2', nombre: 'Fiat' },
          },
        },
      });
      const sales = salesService({
        $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
        operaciones: { findFirst: jest.fn().mockResolvedValue(carOperation) },
      });
      await expect(
        sales.requestSupply(
          operationId,
          { expectedVersion: 3, supplierId: supplierA },
          administrativa,
        ),
      ).rejects.toMatchObject({
        response: { code: 'ASSIGNMENT_ONLY_FOR_MOTOS' },
      });
    });
  });

  describe('assignment from stock', () => {
    function stockTransaction(current = operationRecord()) {
      const unitUpdate = jest
        .fn<Promise<unknown>, [Prisma.unidades_vehiculosUpdateArgs]>()
        .mockResolvedValue({});
      const reservationCreate = jest
        .fn<Promise<unknown>, [Prisma.reservas_stockCreateArgs]>()
        .mockResolvedValue({});
      const operationUpdate = jest
        .fn<Promise<unknown>, [Prisma.operacionesUpdateArgs]>()
        .mockResolvedValue({});
      const sales = salesService({
        $queryRaw: jest.fn().mockResolvedValue([
          {
            id: unitId,
            version_id: versionId,
            condicion: 'NUEVO',
            sucursal_id: branchId,
            estado_inventario: 'EN_STOCK',
          },
        ]),
        operaciones: {
          findFirst: jest.fn().mockResolvedValue(current),
          update: operationUpdate,
        },
        reservas_stock: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: reservationCreate,
        },
        unidades_vehiculos: {
          findFirst: jest.fn().mockResolvedValue({
            id: unitId,
            version_id: versionId,
            condicion: 'NUEVO',
            sucursal_id: branchId,
            estado_inventario: 'EN_STOCK',
          }),
          update: unitUpdate,
        },
        movimientos_inventario: { create: jest.fn().mockResolvedValue({}) },
      });
      return { sales, unitUpdate, reservationCreate, operationUpdate };
    }

    it('reserves the stock unit, confirms chassis and engine and keeps the status', async () => {
      const setup = stockTransaction();
      await setup.sales.assignUnit(
        operationId,
        {
          expectedVersion: 3,
          unitId,
          vin: ' 9C2JC4110AR000123 ',
          engineNumber: 'jc41e-123 456',
        },
        administrativa,
      );

      expect(setup.unitUpdate.mock.calls[0]?.[0].data).toMatchObject({
        vin_mostrado: '9C2JC4110AR000123',
        vin_normalizado: '9C2JC4110AR000123',
        numero_motor: 'jc41e-123 456',
        motor_normalizado: 'JC41E123456',
      });
      const reservation = setup.reservationCreate.mock.calls[0]?.[0].data;
      expect(reservation).toMatchObject({
        operacion_id: operationId,
        unidad_vehiculo_id: unitId,
      });
      const days =
        ((reservation?.vence_en as Date).getTime() - Date.now()) /
        (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(29);
      expect(setup.unitUpdate.mock.calls[1]?.[0].data).toEqual({
        estado_inventario: 'RESERVADO',
      });
      const operationData = setup.operationUpdate.mock.calls.map(
        (call) => call[0].data,
      );
      expect(operationData).toContainEqual({ unidad_vehiculo_id: unitId });
      expect(operationData).toContainEqual({ version_fila: { increment: 1 } });
      expect(operationData.some((data) => 'estado_operacion' in data)).toBe(
        false,
      );
    });

    it('needs inventario.gestionar to edit the chassis or engine number', async () => {
      const setup = stockTransaction();
      await expect(
        setup.sales.assignUnit(
          operationId,
          { expectedVersion: 3, unitId, engineNumber: 'X1' },
          {
            ...administrativa,
            role: {
              ...administrativa.role,
              permissions: ['ventas.asignar_unidad'],
            },
          },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(setup.reservationCreate).not.toHaveBeenCalled();
    });

    it('rejects assignment while a supplier order is in progress or a unit exists', async () => {
      const ordered = stockTransaction(
        operationRecord({}, [{ id: 'supply-1', estado: 'PEDIDO' }]),
      );
      await expect(
        ordered.sales.assignUnit(
          operationId,
          { expectedVersion: 3, unitId },
          administrativa,
        ),
      ).rejects.toMatchObject({
        response: { code: 'SUPPLY_REQUEST_IN_PROGRESS' },
      });

      const assigned = stockTransaction(
        operationRecord({ unidad_vehiculo_id: unitId }),
      );
      await expect(
        assigned.sales.assignUnit(
          operationId,
          { expectedVersion: 3, unitId },
          administrativa,
        ),
      ).rejects.toMatchObject({
        response: { code: 'OPERATION_ALREADY_HAS_UNIT' },
      });

      const cancelled = stockTransaction(
        operationRecord({ estado_operacion: 'CANCELADA' }),
      );
      await expect(
        cancelled.sales.assignUnit(
          operationId,
          { expectedVersion: 3, unitId },
          administrativa,
        ),
      ).rejects.toMatchObject({
        response: { code: 'OPERATION_NOT_ASSIGNABLE' },
      });
    });
  });

  describe('orders to suppliers', () => {
    function orderTransaction(current: ReturnType<typeof operationRecord>) {
      const supplyCreate = jest
        .fn<Promise<unknown>, [Prisma.solicitudes_abastecimientoCreateArgs]>()
        .mockResolvedValue({});
      const reservationUpdate = jest.fn().mockResolvedValue({});
      const sales = salesService({
        $queryRaw: jest
          .fn()
          .mockResolvedValue([{ id: current.id, exists: true }]),
        operaciones: {
          findFirst: jest.fn().mockResolvedValue(current),
          update: jest.fn().mockResolvedValue({}),
        },
        proveedores: {
          findFirst: jest
            .fn()
            .mockImplementation(({ where }: { where: { id: string } }) =>
              Promise.resolve({ id: where.id }),
            ),
        },
        reservas_stock: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: reservationUpdate,
        },
        solicitudes_abastecimiento: { create: supplyCreate },
      });
      return { sales, supplyCreate, reservationUpdate };
    }

    it('orders the same version from supplier A and from supplier B', async () => {
      const first = orderTransaction(operationRecord());
      await first.sales.requestSupply(
        operationId,
        { expectedVersion: 3, supplierId: supplierA, estimatedCost: 1500000 },
        administrativa,
      );
      const second = orderTransaction(
        operationRecord({ id: otherOperationId, color_deseado: null }),
      );
      await second.sales.requestSupply(
        otherOperationId,
        { expectedVersion: 3, supplierId: supplierB, color: 'Negro' },
        administrativa,
      );

      expect(first.supplyCreate.mock.calls[0]?.[0].data).toMatchObject({
        operacion_id: operationId,
        proveedor_id: supplierA,
        version_id: versionId,
        condicion: 'NUEVO',
        sucursal_llegada_id: branchId,
        estado: 'PEDIDO',
        color: 'Rojo',
        costo_estimado: 1500000,
      });
      expect(first.supplyCreate.mock.calls[0]?.[0].data).not.toHaveProperty(
        'disponibilidad_proveedor_id',
      );
      expect(second.supplyCreate.mock.calls[0]?.[0].data).toMatchObject({
        operacion_id: otherOperationId,
        proveedor_id: supplierB,
        version_id: versionId,
        estado: 'PEDIDO',
      });
    });

    it('does not order twice for the same operation', async () => {
      const setup = orderTransaction(
        operationRecord({}, [{ id: 'supply-1', estado: 'EN_TRANSITO' }]),
      );
      await expect(
        setup.sales.requestSupply(
          operationId,
          { expectedVersion: 3, supplierId: supplierB },
          administrativa,
        ),
      ).rejects.toMatchObject({
        response: { code: 'SUPPLY_REQUEST_IN_PROGRESS' },
      });
      expect(setup.supplyCreate).not.toHaveBeenCalled();
    });

    it('releases a legacy provider-availability reservation when ordering', async () => {
      const setup = orderTransaction(operationRecord());
      (
        setup.sales as unknown as {
          activeReservation: (...args: unknown[]) => Promise<unknown>;
        }
      ).activeReservation = jest.fn().mockResolvedValue({
        id: 'legacy-reservation',
        disponibilidad_proveedor_id: 'availability-1',
      });
      await setup.sales.requestSupply(
        operationId,
        { expectedVersion: 3, supplierId: supplierA },
        administrativa,
      );
      expect(setup.reservationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'legacy-reservation' },
          data: expect.objectContaining({ estado: 'LIBERADA' }) as unknown,
        }),
      );
    });
  });

  describe('fulfillment status', () => {
    it.each([
      [[{ id: 's', estado: 'PEDIDO', proveedor_id: supplierB }], 'PEDIDA'],
      [[{ id: 's', estado: 'EN_TRANSITO' }], 'PENDIENTE_INGRESO'],
      [[{ id: 's', estado: 'RECIBIDO' }], 'RECIBIDA'],
      [
        [
          { id: 'new', estado: 'CANCELADA' },
          { id: 'old', estado: 'PEDIDO' },
        ],
        'PEDIDA',
      ],
      [[{ id: 's', estado: 'CANCELADA' }], 'PENDIENTE_ASIGNACION'],
    ])('maps %j to %s', async (supplies, status) => {
      const sales = salesService({
        operaciones: {
          findFirst: jest.fn().mockResolvedValue(operationRecord({}, supplies)),
        },
      });
      (
        sales as unknown as {
          prisma: {
            withTenant: (
              scope: unknown,
              work: (tx: unknown) => Promise<unknown>,
            ) => Promise<unknown>;
          };
        }
      ).prisma = {
        withTenant: (_scope, work) =>
          work({
            operaciones: {
              findFirst: jest
                .fn()
                .mockResolvedValue(operationRecord({}, supplies)),
            },
            conceptos_pago_vehiculo: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
            pagos_vehiculo: { findMany: jest.fn().mockResolvedValue([]) },
          }),
      };
      await expect(
        sales.findOne(operationId, administrativa),
      ).resolves.toMatchObject({ fulfillment: { status } });
    });

    it('shows the supplier and order date of an ordered unit', async () => {
      const record = operationRecord({}, [
        { id: 'supply-b', estado: 'PEDIDO', proveedor_id: supplierB },
      ]);
      const sales = new SalesService(
        {
          withTenant: (
            _scope: unknown,
            work: (tx: unknown) => Promise<unknown>,
          ) =>
            work({
              operaciones: { findFirst: jest.fn().mockResolvedValue(record) },
              conceptos_pago_vehiculo: {
                findUnique: jest.fn().mockResolvedValue(null),
              },
              pagos_vehiculo: { findMany: jest.fn().mockResolvedValue([]) },
            }),
        } as unknown as PrismaService,
        {} as AuditService,
        {} as CashService,
      );
      await expect(
        sales.findOne(operationId, administrativa),
      ).resolves.toMatchObject({
        fulfillment: {
          status: 'PEDIDA',
          supplyRequestId: 'supply-b',
          supplier: { id: supplierB, legalName: 'Prov B' },
          orderedAt: new Date('2026-09-25T12:00:00.000Z'),
        },
      });
    });

    it('filters the assignment tray by operations without a unit', async () => {
      const findMany = jest
        .fn<Promise<unknown[]>, [Prisma.operacionesFindManyArgs]>()
        .mockResolvedValue([]);
      const sales = new SalesService(
        {
          withTenant: (
            _scope: unknown,
            work: (tx: unknown) => Promise<unknown>,
          ) =>
            work({
              operaciones: { count: jest.fn().mockResolvedValue(0), findMany },
            }),
        } as unknown as PrismaService,
        {} as AuditService,
        {} as CashService,
      );
      await sales.findAll(
        {
          vehicleType: 'MOTO',
          fulfillmentStatus: 'SIN_ASIGNAR',
          page: 1,
          limit: 20,
        },
        administrativa,
      );
      await sales.findAll(
        {
          vehicleType: 'MOTO',
          fulfillmentStatus: 'PENDIENTE_INGRESO',
          page: 1,
          limit: 20,
        },
        administrativa,
      );
      const and = (call: number) =>
        findMany.mock.calls[call]?.[0].where
          ?.AND as Prisma.operacionesWhereInput[];
      expect(and(0)).toContainEqual({
        unidad_vehiculo_id: null,
        estado_operacion: { in: ['PENDIENTE_APROBACION', 'APROBADA'] },
      });
      expect(and(1)).toContainEqual({
        unidad_vehiculo_id: null,
        solicitudes_abastecimiento: {
          some: { estado: { in: ['EN_TRANSITO'] } },
        },
      });
    });
  });
});

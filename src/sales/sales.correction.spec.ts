import { ConflictException, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AuditService,
  AuthenticatedAuditEvent,
} from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CashService } from '../cash/cash.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SalesService } from './sales.service';

// Corrección administrativa de operaciones ya cargadas (PATCH
// /sales/operations/:id/correction): cualquier estado, sin cambiar el estado
// ni la unidad, y con el plan de pago reacomodado aunque tenga cobros.

const operationId = '7d5cc401-544e-4651-9bd6-52495887fecd';
const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
const sellerId = '11b5de9b-9bc2-4777-bb78-9c7267b73aca';
const newSellerId = '33b5de9b-9bc2-4777-bb78-9c7267b73aca';
const financialId = '55b5de9b-9bc2-4777-bb78-9c7267b73aca';

const actor: AuthenticatedUser = {
  id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
  email: 'administrativa@luma.test',
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
    code: 'ADMINISTRATIVA',
    name: 'Administrativa',
    system: true,
    permissions: ['sucursales.todas', 'ventas.corregir'],
  },
  branch: null,
};

function component(overrides: Record<string, unknown>) {
  return {
    id: 'component-cash',
    tipo_componente: 'EFECTIVO',
    importe_esperado: new Prisma.Decimal(100),
    fecha_vencimiento: null,
    financiera_id: null,
    consulta_crediticia_id: null,
    vehiculo_tomado_id: null,
    estado_pago: 'PENDIENTE',
    notas: null,
    financiera_pago_informado_en: null,
    financiera_pago_notas: null,
    financiera_pago_informado_por: null,
    financieras_componentes_pago_operacion_financiera_id_organizacion_idTofinancieras:
      null,
    ...overrides,
  };
}

function operation(status: string, overrides: Record<string, unknown> = {}) {
  const unitId = 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2';
  const branchId = '84e778cc-7616-4792-b6db-d89f100bb6f1';
  const versionId = '4de88c4c-3382-4f9b-ae60-98147159c977';
  const clientId = '904e2a34-8285-48fa-b64c-24a80d94f9cb';
  return {
    id: operationId,
    organizacion_id: organizationId,
    estado_operacion: status,
    version_fila: 2,
    unidad_vehiculo_id: unitId,
    version_id: versionId,
    condicion: 'NUEVO',
    sucursal_id: branchId,
    cliente_id: clientId,
    precio_acordado: new Prisma.Decimal(100),
    numero_operacion: BigInt(42),
    numero_boleto: null,
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
      id: clientId,
      tipo_documento: 'DNI',
      numero_documento: '12345678',
      nombre_completo: 'Cliente',
      telefono: '1122334455',
      activo: true,
    },
    sucursales: { id: branchId, codigo: 'CASA', nombre: 'Casa' },
    versiones_vehiculos: {
      id: versionId,
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
      estado_inventario: 'VENDIDO',
      sucursal_id: branchId,
      origen_adquisicion: 'COMPRA',
      proveedores: null,
    },
    asignaciones_personal_operacion: [
      {
        rol_asignacion: 'VENDEDOR',
        personal: { id: sellerId, nombre_completo: 'Vendedor' },
      },
    ],
    reservas_stock: [],
    aprobaciones_operacion: [],
    componentes_pago_operacion: [component({})],
    obligaciones_operacion: [],
    solicitudes_abastecimiento: [],
    ingresos_financieros: [],
    personal: { id: sellerId, nombre_completo: 'Administrador' },
    ...overrides,
  };
}

function harness(current: ReturnType<typeof operation>) {
  const events: AuthenticatedAuditEvent[] = [];
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: operationId }]),
    operaciones: {
      findFirst: jest.fn().mockResolvedValue(current),
      update: jest
        .fn<Promise<unknown>, [Prisma.operacionesUpdateArgs]>()
        .mockResolvedValue({}),
    },
    personal: {
      findFirst: jest.fn().mockResolvedValue({
        id: newSellerId,
        roles: { codigo: 'VENDEDOR' },
      }),
    },
    asignaciones_personal_operacion: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
    },
    componentes_pago_operacion: {
      update: jest
        .fn<Promise<unknown>, [Prisma.componentes_pago_operacionUpdateArgs]>()
        .mockResolvedValue({}),
      create: jest
        .fn<
          Promise<{ id: string }>,
          [Prisma.componentes_pago_operacionCreateArgs]
        >()
        .mockResolvedValue({ id: 'component-new' }),
      // syncComponentPaymentStatus: nothing to resync in these tests.
      findFirst: jest.fn().mockResolvedValue(null),
    },
    ingresos: {
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    cobranzas: { findMany: jest.fn().mockResolvedValue([]) },
    movimientos_caja: { findMany: jest.fn().mockResolvedValue([]) },
    operacion_creditos: { count: jest.fn().mockResolvedValue(0) },
    financieras: {
      findFirst: jest.fn().mockResolvedValue({ id: financialId }),
    },
    conceptos_pago_vehiculo: { findUnique: jest.fn().mockResolvedValue(null) },
    pagos_vehiculo: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const execute = jest
    .fn<
      Promise<unknown>,
      [
        AuthenticatedAuditEvent,
        (client: Prisma.TransactionClient) => Promise<unknown>,
      ]
    >()
    .mockImplementation((event, work) => {
      events.push(event);
      return work(transaction as unknown as Prisma.TransactionClient);
    });
  const service = new SalesService(
    {} as PrismaService,
    { execute } as unknown as AuditService,
    {} as CashService,
  );
  return { service, transaction, events };
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException)
      return (error.getResponse() as { code?: string }).code ?? error.message;
    throw error;
  }
  throw new Error('Expected the call to fail');
}

describe('SalesService.correct', () => {
  it.each(['APROBADA', 'CERRADA', 'CANCELADA', 'PENDIENTE_APROBACION'])(
    'changes the seller of a %s operation without touching its state or unit',
    async (status) => {
      const { service, transaction, events } = harness(operation(status));

      await service.correct(
        operationId,
        { expectedVersion: 2, sellerId: newSellerId, ticketNumber: ' SM-1 ' },
        actor,
      );

      const data = transaction.operaciones.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ numero_boleto: 'SM-1' });
      expect(data).not.toHaveProperty('estado_operacion');
      expect(data).not.toHaveProperty('unidad_vehiculo_id');
      expect(data).not.toHaveProperty('precio_lista');
      expect(data.monto_credito).toBeUndefined();
      expect(
        transaction.asignaciones_personal_operacion.create,
      ).toHaveBeenCalledWith({
        data: expect.objectContaining({
          personal_id: newSellerId,
          rol_asignacion: 'VENDEDOR',
        }) as unknown,
      });
      // The plan is left alone when neither price nor payment changed.
      expect(
        transaction.componentes_pago_operacion.update,
      ).not.toHaveBeenCalled();
      expect(events[0]).toMatchObject({
        action: 'SALES_OPERATION_CORRECTED',
        previousData: { status, sellerIds: [`VENDEDOR:${sellerId}`] },
        metadata: { correctedFields: ['sellerId', 'ticketNumber'] },
      });
    },
  );

  it('rejects a stale version', async () => {
    const { service } = harness(operation('APROBADA'));

    await expect(
      service.correct(operationId, { expectedVersion: 1, notes: 'x' }, actor),
    ).rejects.toThrow(
      new ConflictException('Sales operation was modified by another request'),
    );
  });

  it('stamps the delivery date when the sale is marked as delivered', async () => {
    const { service, transaction } = harness(operation('APROBADA'));

    await service.correct(
      operationId,
      { expectedVersion: 2, deliveryStatus: 'ENTREGADO' },
      actor,
    );

    // The database rejects ENTREGADO without entregado_en
    // (operacion_entregado_en_valido).
    const data = transaction.operaciones.update.mock.calls[0][0].data as {
      estado_entrega: string;
      entregado_en: Date | null | undefined;
    };
    expect(data.estado_entrega).toBe('ENTREGADO');
    expect(data.entregado_en).toBeInstanceOf(Date);
  });

  it('keeps the delivery date untouched when the delivery status is not sent', async () => {
    const { service, transaction } = harness(operation('APROBADA'));

    await service.correct(
      operationId,
      { expectedVersion: 2, notes: 'Cambio de vendedor' },
      actor,
    );

    const data = transaction.operaciones.update.mock.calls[0][0].data as {
      entregado_en: Date | null | undefined;
    };
    expect(data.entregado_en).toBeUndefined();
  });

  it('clears the delivery date when the sale leaves the delivered status', async () => {
    const { service, transaction } = harness(operation('APROBADA'));

    await service.correct(
      operationId,
      { expectedVersion: 2, deliveryStatus: 'NO_PROGRAMADA' },
      actor,
    );

    const data = transaction.operaciones.update.mock.calls[0][0].data as {
      entregado_en: Date | null | undefined;
    };
    expect(data.entregado_en).toBeNull();
  });

  it('schedules the delivery with the agreed day', async () => {
    const { service, transaction, events } = harness(operation('APROBADA'));

    await service.correct(
      operationId,
      {
        expectedVersion: 2,
        deliveryStatus: 'PROGRAMADA',
        deliveryScheduledDate: '2026-10-20',
      },
      actor,
    );

    // The database rejects PROGRAMADA without entrega_programada_en
    // (operacion_entrega_programacion_valido).
    const data = transaction.operaciones.update.mock.calls[0][0].data as {
      estado_entrega: string;
      entrega_programada_en: Date | null | undefined;
    };
    expect(data.estado_entrega).toBe('PROGRAMADA');
    expect(data.entrega_programada_en?.toISOString().slice(0, 10)).toBe(
      '2026-10-20',
    );
    expect(events[0]).toMatchObject({
      previousData: { deliveryStatus: 'NO_PROGRAMADA', deliveryScheduledDate: null },
    });
  });

  it('asks for the day before scheduling a delivery without one', async () => {
    const { service, transaction } = harness(operation('APROBADA'));

    await expect(
      service.correct(
        operationId,
        { expectedVersion: 2, deliveryStatus: 'PROGRAMADA' },
        actor,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DELIVERY_DATE_REQUIRED' }),
    });
    expect(transaction.operaciones.update).not.toHaveBeenCalled();
  });

  it('keeps the agreed day when an already scheduled delivery is edited', async () => {
    const scheduled = new Date('2026-10-20T12:00:00.000Z');
    const { service, transaction } = harness(
      operation('APROBADA', {
        estado_entrega: 'PROGRAMADA',
        entrega_programada_en: scheduled,
      }),
    );

    await service.correct(
      operationId,
      { expectedVersion: 2, notes: 'Lo retira el hermano' },
      actor,
    );

    const data = transaction.operaciones.update.mock.calls[0][0].data as {
      entrega_programada_en: Date | null | undefined;
    };
    expect(data.entrega_programada_en).toBeUndefined();
  });

  it('forgets the agreed day when the delivery goes back to not scheduled', async () => {
    const { service, transaction } = harness(
      operation('APROBADA', {
        estado_entrega: 'PROGRAMADA',
        entrega_programada_en: new Date('2026-10-20T12:00:00.000Z'),
      }),
    );

    await service.correct(
      operationId,
      { expectedVersion: 2, deliveryStatus: 'NO_PROGRAMADA' },
      actor,
    );

    const data = transaction.operaciones.update.mock.calls[0][0].data as {
      entrega_programada_en: Date | null | undefined;
    };
    expect(data.entrega_programada_en).toBeNull();
  });

  it('moves a cash sale to cash + credit keeping the cash component', async () => {
    const { service, transaction } = harness(operation('APROBADA'));

    await service.correct(
      operationId,
      {
        expectedVersion: 2,
        paymentPlatform: 'EFECTIVO_CREDITO',
        creditAmount: 60,
        financialInstitutionId: financialId,
      },
      actor,
    );

    expect(transaction.operaciones.update.mock.calls[0][0].data).toMatchObject({
      plataforma_pago: 'EFECTIVO_CREDITO',
      monto_credito: new Prisma.Decimal(60),
    });
    expect(
      transaction.componentes_pago_operacion.create.mock.calls[0][0].data,
    ).toMatchObject({
      tipo_componente: 'FINANCIACION',
      importe_esperado: new Prisma.Decimal(60),
      financiera_id: financialId,
    });
    // The existing cash component keeps its id (and its collections) and
    // only its expected amount changes.
    expect(
      transaction.componentes_pago_operacion.update.mock.calls[0][0],
    ).toMatchObject({
      where: { id_organizacion_id: { id: 'component-cash' } },
      data: { importe_esperado: new Prisma.Decimal(40) },
    });
    expect(transaction.ingresos.updateMany).not.toHaveBeenCalled();
  });

  it('cancels the components that no longer apply and keeps their incomes on the operation', async () => {
    const current = operation('CERRADA', {
      plataforma_pago: 'EFECTIVO_CREDITO',
      monto_credito: new Prisma.Decimal(60),
      componentes_pago_operacion: [
        component({ importe_esperado: new Prisma.Decimal(40) }),
        component({
          id: 'component-credit',
          tipo_componente: 'FINANCIACION',
          importe_esperado: new Prisma.Decimal(60),
          financiera_id: financialId,
        }),
      ],
    });
    const { service, transaction, events } = harness(current);

    await service.correct(
      operationId,
      { expectedVersion: 2, paymentPlatform: 'EFECTIVO' },
      actor,
    );

    expect(transaction.operaciones.update.mock.calls[0][0].data).toMatchObject({
      plataforma_pago: 'EFECTIVO',
      monto_credito: null,
    });
    expect(transaction.ingresos.updateMany).toHaveBeenCalledWith({
      where: {
        componente_pago_id: 'component-credit',
        organizacion_id: organizationId,
      },
      data: { componente_pago_id: null },
    });
    const updates =
      transaction.componentes_pago_operacion.update.mock.calls.map(
        ([args]) => args,
      );
    expect(updates).toContainEqual(
      expect.objectContaining({
        where: {
          id_organizacion_id: {
            id: 'component-credit',
            organizacion_id: organizationId,
          },
        },
        data: { estado_pago: 'CANCELADA' },
      }),
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        data: { importe_esperado: new Prisma.Decimal(100) },
      }),
    );
    expect(events[0].metadata).toMatchObject({ detachedIncomes: 2 });
  });

  it('follows a price change with the cash component', async () => {
    const { service, transaction } = harness(operation('APROBADA'));

    await service.correct(
      operationId,
      { expectedVersion: 2, agreedPrice: 150 },
      actor,
    );

    expect(
      transaction.componentes_pago_operacion.update.mock.calls[0][0].data,
    ).toEqual({ importe_esperado: new Prisma.Decimal(150) });
  });

  it('asks for the financiera when a credit has none', async () => {
    const { service } = harness(operation('APROBADA'));

    await expect(
      errorCode(
        service.correct(
          operationId,
          {
            expectedVersion: 2,
            paymentPlatform: 'EFECTIVO_CREDITO',
            creditAmount: 60,
          },
          actor,
        ),
      ),
    ).resolves.toBe('CORRECTION_FINANCIAL_INSTITUTION_REQUIRED');
  });

  it('does not create or drop trade-ins', async () => {
    const { service } = harness(operation('APROBADA'));

    await expect(
      errorCode(
        service.correct(
          operationId,
          { expectedVersion: 2, paymentPlatform: 'MOTO_EFECTIVO' },
          actor,
        ),
      ),
    ).resolves.toBe('CORRECTION_TRADE_IN_REQUIRED');
  });

  it('leaves an own credit with installments alone', async () => {
    const current = operation('APROBADA', {
      plataforma_pago: 'EFECTIVO_CREDITO',
      monto_credito: new Prisma.Decimal(60),
      componentes_pago_operacion: [
        component({ importe_esperado: new Prisma.Decimal(40) }),
        component({
          id: 'component-credit',
          tipo_componente: 'FINANCIACION',
          importe_esperado: new Prisma.Decimal(60),
          financiera_id: financialId,
        }),
      ],
    });
    const { service, transaction } = harness(current);
    transaction.operacion_creditos.count.mockResolvedValue(1);

    await expect(
      errorCode(
        service.correct(
          operationId,
          { expectedVersion: 2, creditAmount: 50 },
          actor,
        ),
      ),
    ).resolves.toBe('CORRECTION_OWN_CREDIT_ACTIVE');
    // Changing only the seller is still allowed on that operation.
    await expect(
      service.correct(
        operationId,
        { expectedVersion: 2, sellerId: newSellerId },
        actor,
      ),
    ).resolves.toBeDefined();
  });
});

describe('SalesService.correct - cambio de modelo', () => {
  const newVersionId = '6de88c4c-3382-4f9b-ae60-98147159c977';

  function withCatalog(
    current: ReturnType<typeof operation>,
    options: {
      vehicleType?: string;
      unitVersionId?: string;
      reservation?: boolean;
      policy?: {
        precio_lista: number;
        precio_minimo: number;
        moneda: string;
      } | null;
    } = {},
  ) {
    const setup = harness(current);
    const transaction = setup.transaction as typeof setup.transaction & {
      versiones_vehiculos: { findUnique: jest.Mock };
      unidades_vehiculos: { findFirst: jest.Mock };
      reservas_stock: { findFirst: jest.Mock };
      politicas_precios_vehiculos: { findFirst: jest.Mock };
    };
    transaction.versiones_vehiculos = {
      findUnique: jest.fn().mockResolvedValue({
        id: newVersionId,
        alcance: 'GLOBAL',
        organizacion_propietaria_id: null,
        catalogo_organizaciones: [],
        modelos_vehiculos: { tipo_vehiculo: options.vehicleType ?? 'MOTO' },
      }),
    };
    transaction.unidades_vehiculos = {
      findFirst: jest.fn().mockResolvedValue({
        version_id: options.unitVersionId ?? current.version_id,
        vin_mostrado: 'ABC123456',
      }),
    };
    transaction.reservas_stock = {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options.reservation ? { id: 'reservation-1' } : null,
        ),
    };
    const policy =
      options.policy === undefined
        ? { precio_lista: 150, precio_minimo: 140, moneda: 'ARS' }
        : options.policy;
    transaction.politicas_precios_vehiculos = {
      findFirst: jest.fn().mockResolvedValue(
        policy && {
          precio_lista: new Prisma.Decimal(policy.precio_lista),
          precio_minimo: new Prisma.Decimal(policy.precio_minimo),
          moneda: policy.moneda,
        },
      ),
    };
    return { ...setup, transaction };
  }

  const withoutUnit = (status = 'APROBADA') =>
    operation(status, { unidad_vehiculo_id: null, unidades_vehiculos: null });

  it('changes the model and takes the new list and minimum prices', async () => {
    const { service, transaction, events } = withCatalog(withoutUnit());

    await service.correct(
      operationId,
      { expectedVersion: 2, versionId: newVersionId },
      actor,
    );

    const data = transaction.operaciones.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      version_id: newVersionId,
      precio_lista: new Prisma.Decimal(150),
      precio_minimo: new Prisma.Decimal(140),
    });
    expect(data).not.toHaveProperty('estado_operacion');
    expect(data.precio_acordado).toBeUndefined();
    // Precio a la fecha de la venta (29/08), no a hoy.
    const policyWhere = (
      transaction.politicas_precios_vehiculos.findFirst.mock.calls[0] as [
        { where: { vigente_desde: { lte: unknown } } },
      ]
    )[0].where;
    expect(policyWhere.vigente_desde.lte).toEqual(
      new Date('2026-08-29T00:00:00.000Z'),
    );
    expect(events[0]).toMatchObject({
      previousData: {
        versionId: '4de88c4c-3382-4f9b-ae60-98147159c977',
        listPrice: '120',
        minimumPrice: '110',
      },
      metadata: { correctedFields: ['versionId'] },
    });
  });

  it('accepts a unit of the new model', async () => {
    const { service, transaction } = withCatalog(operation('CERRADA'), {
      unitVersionId: newVersionId,
    });

    await service.correct(
      operationId,
      { expectedVersion: 2, versionId: newVersionId },
      actor,
    );
    expect(transaction.operaciones.update.mock.calls[0][0].data).toMatchObject({
      version_id: newVersionId,
    });
  });

  it('does not touch prices of imported sales without references', async () => {
    const { service, transaction } = withCatalog(
      operation('APROBADA', {
        unidad_vehiculo_id: null,
        unidades_vehiculos: null,
        precio_lista: null,
        precio_minimo: null,
      }),
      { policy: null },
    );

    await service.correct(
      operationId,
      { expectedVersion: 2, versionId: newVersionId },
      actor,
    );
    const data = transaction.operaciones.update.mock.calls[0][0].data;
    expect(data.version_id).toBe(newVersionId);
    expect(data.precio_lista).toBeUndefined();
  });

  it.each([
    [
      'a unit of the old model',
      () => withCatalog(operation('APROBADA')),
      'CORRECTION_UNIT_OTHER_MODEL',
    ],
    [
      'an active reservation',
      () => withCatalog(withoutUnit(), { reservation: true }),
      'CORRECTION_RESERVATION_ACTIVE',
    ],
    [
      'a supplier order in progress',
      () =>
        withCatalog(
          operation('APROBADA', {
            unidad_vehiculo_id: null,
            unidades_vehiculos: null,
            solicitudes_abastecimiento: [{ estado: 'PEDIDO' }],
          }),
        ),
      'CORRECTION_SUPPLY_IN_PROGRESS',
    ],
    [
      'no price for the new model',
      () => withCatalog(withoutUnit(), { policy: null }),
      'ACTIVE_PRICE_POLICY_REQUIRED',
    ],
    [
      'a price in another currency',
      () =>
        withCatalog(withoutUnit(), {
          policy: { precio_lista: 1, precio_minimo: 1, moneda: 'USD' },
        }),
      'CORRECTION_CURRENCY_MISMATCH',
    ],
  ])('refuses a new model with %s', async (_case, build, code) => {
    const { service, transaction } = build();

    await expect(
      errorCode(
        service.correct(
          operationId,
          { expectedVersion: 2, versionId: newVersionId },
          actor,
        ),
      ),
    ).resolves.toBe(code);
    expect(transaction.operaciones.update).not.toHaveBeenCalled();
  });

  it('refuses a model of another vehicle type', async () => {
    const { service } = withCatalog(withoutUnit(), { vehicleType: 'AUTO' });

    await expect(
      service.correct(
        operationId,
        { expectedVersion: 2, versionId: newVersionId },
        actor,
      ),
    ).rejects.toThrow('Version is not available to the organization');
  });

  it('ignores the same model', async () => {
    const { service, transaction } = withCatalog(withoutUnit());

    await service.correct(
      operationId,
      {
        expectedVersion: 2,
        versionId: '4de88c4c-3382-4f9b-ae60-98147159c977',
        notes: 'x',
      },
      actor,
    );
    const data = transaction.operaciones.update.mock.calls[0][0].data;
    expect(data.version_id).toBeUndefined();
    expect(transaction.versiones_vehiculos.findUnique).not.toHaveBeenCalled();
  });
});

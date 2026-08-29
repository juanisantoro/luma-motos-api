import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CashService } from '../cash/cash.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupplierPurchasesService } from './supplier-purchases.service';

describe('SupplierPurchasesService', () => {
  const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
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
      permissions: ['compras.consultar', 'compras.pagar'],
    },
    branch: null,
  };
  const purchase = {
    id: '7d5cc401-544e-4651-9bd6-52495887fecd',
    proveedor_id: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
    sucursal_id: '84e778cc-7616-4792-b6db-d89f100bb6f1',
    version_id: '6ddb66de-a6cc-4957-b6ca-c503c9782855',
    unidad_vehiculo_id: null,
    solicitud_abastecimiento_id: null,
    fecha_compra: new Date('2026-08-20T00:00:00.000Z'),
    numero_documento: 'FC-A-1',
    importe_base: new Prisma.Decimal('100'),
    importe_adicional: new Prisma.Decimal('20'),
    importe_total: new Prisma.Decimal('120'),
    moneda: 'ARS',
    estado_pago: 'PENDIENTE' as const,
    notas: 'Compra',
    creado_en: new Date('2026-08-20T10:00:00.000Z'),
    actualizado_en: new Date('2026-08-20T10:00:00.000Z'),
    organizacion_id: organizationId,
    proveedores: {
      id: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
      razon_social: 'Proveedor SA',
    },
    sucursal: {
      id: '84e778cc-7616-4792-b6db-d89f100bb6f1',
      codigo: 'SM',
      nombre: 'San Miguel',
    },
    version: {
      id: '6ddb66de-a6cc-4957-b6ca-c503c9782855',
      modelo_id: '10cf13eb-ab30-4f21-a1af-4ba21d043237',
      nombre: 'Wave 110 S',
      nombre_normalizado: 'wave 110 s',
      es_marcador: false,
      activo: true,
      creado_en: new Date(),
      actualizado_en: new Date(),
      alcance: 'GLOBAL' as const,
      organizacion_propietaria_id: null,
      modelos_vehiculos: {
        id: '10cf13eb-ab30-4f21-a1af-4ba21d043237',
        marca_id: 'f5a43649-9290-485f-86eb-f2d44bdbb17d',
        tipo_vehiculo: 'MOTO' as const,
        nombre: 'Wave 110',
        nombre_normalizado: 'wave 110',
        activo: true,
        creado_en: new Date(),
        actualizado_en: new Date(),
        marcas_vehiculos: {
          id: 'f5a43649-9290-485f-86eb-f2d44bdbb17d',
          nombre: 'Honda',
          nombre_normalizado: 'honda',
          activo: true,
          creado_en: new Date(),
          actualizado_en: new Date(),
        },
      },
    },
    unidades_vehiculos: null,
    movimientos_caja: [] as Array<{ importe: Prisma.Decimal }>,
  };

  const count = jest.fn<Promise<number>, [Prisma.compras_proveedorCountArgs]>();
  const findMany = jest.fn<
    Promise<unknown[]>,
    [Prisma.compras_proveedorFindManyArgs]
  >();
  const findFirst = jest.fn();
  const update = jest.fn();
  const queryRaw = jest.fn();
  const movementFindMany = jest.fn();
  const transaction = {
    $queryRaw: queryRaw,
    compras_proveedor: { count, findMany, findFirst, update },
    movimientos_caja: { findMany: movementFindMany },
  } as unknown as Prisma.TransactionClient;
  const withTenant = jest.fn(
    (
      _scope: unknown,
      operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) => operation(transaction),
  );
  const execute = jest.fn(
    (
      _event: unknown,
      operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) => operation(transaction),
  );
  const settledAmount = jest.fn();
  const registerEntityMovement = jest.fn();
  const entityMovements = jest.fn().mockResolvedValue([]);
  const service = new SupplierPurchasesService(
    { withTenant } as unknown as PrismaService,
    { execute } as unknown as AuditService,
    {
      settledAmount,
      registerEntityMovement,
      entityMovements,
    } as unknown as CashService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    count.mockResolvedValue(1);
    findMany.mockResolvedValue([purchase]);
    findFirst.mockResolvedValue(purchase);
    update.mockResolvedValue(purchase);
    queryRaw.mockResolvedValue([{ id: purchase.id }]);
    movementFindMany.mockResolvedValue([]);
  });

  it('applies tenant and filter scope and omits every cost field without permission', async () => {
    const result = await service.findAll(
      {
        page: 1,
        limit: 20,
        supplierId: purchase.proveedor_id,
        search: 'FC-A-1',
      },
      actor,
    );

    expect(count.mock.calls[0]?.[0]).toMatchObject({
      where: {
        organizacion_id: organizationId,
        proveedor_id: purchase.proveedor_id,
      },
    });
    expect(result.items[0]).not.toHaveProperty('baseAmount');
    expect(result.items[0]).not.toHaveProperty('totalAmount');
    expect(result.items[0]).not.toHaveProperty('paidAmount');
    expect(result.items[0]).not.toHaveProperty('balanceAmount');
  });

  it('exposes Decimal costs only with the sensitive permission', async () => {
    const result = await service.findAll(
      { page: 1, limit: 20 },
      {
        ...actor,
        role: {
          ...actor.role,
          permissions: [...actor.role.permissions, 'compras.costos.consultar'],
        },
      },
    );

    expect(result.items[0]).toMatchObject({
      baseAmount: '100',
      additionalCosts: '20',
      totalAmount: '120',
      paidAmount: '0',
      balanceAmount: '120',
    });
  });

  it('filters by the payment status derived from active movements', async () => {
    findMany.mockResolvedValue([
      {
        ...purchase,
        estado_pago: 'PAGADO',
        movimientos_caja: [{ importe: new Prisma.Decimal('40') }],
      },
      {
        ...purchase,
        id: '8346e2ae-490a-4815-b8bc-87a355656d11',
        estado_pago: 'PAGO_PARCIAL',
        movimientos_caja: [],
      },
    ]);

    const result = await service.findAll(
      { page: 1, limit: 20, status: 'PARCIAL' },
      actor,
    );

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: purchase.id,
      paymentStatus: 'PARCIAL',
    });
    expect(findMany.mock.calls[0]?.[0].where).not.toHaveProperty('estado_pago');
    expect(findMany.mock.calls[0]?.[0]).not.toHaveProperty('skip');
    expect(count).not.toHaveBeenCalled();
  });

  it('derives a partial status after registering a payment', async () => {
    settledAmount.mockResolvedValue(new Prisma.Decimal('40'));

    await service.pay(
      purchase.id,
      {
        idempotencyKey: '7db0fc0c-891c-4126-a25c-e9d36ccf2dd8',
        accountId: '69b37c31-d9d5-4d87-bd2a-90d41d596521',
        amount: '40.00',
      },
      actor,
    );

    expect(registerEntityMovement).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estado_pago: 'PAGO_PARCIAL' } }),
    );
  });

  it('rolls back an overpayment with a stable domain conflict', async () => {
    settledAmount.mockResolvedValue(new Prisma.Decimal('121'));

    await expect(
      service.pay(
        purchase.id,
        {
          idempotencyKey: '7db0fc0c-891c-4126-a25c-e9d36ccf2dd8',
          accountId: '69b37c31-d9d5-4d87-bd2a-90d41d596521',
          amount: '121.00',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });
});

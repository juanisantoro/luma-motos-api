import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CashService } from '../cash/cash.service';
import { PrismaService } from '../prisma/prisma.service';
import { IncomesService } from './incomes.service';

describe('IncomesService', () => {
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
      permissions: ['ingresos.consultar', 'ingresos.cobrar'],
    },
    branch: null,
  };
  const income = {
    id: '7d5cc401-544e-4651-9bd6-52495887fecd',
    organizacion_id: organizationId,
    sucursal_id: '84e778cc-7616-4792-b6db-d89f100bb6f1',
    fecha_ingreso: new Date('2026-08-20T00:00:00.000Z'),
    tipo_original: 'VENTA_ACCESORIO',
    descripcion: 'Casco',
    importe: new Prisma.Decimal('100'),
    moneda: 'ARS',
    estado_registro: 'COBRADO',
    referencia: null,
    unidad_vehiculo_id: null,
    operacion_id: null,
    observaciones: null,
    es_transferencia: false,
    requiere_conciliacion: false,
    creado_en: new Date('2026-08-20T10:00:00.000Z'),
    actualizado_en: new Date('2026-08-20T10:00:00.000Z'),
    sucursales: {
      id: '84e778cc-7616-4792-b6db-d89f100bb6f1',
      codigo: 'SM',
      nombre: 'San Miguel',
    },
    operaciones: null,
    unidades_vehiculos: null,
    personal: null,
    cuentas_caja: null,
    movimientos_caja: [
      {
        importe: new Prisma.Decimal('40'),
        contabilizado_en: new Date('2026-08-20T10:00:00.000Z'),
        cuentas_caja: {
          id: 'ed533c59-526d-45e8-aed4-f909aaaf09f4',
          codigo: 'CAJA',
          nombre: 'Caja',
          tipo_cuenta: 'CAJA',
        },
        personal: {
          id: 'f4b6ce19-ce56-4125-b058-e1f087c742bc',
          nombre_completo: 'Administrativa',
        },
      },
    ],
  };

  const findMany = jest.fn<Promise<unknown[]>, [Prisma.ingresosFindManyArgs]>();
  const count = jest.fn();
  const findFirst = jest.fn();
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: income.id }]),
    ingresos: { findMany, count, findFirst, update: jest.fn() },
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
  const registerEntityMovement = jest.fn();
  const service = new IncomesService(
    { withTenant } as unknown as PrismaService,
    { execute } as unknown as AuditService,
    { registerEntityMovement } as unknown as CashService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([
      income,
      {
        ...income,
        id: '8346e2ae-490a-4815-b8bc-87a355656d11',
        estado_registro: 'PAGO_PARCIAL',
        movimientos_caja: [],
      },
    ]);
  });

  it('filters by the collection state derived from active movements', async () => {
    const result = await service.findAll(
      { page: 1, limit: 20, status: 'PARCIAL' },
      actor,
    );

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: income.id,
      paymentStatus: 'PARCIAL',
    });
    expect(findMany.mock.calls[0]?.[0].where).not.toHaveProperty(
      'estado_registro',
    );
    expect(findMany.mock.calls[0]?.[0]).not.toHaveProperty('skip');
    expect(findMany.mock.calls[0]?.[0]).toHaveProperty('take', 10_001);
    expect(count).not.toHaveBeenCalled();
  });

  it('rejects collections while a legacy income requires reconciliation', async () => {
    findFirst.mockResolvedValue({
      ...income,
      requiere_conciliacion: true,
      estado_registro: 'PENDIENTE_CONCILIACION',
      movimientos_caja: [],
    });

    const error: unknown = await service
      .collect(
        income.id,
        {
          idempotencyKey: '7db0fc0c-891c-4126-a25c-e9d36ccf2dd8',
          accountId: 'ed533c59-526d-45e8-aed4-f909aaaf09f4',
          amount: '40.00',
        },
        actor,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual(
      expect.objectContaining({
        code: 'INCOME_REQUIRES_RECONCILIATION',
      }),
    );
    expect(registerEntityMovement).not.toHaveBeenCalled();
  });

  it('preserves reconciliation state when reversing an external income movement', async () => {
    const reconciled = {
      ...income,
      requiere_conciliacion: true,
      estado_registro: 'COBRADO',
      movimientos_caja: [],
    };
    const update = jest.fn().mockResolvedValue({});
    const reverseEntityMovement = jest.fn().mockResolvedValue({});
    const settledAmount = jest.fn().mockResolvedValue(new Prisma.Decimal(0));
    const entityMovements = jest.fn().mockResolvedValue([]);
    const localTransaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: income.id }]),
      ingresos: {
        findFirst: jest.fn().mockResolvedValue(reconciled),
        update,
      },
      movimientos_caja: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as Prisma.TransactionClient;
    const localService = new IncomesService(
      {} as PrismaService,
      {
        execute: jest.fn(
          (
            _event: unknown,
            operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
          ) => operation(localTransaction),
        ),
      } as unknown as AuditService,
      {
        reverseEntityMovement,
        settledAmount,
        entityMovements,
      } as unknown as CashService,
    );

    await localService.reverse(
      income.id,
      '8346e2ae-490a-4815-b8bc-87a355656d11',
      {
        idempotencyKey: '7db0fc0c-891c-4126-a25c-e9d36ccf2dd8',
        reason: 'Corrección',
      },
      actor,
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { estado_registro: 'COBRADO' },
      }),
    );
  });
});

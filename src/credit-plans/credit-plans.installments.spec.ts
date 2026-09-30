import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CashService } from '../cash/cash.service';
import { reopenInstallment } from '../incomes/incomes.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreditPlansService } from './credit-plans.service';

describe('Cobro de cuotas del crédito propio (fase 4)', () => {
  const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
  const installmentId = '0c0c0c0c-0000-4000-8000-000000000001';
  const operationId = '0a0a0a0a-0000-4000-8000-000000000001';
  const personnelId = 'f4b6ce19-ce56-4125-b058-e1f087c742bc';
  const recipientId = '2c9f6b9a-1c55-4b1d-9d4c-6b4c3c1f0a11';
  const actor: AuthenticatedUser = {
    id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
    email: 'admin@luma.test',
    name: 'Admin',
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
      permissions: ['creditos.cobrar'],
    },
    branch: null,
    branchScope: { allBranches: true, branches: [] },
  };

  const installment = {
    organizacion_id: organizationId,
    operacion_credito_id: 'credit-1',
    numero_cuota: 3,
    monto: new Prisma.Decimal(120000),
    monto_pagado: new Prisma.Decimal(0),
    estado: 'PENDIENTE',
    operacion_id: operationId,
    numero_operacion: BigInt(1048),
    numero_boleto: 'B-0042',
    sucursal_id: 'branch-1',
    moneda: 'ARS',
    unidad_vehiculo_id: null,
  };

  const input = {
    amount: 120000,
    paymentDate: '2026-09-20',
    idempotencyKey: '7db0fc0c-891c-4126-a25c-e9d36ccf2dd8',
    accountId: 'ed533c59-526d-45e8-aed4-f909aaaf09f4',
  };

  function setup(overrides: { repeated?: unknown } = {}) {
    const row = {
      id: installmentId,
      operacion_credito_id: 'credit-1',
      numero_cuota: 3,
      monto: new Prisma.Decimal(120000),
      vencimiento: new Date('2026-09-15'),
      estado: 'PAGADA',
      estado_efectivo: 'PAGADA',
      monto_pagado: new Prisma.Decimal(120000),
      fecha_pago: new Date('2026-09-20'),
      creado_en: new Date(),
      actualizado_en: new Date(),
      operacion_id: operationId,
      numero_operacion: BigInt(1048),
      cliente_nombre: 'Ana',
    };
    const queryResults: unknown[][] = overrides.repeated
      ? [[], [installment], [row]]
      : [[], [installment], [{ exists: true }], [row]];
    const queryRaw = jest.fn(() => Promise.resolve(queryResults.shift() ?? []));
    const executeRaw = jest.fn().mockResolvedValue(1);
    const incomeCreate = jest
      .fn<Promise<unknown>, [Prisma.ingresosCreateArgs]>()
      .mockResolvedValue({ id: 'income-1' });
    const tx = {
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
      movimientos_caja: {
        findFirst: jest.fn().mockResolvedValue(overrides.repeated ?? null),
      },
      tipos_ingreso: {
        findFirst: jest.fn().mockResolvedValue({ nombre: 'Cuota crédito' }),
      },
      personal: {
        findFirst: jest.fn().mockResolvedValue({ id: recipientId }),
      },
      ingresos: { create: incomeCreate, update: jest.fn() },
    } as unknown as Prisma.TransactionClient;
    const cash = {
      actorPersonnelId: jest.fn().mockResolvedValue(personnelId),
      registerEntityMovement: jest.fn().mockResolvedValue({}),
    };
    const service = new CreditPlansService(
      {} as PrismaService,
      {
        execute: jest.fn(
          (
            _event: unknown,
            work: (client: Prisma.TransactionClient) => Promise<unknown>,
          ) => work(tx),
        ),
      } as unknown as AuditService,
      cash as unknown as CashService,
    );
    return { service, incomeCreate, cash, executeRaw };
  }

  it('crea el ingreso vinculado a la operación y la cuota, y lo acredita en caja', async () => {
    const { service, incomeCreate, cash } = setup();

    await service.payInstallment(
      installmentId,
      {
        ...input,
        paymentMethod: 'EFECTIVO',
        handoverToId: recipientId,
      },
      actor,
    );

    expect(incomeCreate.mock.calls[0]?.[0].data).toMatchObject({
      operacion_id: operationId,
      cuota_credito_id: installmentId,
      tipo_original: 'Cuota crédito',
      referencia: 'B-0042',
      medio_pago: 'EFECTIVO',
      cobrado_por_personal_id: personnelId,
      rendido_a_personal_id: recipientId,
      estado_rendicion: 'PENDIENTE_RENDICION',
    });
    expect(cash.registerEntityMovement).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      organizationId,
      'ARS',
      expect.objectContaining({ amount: '120000.00', reference: 'B-0042' }),
      { ingreso_id: 'income-1' },
      'INGRESO',
      'CREDITO',
    );
  });

  it('exige a quién se rinde cuando la cuota se cobra en efectivo', async () => {
    const { service, incomeCreate } = setup();

    await expect(
      service.payInstallment(
        installmentId,
        { ...input, paymentMethod: 'EFECTIVO' },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'HANDOVER_RECIPIENT_REQUIRED' },
    });
    expect(incomeCreate).not.toHaveBeenCalled();
  });

  it('no cobra dos veces si se reintenta el mismo pedido', async () => {
    const { service, incomeCreate } = setup({
      repeated: {
        ingresos_movimientos_caja_ingreso: { cuota_credito_id: installmentId },
      },
    });

    await service.payInstallment(
      installmentId,
      { ...input, paymentMethod: 'TRANSFERENCIA_BANCARIA' },
      actor,
    );
    expect(incomeCreate).not.toHaveBeenCalled();
  });

  it('al revertir el cobro la cuota vuelve a quedar pendiente y el crédito activo', async () => {
    const executeRaw = jest
      .fn<Promise<number>, [Prisma.Sql]>()
      .mockResolvedValue(1);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          monto_pagado: new Prisma.Decimal(120000),
          operacion_credito_id: 'credit-1',
        },
      ]),
      $executeRaw: executeRaw,
    } as unknown as Prisma.TransactionClient;

    await reopenInstallment(
      tx,
      installmentId,
      organizationId,
      new Prisma.Decimal(120000),
    );

    const [update, reactivate] = executeRaw.mock.calls.map(
      (call) => call[0].values,
    );
    expect(update).toEqual(
      expect.arrayContaining(['0.00', 'PENDIENTE', installmentId]),
    );
    expect(reactivate).toEqual(
      expect.arrayContaining(['credit-1', organizationId]),
    );
  });
});

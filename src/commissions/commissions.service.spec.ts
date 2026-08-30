/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CashService } from '../cash/cash.service';
import { PrismaService } from '../prisma/prisma.service';
import { CommissionsService } from './commissions.service';

describe('CommissionsService', () => {
  const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
  const sellerId = '11b5de9b-9bc2-4777-bb78-9e4e9563dd20';
  const branchId = '84e778cc-7616-4792-b6db-d89f100bb6f1';
  const settlementId = '7d5cc401-544e-4651-9bd6-52495887fecd';
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
      code: 'ADMINISTRADOR',
      name: 'Administrador',
      permissions: [],
    },
    branch: null,
  };

  function operation(vehicleType: 'MOTO' | 'AUTO', status = 'APROBADA') {
    return {
      id: '22b5de9b-9bc2-4777-bb78-9c7267b73aca',
      numero_operacion: BigInt(42),
      organizacion_id: organizationId,
      sucursal_id: branchId,
      fecha_operacion: new Date('2026-08-15T00:00:00.000Z'),
      estado_operacion: status,
      precio_lista: new Prisma.Decimal('100000'),
      precio_acordado: new Prisma.Decimal('90000'),
      clientes: { id: 'client', nombre_completo: 'Cliente' },
      sucursales: { id: branchId, nombre: 'Casa' },
      versiones_vehiculos: {
        nombre: 'Full',
        modelos_vehiculos: {
          nombre: 'Model',
          tipo_vehiculo: vehicleType,
          marcas_vehiculos: { nombre: 'Brand' },
        },
      },
      asignaciones_personal_operacion: [
        {
          personal_id: sellerId,
          rol_asignacion: 'VENDEDOR',
          personal: { id: sellerId, nombre_completo: 'Vendedor' },
        },
      ],
    };
  }

  function queryService(transaction: object) {
    return new CommissionsService(
      {
        withTenant: jest
          .fn()
          .mockImplementation(
            (_scope: unknown, work: (tx: object) => Promise<unknown>) =>
              work(transaction),
          ),
      } as unknown as PrismaService,
      {} as AuditService,
      {} as CashService,
    );
  }

  it('keeps AUTO isolated and returns NOT_CONFIGURED without inventing an amount', async () => {
    const findMany = jest.fn().mockResolvedValue([operation('AUTO')]);
    const transaction = {
      operaciones: { findMany },
      personal: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: sellerId, nombre_completo: 'Vendedor' }),
      },
      sucursales: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: branchId, nombre: 'Casa' }),
      },
      politicas_comisiones: { findFirst: jest.fn().mockResolvedValue(null) },
      liquidaciones_comisiones: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const result = await queryService(transaction).suggestions(
      {
        period: '2026-08',
        vehicleType: 'AUTO',
        branchId,
        sellerId,
        page: 1,
        limit: 50,
      },
      actor,
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        vehicleType: 'AUTO',
        configurationStatus: 'NOT_CONFIGURED',
        computableSales: 1,
        scale: null,
        suggestedAmount: null,
      }),
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          versiones_vehiculos: {
            modelos_vehiculos: { tipo_vehiculo: 'AUTO' },
          },
        }),
      }),
    );
  });

  it('never gives commission credit to a CONTACT assignment', async () => {
    const contactOperation = {
      ...operation('MOTO'),
      asignaciones_personal_operacion: [
        {
          personal_id: sellerId,
          rol_asignacion: 'CONTACTO',
          personal: { id: sellerId, nombre_completo: 'Contacto' },
        },
      ],
    };
    const transaction = {
      operaciones: {
        findMany: jest.fn().mockResolvedValue([contactOperation]),
      },
    };
    const result = await queryService(transaction).suggestions(
      {
        period: '2026-08',
        vehicleType: 'MOTO',
        page: 1,
        limit: 50,
      },
      actor,
    );
    expect(result).toMatchObject({ items: [], total: 0 });
  });

  it('creates an immutable policy, tier and operation snapshot on agreement', async () => {
    const key = {
      organizationId,
      sellerId,
      branchId,
      period: '2026-08',
      vehicleType: 'MOTO',
    };
    const suggestionId = Buffer.from(JSON.stringify(key), 'utf8').toString(
      'base64url',
    );
    const policy = {
      id: '4de88c4c-3382-4f9b-ae60-98147159c977',
      organizacion_id: organizationId,
      tipo_vehiculo: 'MOTO',
      moneda: 'ARS',
      vigente_desde: new Date('2000-01-01T00:00:00.000Z'),
      vigente_hasta: null,
      estado: 'ACTIVA',
      version_fila: 0,
      creado_en: new Date(),
      actualizado_en: new Date(),
      escalas_comisiones: [
        {
          id: '31b5de9b-9bc2-4777-bb78-9c7267b73aca',
          minimo_ventas: 1,
          maximo_ventas: null,
          importe_fijo: new Prisma.Decimal('35000'),
        },
      ],
    };
    const created = {
      id: settlementId,
      importe_sugerido: new Prisma.Decimal('35000'),
      importe_acordado: new Prisma.Decimal('36000'),
    };
    const saved = {
      ...settlement('ACORDADA', 0),
      cantidad_ventas: 1,
      importe_sugerido: created.importe_sugerido,
      importe_acordado: created.importe_acordado,
      politica_snapshot: {
        id: policy.id,
        tiers: [
          {
            id: policy.escalas_comisiones[0].id,
            minUnits: 1,
            maxUnits: null,
            fixedAmount: '35000.00',
          },
        ],
      },
      escala_snapshot: {
        id: policy.escalas_comisiones[0].id,
        minUnits: 1,
        maxUnits: null,
        fixedAmount: '35000.00',
      },
      operaciones_snapshot: [{ id: operation('MOTO').id, computable: true }],
    };
    const create = jest.fn().mockResolvedValue(created);
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      personal: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              where.usuario_id
                ? { id: sellerId, sucursal_principal_id: branchId }
                : { id: sellerId, nombre_completo: 'Vendedor' },
            ),
          ),
      },
      sucursales: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: branchId, nombre: 'Casa' }),
      },
      politicas_comisiones: { findFirst: jest.fn().mockResolvedValue(policy) },
      liquidaciones_comisiones: {
        findFirst: jest.fn().mockResolvedValue(null),
        create,
        findUniqueOrThrow: jest.fn().mockResolvedValue(saved),
      },
      operaciones: {
        findMany: jest.fn().mockResolvedValue([operation('MOTO')]),
      },
    };

    const result = await mutationService(transaction, {}).agree(
      suggestionId,
      {
        agreedAmount: '36000.00',
        meetingDate: '2026-08-29',
      },
      actor,
    );

    expect(result).toMatchObject({
      suggestedAmount: '35000.00',
      agreedAmount: '36000.00',
      scaleSnapshot: { fixedAmount: '35000.00' },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cantidad_ventas: 1,
          importe_sugerido: '35000.00',
          politica_snapshot: expect.objectContaining({ id: policy.id }),
          escala_snapshot: expect.objectContaining({
            fixedAmount: '35000.00',
          }),
          operaciones_snapshot: expect.arrayContaining([
            expect.objectContaining({
              computable: true,
              belowList: true,
            }),
          ]),
        }),
      }),
    );
  });

  function settlement(status: 'ACORDADA' | 'PAGADA', version = 2) {
    return {
      id: settlementId,
      organizacion_id: organizationId,
      personal_id: sellerId,
      sucursal_id: branchId,
      periodo_desde: new Date('2026-08-01T00:00:00.000Z'),
      periodo_hasta: new Date('2026-08-31T00:00:00.000Z'),
      tipo_vehiculo: 'MOTO',
      estado: status,
      cantidad_ventas: 13,
      importe_sugerido: new Prisma.Decimal('45000'),
      importe_acordado: new Prisma.Decimal('46000'),
      moneda: 'ARS',
      politica_snapshot: {},
      escala_snapshot: {
        id: 'tier',
        minUnits: 11,
        maxUnits: 15,
        fixedAmount: '45000.00',
      },
      operaciones_snapshot: [],
      fecha_reunion: new Date('2026-08-29T00:00:00.000Z'),
      notas: null,
      version_fila: version,
      acordado_en: new Date('2026-08-29T12:00:00.000Z'),
      pagado_en: null,
      pagado_por_personal_id: null,
      cuenta_caja_id: null,
      referencia_pago: null,
      comprobante_pago: null,
      observaciones_pago: null,
      movimiento_caja_id: null,
      gasto_id: null,
      clave_idempotencia_pago: null,
      hash_idempotencia_pago: null,
      creado_en: new Date('2026-08-29T12:00:00.000Z'),
      actualizado_en: new Date('2026-08-29T12:00:00.000Z'),
      personal_liquidaciones_comisiones_personal_idTopersonal: {
        id: sellerId,
        nombre_completo: 'Vendedor',
      },
      sucursales: { id: branchId, nombre: 'Casa' },
      personal_liquidaciones_comisiones_acordado_por_personal_idTopersonal:
        null,
    };
  }

  function mutationService(transaction: object, cash: object) {
    const audit = {
      execute: jest
        .fn()
        .mockImplementation(
          (_event: unknown, work: (tx: object) => Promise<unknown>) =>
            work(transaction),
        ),
    };
    return new CommissionsService(
      {} as PrismaService,
      audit as unknown as AuditService,
      cash as CashService,
    );
  }

  const payment = {
    idempotencyKey: '3020ed1d-6a91-497b-b227-e5398974e6e4',
    expectedVersion: 2,
    accountId: 'ed533c59-526d-45e8-aed4-f909aaaf09f4',
    paidAt: '2026-08-29T15:00:00.000Z',
    reference: 'TRX-123',
  };

  it('propagates a treasury failure before recording payment success', async () => {
    const update = jest.fn().mockResolvedValue({});
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: settlementId }]),
      liquidaciones_comisiones: {
        findFirst: jest.fn().mockResolvedValue(settlement('ACORDADA')),
        update,
      },
      personal: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: sellerId, sucursal_principal_id: branchId }),
      },
      gastos: {
        create: jest.fn().mockResolvedValue({ id: 'expense-id' }),
        update: jest.fn(),
      },
    };
    const cash = {
      registerEntityMovement: jest
        .fn()
        .mockRejectedValue(new Error('Treasury unavailable')),
    };

    await expect(
      mutationService(transaction, cash).pay(settlementId, payment, actor),
    ).rejects.toThrow('Treasury unavailable');
    expect(transaction.gastos.update).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { estado: 'PENDIENTE_PAGO' },
      }),
    );
  });

  it('locks the settlement and rejects stale concurrent payments', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: settlementId }]),
      liquidaciones_comisiones: {
        findFirst: jest.fn().mockResolvedValue(settlement('ACORDADA', 3)),
      },
    };
    const cash = { registerEntityMovement: jest.fn() };

    await expect(
      mutationService(transaction, cash).pay(settlementId, payment, actor),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'COMMISSION_STALE_VERSION' }),
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(cash.registerEntityMovement).not.toHaveBeenCalled();
  });

  it('prevents a second payment with a different idempotency key', async () => {
    const paid = {
      ...settlement('PAGADA', 3),
      clave_idempotencia_pago: 'previous-key',
      hash_idempotencia_pago: 'previous-hash',
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: settlementId }]),
      liquidaciones_comisiones: {
        findFirst: jest.fn().mockResolvedValue(paid),
      },
    };
    const cash = { registerEntityMovement: jest.fn() };

    await expect(
      mutationService(transaction, cash).pay(settlementId, payment, actor),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'COMMISSION_ALREADY_PAID' }),
    });
    expect(cash.registerEntityMovement).not.toHaveBeenCalled();
  });
});

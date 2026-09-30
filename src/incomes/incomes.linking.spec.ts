import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CashService } from '../cash/cash.service';
import { PrismaService } from '../prisma/prisma.service';
import { IncomesService, mapIncomeLinkError } from './incomes.service';

describe('IncomesService - fase 4 (vínculos y rendición)', () => {
  const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
  const branchId = '84e778cc-7616-4792-b6db-d89f100bb6f1';
  const operationId = '0a6b1e3c-5d3f-4b7e-9a1d-2c3b4a5d6e7f';
  const clientId = 'c1f0e8d2-7b6a-4c5d-8e9f-0a1b2c3d4e5f';
  const otherClientId = 'c2f0e8d2-7b6a-4c5d-8e9f-0a1b2c3d4e5f';
  const recipientId = '2c9f6b9a-1c55-4b1d-9d4c-6b4c3c1f0a11';
  const sellerPersonnelId = '5d6c0f0e-6a0b-4f4c-9f0e-2b1a8c7d6e55';
  const componentId = '9e8d7c6b-5a49-4382-9716-05f4e3d2c1b0';
  const actor: AuthenticatedUser = {
    id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
    email: 'admin@luma.test',
    name: 'Lucas',
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
      permissions: [
        'ingresos.consultar',
        'ingresos.gestionar',
        'ingresos.cobrar',
        'caja.recibir_rendicion',
      ],
    },
    branch: null,
    branchScope: { allBranches: true, branches: [] },
  };

  const baseIncome = {
    id: '7d5cc401-544e-4651-9bd6-52495887fecd',
    organizacion_id: organizationId,
    sucursal_id: branchId,
    fecha_ingreso: new Date('2026-09-20T00:00:00.000Z'),
    tipo_original: 'Cobro de operación',
    descripcion: 'Cobro efectivo',
    importe: new Prisma.Decimal('100000'),
    moneda: 'ARS',
    estado_registro: 'PAGADO',
    referencia: 'B-0001',
    unidad_vehiculo_id: null,
    operacion_id: operationId,
    cliente_id: clientId,
    componente_pago_id: null as string | null,
    medio_pago: 'EFECTIVO',
    cobrado_por_personal_id: sellerPersonnelId,
    rendido_a_personal_id: recipientId,
    estado_rendicion: 'PENDIENTE_RENDICION',
    rendicion_confirmada_en: null,
    rendicion_confirmada_por_personal_id: null,
    version_fila: 2,
    observaciones: null,
    es_transferencia: false,
    requiere_conciliacion: false,
    creado_en: new Date('2026-09-20T10:00:00.000Z'),
    actualizado_en: new Date('2026-09-20T10:00:00.000Z'),
    sucursales: { id: branchId, codigo: 'SM', nombre: 'San Miguel' },
    operaciones: {
      id: operationId,
      numero_operacion: BigInt(1048),
      numero_boleto: 'B-0001',
      cliente_id: clientId,
      versiones_vehiculos: { modelos_vehiculos: { tipo_vehiculo: 'MOTO' } },
    },
    clientes: {
      id: clientId,
      nombre_completo: 'Ana Pérez',
      tipo_documento: 'DNI',
      numero_documento: '12345678',
    },
    componentes_pago_operacion: null,
    unidades_vehiculos: null,
    personal: { id: sellerPersonnelId, nombre_completo: 'Vendedor' },
    rendido_a: { id: recipientId, nombre_completo: 'Lucas' },
    rendicion_confirmada_por: null,
    cuentas_caja: null,
    movimientos_caja: [],
  };

  const setup = (overrides: {
    income?: Partial<typeof baseIncome>;
    actorPersonnelId?: string;
    collected?: string;
  }) => {
    const income = { ...baseIncome, ...overrides.income };
    const update = jest.fn().mockResolvedValue({});
    const create = jest.fn().mockResolvedValue(income);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: income.id }]),
      $executeRaw: jest.fn(),
      ingresos: {
        findFirst: jest.fn().mockResolvedValue(income),
        update,
        create,
      },
      clientes: { findFirst: jest.fn().mockResolvedValue({ id: clientId }) },
      movimientos_caja: { findMany: jest.fn().mockResolvedValue([]) },
      componentes_pago_operacion: {
        findFirst: jest.fn().mockResolvedValue({
          importe_esperado: new Prisma.Decimal('100000'),
          estado_pago: 'PAGADO',
        }),
        update: jest.fn(),
      },
      personal: { findFirst: jest.fn().mockResolvedValue({ id: recipientId }) },
      $queryRawUnsafe: jest.fn(),
    } as unknown as Prisma.TransactionClient & Record<string, unknown>;
    // tipos_ingreso lookup is raw SQL
    (tx.$queryRaw as jest.Mock).mockImplementation(() =>
      Promise.resolve([{ id: income.id, exists: true }]),
    );
    const cash = {
      actorPersonnelId: jest
        .fn()
        .mockResolvedValue(overrides.actorPersonnelId ?? recipientId),
      settledAmount: jest
        .fn()
        .mockResolvedValue(new Prisma.Decimal(overrides.collected ?? '100000')),
      entityMovements: jest.fn().mockResolvedValue([]),
      branchOr400: jest.fn().mockResolvedValue({ id: branchId }),
      operationOr400: jest.fn().mockResolvedValue({
        id: operationId,
        sucursal_id: branchId,
        unidad_vehiculo_id: null,
        cliente_id: clientId,
      }),
      unitOr400: jest.fn(),
      reverseEntityMovement: jest.fn().mockResolvedValue({}),
    };
    const service = new IncomesService(
      {} as PrismaService,
      {
        execute: jest.fn(
          (
            _event: unknown,
            operation: (client: Prisma.TransactionClient) => Promise<unknown>,
          ) => operation(tx),
        ),
      } as unknown as AuditService,
      cash as unknown as CashService,
    );
    return { service, tx, update, create, cash };
  };

  const responseCode = (error: unknown) =>
    (error as ConflictException).getResponse() as { code: string };

  describe('confirmHandover', () => {
    it('lets only the recipient confirm and records who and when', async () => {
      const { service, update } = setup({});

      await service.confirmHandover(
        baseIncome.id,
        { expectedVersion: 2 },
        actor,
      );

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            estado_rendicion: 'RENDIDO',
            rendicion_confirmada_por_personal_id: recipientId,
            rendicion_confirmada_en: expect.any(Date) as Date,
            version_fila: { increment: 1 },
          }) as object,
        }),
      );
    });

    it('rejects any other personnel, even with the permission', async () => {
      const { service, update } = setup({
        actorPersonnelId: sellerPersonnelId,
      });

      const error = await service
        .confirmHandover(baseIncome.id, { expectedVersion: 2 }, actor)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(responseCode(error).code).toBe('HANDOVER_RECIPIENT_ONLY');
      expect(update).not.toHaveBeenCalled();
    });

    it('uses optimistic concurrency', async () => {
      const { service } = setup({});

      const error = await service
        .confirmHandover(baseIncome.id, { expectedVersion: 1 }, actor)
        .catch((caught: unknown) => caught);

      expect(responseCode(error).code).toBe('VERSION_CONFLICT');
    });

    it('does not confirm twice', async () => {
      const { service } = setup({ income: { estado_rendicion: 'RENDIDO' } });

      const error = await service
        .confirmHandover(baseIncome.id, { expectedVersion: 2 }, actor)
        .catch((caught: unknown) => caught);

      expect(responseCode(error).code).toBe('HANDOVER_NOT_PENDING');
    });

    it('requires an active collection to hand over', async () => {
      const { service } = setup({ collected: '0' });

      const error = await service
        .confirmHandover(baseIncome.id, { expectedVersion: 2 }, actor)
        .catch((caught: unknown) => caught);

      expect(responseCode(error).code).toBe('HANDOVER_NOT_COLLECTED');
    });
  });

  describe('client ↔ operation consistency', () => {
    it('takes the client from the operation when creating an income', async () => {
      const { service, create } = setup({});

      await service.create(
        {
          branchId,
          incomeDate: '2026-09-20',
          type: 'Seña',
          description: 'Seña',
          totalAmount: '50000.00',
          operationId,
        },
        actor,
      );

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operacion_id: operationId,
            cliente_id: clientId,
          }) as object,
        }),
      );
    });

    it('rejects a client different from the operation client', async () => {
      const { service, create } = setup({});

      const error = await service
        .create(
          {
            branchId,
            incomeDate: '2026-09-20',
            type: 'Seña',
            description: 'Seña',
            totalAmount: '50000.00',
            operationId,
            clientId: otherClientId,
          },
          actor,
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(responseCode(error).code).toBe('CLIENT_OPERATION_MISMATCH');
      expect(create).not.toHaveBeenCalled();
    });

    it('translates the database trigger into a domain error', () => {
      expect(() =>
        mapIncomeLinkError(
          new Error(
            'violates constraint ingresos_cliente_operacion_consistente',
          ),
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('incomes generated by a payment-plan collection', () => {
    it('keep their operation and amount', async () => {
      const { service, update } = setup({
        income: { componente_pago_id: componentId },
      });

      const error = await service
        .update(baseIncome.id, { totalAmount: '1.00' }, actor)
        .catch((caught: unknown) => caught);

      expect(responseCode(error).code).toBe('INCOME_LINKED_TO_COMPONENT');
      expect(update).not.toHaveBeenCalled();
    });

    it('resync the component status when a movement is reversed', async () => {
      const { service, tx } = setup({
        income: { componente_pago_id: componentId },
        collected: '0',
      });

      await service.reverse(
        baseIncome.id,
        '8346e2ae-490a-4815-b8bc-87a355656d11',
        {
          idempotencyKey: '7db0fc0c-891c-4126-a25c-e9d36ccf2dd8',
          reason: 'Duplicado',
        },
        actor,
      );

      const components = (
        tx as unknown as {
          componentes_pago_operacion: { update: jest.Mock };
        }
      ).componentes_pago_operacion;
      expect(components.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { estado_pago: 'PENDIENTE' } }),
      );
    });
  });

  it('locks method, collector and recipient once the cash was handed over', async () => {
    const { service, update } = setup({
      income: { estado_rendicion: 'RENDIDO' },
    });

    const error = await service
      .update(baseIncome.id, { handoverToId: sellerPersonnelId }, actor)
      .catch((caught: unknown) => caught);

    expect(responseCode(error).code).toBe('HANDOVER_ALREADY_CONFIRMED');
    expect(update).not.toHaveBeenCalled();
  });
});

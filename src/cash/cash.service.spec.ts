import { ConflictException } from '@nestjs/common';
import {
  direccion_caja_luma,
  Prisma,
  tipo_movimiento_caja_luma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { stableHash } from '../finance/finance.utils';
import { PrismaService } from '../prisma/prisma.service';
import { CashService } from './cash.service';

describe('CashService', () => {
  const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
  const actor: AuthenticatedUser = {
    id: '1f73d68f-6474-48bf-b95a-1f7d8ea94c75',
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
      code: 'ADMINISTRADOR',
      name: 'Administrador',
      system: true,
      permissions: ['caja.transferir', 'caja.reversar'],
    },
    branch: null,
  };

  function movement(overrides: Record<string, unknown> = {}) {
    return {
      id: '14b19aa6-08ae-4740-a954-79fa9e27c8a9',
      cuenta_caja_id: 'ed533c59-526d-45e8-aed4-f909aaaf09f4',
      tipo_movimiento: tipo_movimiento_caja_luma.INGRESO,
      direccion: direccion_caja_luma.CREDITO,
      importe: new Prisma.Decimal('50'),
      contabilizado_en: new Date('2026-08-20T10:00:00.000Z'),
      cobranza_id: null,
      transferencia_id: null,
      gasto_id: null,
      compra_proveedor_id: null,
      liquidacion_comision_id: null,
      revierte_a_id: null,
      referencia: null,
      notas: null,
      registrado_por_personal_id: 'f4b6ce19-ce56-4125-b058-e1f087c742bc',
      creado_en: new Date('2026-08-20T10:00:00.000Z'),
      organizacion_id: organizationId,
      ingreso_id: '20e42390-db9f-42bf-9db1-634f663e8ed2',
      es_importado: false,
      fila_importacion_id: null,
      datos_inferidos: {},
      clave_idempotencia: '41fbfa66-7804-4e78-8a9a-a1644ece9f43',
      hash_idempotencia: null,
      cuentas_caja: {
        id: 'ed533c59-526d-45e8-aed4-f909aaaf09f4',
        codigo: 'CAJA',
        nombre: 'Caja',
        tipo_cuenta: 'CAJA' as const,
      },
      personal: {
        id: 'f4b6ce19-ce56-4125-b058-e1f087c742bc',
        nombre_completo: 'Admin',
      },
      other_movimientos_caja: null,
      movimientos_caja: null,
      ...overrides,
    };
  }

  it('returns an existing movement for the same idempotent payload', async () => {
    const input = {
      idempotencyKey: '41fbfa66-7804-4e78-8a9a-a1644ece9f43',
      accountId: 'ed533c59-526d-45e8-aed4-f909aaaf09f4',
      amount: '50.00',
    };
    const source = {
      ingreso_id: '20e42390-db9f-42bf-9db1-634f663e8ed2',
    };
    const hash = stableHash({
      action: 'entity-movement',
      source,
      type: tipo_movimiento_caja_luma.INGRESO,
      direction: direccion_caja_luma.CREDITO,
      accountId: input.accountId,
      amount: '50.00',
      occurredAt: null,
      reference: null,
      notes: null,
    });
    const existing = movement({ hash_idempotencia: hash });
    const findFirst = jest.fn().mockResolvedValue({
      id: existing.id,
      hash_idempotencia: hash,
      transferencia_id: null,
    });
    const findUniqueOrThrow = jest.fn().mockResolvedValue(existing);
    const create = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
      movimientos_caja: { findFirst, findUniqueOrThrow, create },
    } as unknown as Prisma.TransactionClient;
    const service = new CashService({} as PrismaService, {} as AuditService);

    const result = await service.registerEntityMovement(
      tx,
      actor,
      organizationId,
      'ARS',
      input,
      source,
      tipo_movimiento_caja_luma.INGRESO,
      direccion_caja_luma.CREDITO,
    );

    expect(result.id).toBe(existing.id);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a second reversal of the same append-only movement', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        movement({
          other_movimientos_caja: {
            id: 'ba5babd4-bab1-442f-b060-0095938eb4b6',
          },
        }),
      );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'movement' }]),
      movimientos_caja: { findFirst, create: jest.fn() },
    } as unknown as Prisma.TransactionClient;
    const service = new CashService({} as PrismaService, {} as AuditService);

    await expect(
      service.reverseEntityMovement(
        tx,
        actor,
        organizationId,
        '14b19aa6-08ae-4740-a954-79fa9e27c8a9',
        {
          idempotencyKey: 'cb8d945e-b9ba-471a-a7a8-faa9b68202ca',
          reason: 'Corrección',
        },
        { ingreso_id: '20e42390-db9f-42bf-9db1-634f663e8ed2' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('omits amounts from purchase reversals without the sensitive permission', () => {
    const service = new CashService({} as PrismaService, {} as AuditService);
    const serialized = service.movement(
      movement({
        ingreso_id: null,
        revierte_a_id: '5e8423df-1515-40f1-8085-fe6811b2d59f',
        movimientos_caja: {
          compra_proveedor_id: '7d5cc401-544e-4651-9bd6-52495887fecd',
        },
      }),
      {
        ...actor,
        role: { ...actor.role, permissions: ['caja.consultar'] },
      },
    );

    expect(serialized).not.toHaveProperty('amount');
  });

  it('creates one debit and one credit for an internal transfer', async () => {
    const sourceAccount = {
      id: 'ed533c59-526d-45e8-aed4-f909aaaf09f4',
      moneda: 'ARS',
    };
    const destinationAccount = {
      id: '6b59b66d-6aba-4ec1-866b-89b74bf01aef',
      moneda: 'ARS',
    };
    const transferId = 'bb12e414-44cd-48e3-8750-92d3aef5dafc';
    const createMany = jest
      .fn<
        Promise<Prisma.BatchPayload>,
        [Prisma.movimientos_cajaCreateManyArgs]
      >()
      .mockResolvedValue({ count: 2 });
    const transferRecord = {
      id: transferId,
      cuenta_origen_id: sourceAccount.id,
      cuenta_destino_id: destinationAccount.id,
      importe: new Prisma.Decimal('75'),
      transferenciaido_en: new Date(),
      referencia: null,
      estado: 'CONTABILIZADA' as const,
      creado_por_personal_id: 'f4b6ce19-ce56-4125-b058-e1f087c742bc',
      creado_en: new Date(),
      actualizado_en: new Date(),
      organizacion_id: organizationId,
      cuentas_caja_transferencias_caja_cuenta_origen_idTocuentas_caja: {
        id: sourceAccount.id,
        codigo: 'CAJA',
        nombre: 'Caja',
        tipo_cuenta: 'CAJA' as const,
      },
      cuentas_caja_transferencias_caja_cuenta_destino_idTocuentas_caja: {
        id: destinationAccount.id,
        codigo: 'BANCO',
        nombre: 'Banco',
        tipo_cuenta: 'BANCO' as const,
      },
      personal: {
        id: 'f4b6ce19-ce56-4125-b058-e1f087c742bc',
        nombre_completo: 'Admin',
      },
      movimientos_caja_movimientos_caja_transferencia_idTotransferencias_caja:
        [],
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
      movimientos_caja: {
        findFirst: jest.fn().mockResolvedValue(null),
        createMany,
      },
      cuentas_caja: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(sourceAccount)
          .mockResolvedValueOnce(destinationAccount),
      },
      personal: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'f4b6ce19-ce56-4125-b058-e1f087c742bc',
        }),
      },
      transferencias_caja: {
        create: jest.fn().mockResolvedValue({ id: transferId }),
        findFirst: jest.fn().mockResolvedValue(transferRecord),
      },
    } as unknown as Prisma.TransactionClient;
    const execute = jest.fn(
      (
        _event: unknown,
        operation: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => operation(tx),
    );
    const service = new CashService(
      {} as PrismaService,
      { execute } as unknown as AuditService,
    );

    await service.createTransfer(
      {
        idempotencyKey: '3020ed1d-6a91-497b-b227-e5398974e6e4',
        sourceAccountId: sourceAccount.id,
        destinationAccountId: destinationAccount.id,
        amount: '75.00',
      },
      actor,
    );

    const movements = createMany.mock.calls[0]?.[0].data;
    expect(movements).toEqual([
      expect.objectContaining({
        cuenta_caja_id: sourceAccount.id,
        direccion: 'DEBITO',
        tipo_movimiento: 'TRANSFERENCIA_SALIENTE',
        importe: new Prisma.Decimal('75'),
      }),
      expect.objectContaining({
        cuenta_caja_id: destinationAccount.id,
        direccion: 'CREDITO',
        tipo_movimiento: 'TRANSFERENCIA_ENTRANTE',
        importe: new Prisma.Decimal('75'),
      }),
    ]);
  });
});

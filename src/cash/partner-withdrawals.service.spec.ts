import { Prisma } from '@prisma/client';
import type {
  AuditService,
  AuthenticatedAuditEvent,
} from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import type { CashService } from './cash.service';
import { PartnerWithdrawalsService } from './partner-withdrawals.service';

const ORG = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
const ACCOUNT = 'ed533c59-526d-45e8-aed4-f909aaaf09f4';
const BRANCH = '84e778cc-7616-4792-b6db-d89f100bb6f1';
const PARTNER = 'a1b6ce19-ce56-4125-b058-e1f087c742bc';
const ACTOR_PERSONNEL = 'f4b6ce19-ce56-4125-b058-e1f087c742bc';
const KEY = '41fbfa66-7804-4e78-8a9a-a1644ece9f43';

const actor: AuthenticatedUser = {
  id: '1f73d68f-6474-48bf-b95a-1f7d8ea94c75',
  email: 'admin@luma.test',
  name: 'Admin',
  active: true,
  globalAccess: false,
  organization: { id: ORG, code: 'LUMA', name: 'Luma', type: 'CASA_CENTRAL' },
  role: {
    id: '4bd1189b-2bb1-4258-889b-4500de5eeade',
    code: 'ADMINISTRADOR',
    name: 'Administrador',
    system: true,
    permissions: ['caja.retiros.gestionar', 'sucursales.todas'],
  },
  branch: null,
  branchScope: { allBranches: true, branches: [] },
};

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT,
    codigo: 'CAJA_LUCAS_SM',
    nombre: 'Caja Lucas San Miguel',
    tipo_cuenta: 'SOCIO',
    moneda: 'ARS',
    activo: true,
    es_importada: false,
    sucursal_id: BRANCH,
    personal_responsable_id: PARTNER,
    sucursales: { id: BRANCH, codigo: 'SM', nombre: 'San Miguel' },
    ...overrides,
  };
}

function withdrawal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w-1',
    organizacion_id: ORG,
    cuenta_caja_id: ACCOUNT,
    socio_personal_id: PARTNER,
    importe: new Prisma.Decimal('500000'),
    moneda: 'ARS',
    fecha: new Date('2026-10-05T00:00:00.000Z'),
    motivo: 'Adelanto de utilidades',
    estado: 'REGISTRADO',
    movimiento_caja_id: 'mov-1',
    reversa_movimiento_id: null,
    anulado_motivo: null,
    anulado_en: null,
    anulado_por_personal_id: null,
    creado_por_personal_id: ACTOR_PERSONNEL,
    creado_en: new Date('2026-10-05T14:00:00.000Z'),
    actualizado_en: new Date('2026-10-05T14:00:00.000Z'),
    ...overrides,
  };
}

interface CallArgs {
  data: Record<string, unknown>;
  where: Record<string, unknown>;
}

function firstArg(mock: jest.Mock): CallArgs {
  const calls = mock.mock.calls as CallArgs[][];
  return calls[0][0];
}

describe('PartnerWithdrawalsService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    movimientos_caja: { findFirst: jest.fn(), create: jest.fn() },
    cuentas_caja: { findFirst: jest.fn(), findMany: jest.fn() },
    personal: { findMany: jest.fn() },
    retiros_socio: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
  };
  const events: AuthenticatedAuditEvent[] = [];
  const audit = {
    execute: jest.fn(
      (
        event: AuthenticatedAuditEvent,
        operation: (client: typeof tx) => Promise<unknown>,
      ) => {
        events.push(event);
        return operation(tx);
      },
    ),
  };
  const cash = {
    actorPersonnelId: jest.fn().mockResolvedValue(ACTOR_PERSONNEL),
  };
  const prisma = {
    withTenant: jest.fn(
      (_scope: unknown, operation: (client: typeof tx) => unknown) =>
        Promise.resolve(operation(tx)),
    ),
  };
  let service: PartnerWithdrawalsService;
  const input = {
    idempotencyKey: KEY,
    accountId: ACCOUNT,
    amount: '500000.00',
    date: '2026-10-05',
    reason: ' Adelanto de utilidades ',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    events.length = 0;
    tx.movimientos_caja.findFirst.mockResolvedValue(null);
    tx.movimientos_caja.create.mockResolvedValue({ id: 'mov-1' });
    tx.cuentas_caja.findFirst.mockResolvedValue(account());
    tx.cuentas_caja.findMany.mockResolvedValue([account()]);
    tx.personal.findMany.mockResolvedValue([
      { id: PARTNER, nombre_completo: 'Lucas Medina' },
      { id: ACTOR_PERSONNEL, nombre_completo: 'Admin' },
    ]);
    tx.retiros_socio.create.mockResolvedValue(withdrawal());
    service = new PartnerWithdrawalsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      cash as unknown as CashService,
    );
  });

  it('registers a withdrawal in the name of the account partner as a cash debit', async () => {
    const result = await service.create(input, actor);

    expect(firstArg(tx.movimientos_caja.create).data).toMatchObject({
      cuenta_caja_id: ACCOUNT,
      tipo_movimiento: 'AJUSTE',
      direccion: 'DEBITO',
      importe: new Prisma.Decimal('500000'),
      contabilizado_en: new Date('2026-10-05T15:00:00.000Z'),
      notas: 'Retiro de socio: Adelanto de utilidades',
      registrado_por_personal_id: ACTOR_PERSONNEL,
      clave_idempotencia: KEY,
    });
    expect(firstArg(tx.retiros_socio.create).data).toMatchObject({
      cuenta_caja_id: ACCOUNT,
      socio_personal_id: PARTNER,
      moneda: 'ARS',
      motivo: 'Adelanto de utilidades',
      movimiento_caja_id: 'mov-1',
    });
    expect(result).toMatchObject({
      amount: '500000',
      currency: 'ARS',
      date: '2026-10-05',
      status: 'REGISTRADO',
      account: { name: 'Caja Lucas San Miguel' },
      branch: { name: 'San Miguel' },
      partner: { fullName: 'Lucas Medina' },
      registeredBy: { fullName: 'Admin' },
      reversal: null,
    });
    expect(events[0]).toMatchObject({
      action: 'PARTNER_WITHDRAWAL_REGISTERED',
      entity: 'retiros_socio',
      entityId: 'w-1',
      metadata: { partner: 'Lucas Medina', amount: '500000', currency: 'ARS' },
    });
  });

  it.each([
    [{ personal_responsable_id: null }, 'WITHDRAWAL_ACCOUNT_WITHOUT_PARTNER'],
    [{ es_importada: true }, 'HISTORIC_CASH_ACCOUNT'],
    [{ activo: false }, 'INVALID_CASH_ACCOUNT'],
  ])(
    'rejects an account that cannot hold a withdrawal %j',
    async (overrides, code) => {
      tx.cuentas_caja.findFirst.mockResolvedValue(account(overrides));

      await expect(service.create(input, actor)).rejects.toMatchObject({
        response: { code },
      });
      expect(tx.movimientos_caja.create).not.toHaveBeenCalled();
    },
  );

  it('returns the same withdrawal on a retry and does not audit it twice', async () => {
    const first = await service.create(input, actor);
    tx.movimientos_caja.findFirst.mockResolvedValue({
      id: 'mov-1',
      hash_idempotencia: firstArg(tx.movimientos_caja.create).data
        .hash_idempotencia as string,
    });
    tx.retiros_socio.findFirst.mockResolvedValue(withdrawal());

    const second = await service.create(input, actor);

    expect(second).toEqual(first);
    expect(tx.movimientos_caja.create).toHaveBeenCalledTimes(1);
    expect(events[1].skipRecord).toBe(true);
  });

  it('reverses a withdrawal with a counter-movement and keeps the record', async () => {
    tx.retiros_socio.findFirst.mockResolvedValue(withdrawal());
    tx.movimientos_caja.create.mockResolvedValue({ id: 'mov-2' });
    tx.retiros_socio.update.mockResolvedValue(
      withdrawal({
        estado: 'ANULADO',
        reversa_movimiento_id: 'mov-2',
        anulado_motivo: 'Cargado dos veces',
        anulado_en: new Date('2026-10-05T16:00:00.000Z'),
        anulado_por_personal_id: ACTOR_PERSONNEL,
      }),
    );

    const result = await service.reverse(
      'w-1',
      { idempotencyKey: KEY, reason: 'Cargado dos veces' },
      actor,
    );

    expect(firstArg(tx.movimientos_caja.create).data).toMatchObject({
      tipo_movimiento: 'INGRESO',
      direccion: 'CREDITO',
      importe: new Prisma.Decimal('500000'),
      revierte_a_id: 'mov-1',
      notas: 'Cargado dos veces',
      clave_idempotencia: KEY,
    });
    // La base exige clave y hash de idempotencia juntos.
    expect(firstArg(tx.movimientos_caja.create).data.hash_idempotencia).toEqual(
      expect.any(String),
    );
    expect(firstArg(tx.retiros_socio.update).data).toMatchObject({
      estado: 'ANULADO',
      reversa_movimiento_id: 'mov-2',
      anulado_motivo: 'Cargado dos veces',
    });
    expect(result).toMatchObject({
      status: 'ANULADO',
      reversal: { by: { fullName: 'Admin' }, reason: 'Cargado dos veces' },
    });
    expect(events[0].action).toBe('PARTNER_WITHDRAWAL_REVERSED');
  });

  it('returns the reversed withdrawal on a retry with the same key', async () => {
    const reversed = withdrawal({
      estado: 'ANULADO',
      reversa_movimiento_id: 'mov-2',
      anulado_motivo: 'Cargado dos veces',
      anulado_en: new Date('2026-10-05T16:00:00.000Z'),
      anulado_por_personal_id: ACTOR_PERSONNEL,
    });
    tx.retiros_socio.findFirst.mockResolvedValue(withdrawal());
    tx.movimientos_caja.create.mockResolvedValue({ id: 'mov-2' });
    tx.retiros_socio.update.mockResolvedValue(reversed);
    const request = { idempotencyKey: KEY, reason: 'Cargado dos veces' };
    await service.reverse('w-1', request, actor);
    tx.movimientos_caja.findFirst.mockResolvedValue({
      id: 'mov-2',
      hash_idempotencia: firstArg(tx.movimientos_caja.create).data
        .hash_idempotencia as string,
    });
    tx.retiros_socio.findFirst.mockResolvedValue(reversed);

    const again = await service.reverse('w-1', request, actor);

    expect(again).toMatchObject({ status: 'ANULADO' });
    expect(tx.movimientos_caja.create).toHaveBeenCalledTimes(1);
    expect(events[1].skipRecord).toBe(true);
  });

  it('rejects a withdrawal dated in the future', async () => {
    await expect(
      service.create({ ...input, date: '2999-01-01' }, actor),
    ).rejects.toMatchObject({
      response: { code: 'WITHDRAWAL_DATE_IN_FUTURE' },
    });
    expect(tx.movimientos_caja.create).not.toHaveBeenCalled();
  });

  it('does not reverse the same withdrawal twice', async () => {
    tx.retiros_socio.findFirst.mockResolvedValue(
      withdrawal({ estado: 'ANULADO' }),
    );

    await expect(
      service.reverse('w-1', { idempotencyKey: KEY, reason: 'x' }, actor),
    ).rejects.toMatchObject({ response: { code: 'ALREADY_REVERSED' } });
    expect(tx.movimientos_caja.create).not.toHaveBeenCalled();
  });

  it('lists withdrawals of the visible accounts and totals only the active ones', async () => {
    tx.retiros_socio.count.mockResolvedValue(1);
    tx.retiros_socio.findMany.mockResolvedValue([withdrawal()]);
    tx.retiros_socio.groupBy.mockResolvedValue([
      { moneda: 'ARS', _sum: { importe: new Prisma.Decimal('500000') } },
    ]);

    const page = await service.findAll(
      { page: 1, limit: 50, branchId: BRANCH, from: '2026-10-01' },
      actor,
    );

    expect(firstArg(tx.cuentas_caja.findMany).where.AND).toEqual([
      {},
      { sucursal_id: BRANCH },
    ]);
    expect(firstArg(tx.retiros_socio.findMany).where).toMatchObject({
      cuenta_caja_id: { in: [ACCOUNT] },
      fecha: { gte: new Date('2026-10-01T00:00:00.000Z') },
    });
    expect(firstArg(tx.retiros_socio.groupBy).where.estado).toBe('REGISTRADO');
    expect(page.totals).toEqual([{ currency: 'ARS', amount: '500000' }]);
    expect(page.items).toHaveLength(1);
  });
});

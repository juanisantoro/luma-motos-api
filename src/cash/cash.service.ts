import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  direccion_caja_luma,
  estado_transferencia_caja_luma,
  Prisma,
  tipo_movimiento_caja_luma,
} from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  CashAccountQueryDto,
  CashMovementQueryDto,
  CashTransferQueryDto,
  CreateCashAccountDto,
  CreateCashTransferDto,
  RegisterFinancialMovementDto,
  ReverseFinancialMovementDto,
  UpdateCashAccountDto,
} from '../finance/finance.dto';
import {
  financialBadRequest,
  financialConflict,
  financialNotFound,
} from '../finance/finance.errors';
import {
  assertOrganization,
  decimal,
  scope,
  stableHash,
  targetOrganization,
} from '../finance/finance.utils';
import { PrismaService } from '../prisma/prisma.service';

const movementInclude = {
  cuentas_caja: {
    select: { id: true, codigo: true, nombre: true, tipo_cuenta: true },
  },
  personal: { select: { id: true, nombre_completo: true } },
  other_movimientos_caja: { select: { id: true } },
  movimientos_caja: { select: { compra_proveedor_id: true } },
} satisfies Prisma.movimientos_cajaInclude;

type MovementRecord = Prisma.movimientos_cajaGetPayload<{
  include: typeof movementInclude;
}>;

const accountInclude = {
  sucursales: { select: { id: true, codigo: true, nombre: true } },
  personal: { select: { id: true, nombre_completo: true } },
} satisfies Prisma.cuentas_cajaInclude;

const transferInclude = {
  cuentas_caja_transferencias_caja_cuenta_origen_idTocuentas_caja: {
    select: { id: true, codigo: true, nombre: true, tipo_cuenta: true },
  },
  cuentas_caja_transferencias_caja_cuenta_destino_idTocuentas_caja: {
    select: { id: true, codigo: true, nombre: true, tipo_cuenta: true },
  },
  personal: { select: { id: true, nombre_completo: true } },
  movimientos_caja_movimientos_caja_transferencia_idTotransferencias_caja: {
    include: movementInclude,
    orderBy: [{ creado_en: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.transferencias_cajaInclude;

type TransferRecord = Prisma.transferencias_cajaGetPayload<{
  include: typeof transferInclude;
}>;

@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAccounts(query: CashAccountQueryDto, actor: AuthenticatedUser) {
    assertOrganization(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const search = query.search?.trim();
    const where: Prisma.cuentas_cajaWhereInput = {
      organizacion_id: organizationId,
      tipo_cuenta: query.type,
      sucursal_id: query.branchId,
      activo: query.active,
      OR: search
        ? [
            { codigo: { contains: search, mode: 'insensitive' } },
            { nombre: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    return this.prisma.withTenant(scope(actor), async (tx) => {
      const [total, accounts] = await Promise.all([
        tx.cuentas_caja.count({ where }),
        tx.cuentas_caja.findMany({
          where,
          include: accountInclude,
          orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ]);
      const balances = await this.accountBalances(
        tx,
        accounts.map((account) => account.id),
      );
      return {
        items: accounts.map((account) =>
          this.account(account, balances.get(account.id)),
        ),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async findAccount(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(scope(actor), async (tx) => {
      const account = await tx.cuentas_caja.findFirst({
        where: {
          id,
          organizacion_id: actor.globalAccess
            ? undefined
            : actor.organization.id,
        },
        include: accountInclude,
      });
      if (!account) financialNotFound('Cash account');
      const balances = await this.accountBalances(tx, [id]);
      return this.account(account, balances.get(id));
    });
  }

  async createAccount(input: CreateCashAccountDto, actor: AuthenticatedUser) {
    assertOrganization(actor, input.organizationId);
    const organizationId = input.organizationId ?? actor.organization.id;
    return this.mutate(
      actor,
      'CASH_ACCOUNT_CREATED',
      'cuentas_caja',
      async (tx, event) => {
        if (input.branchId)
          await this.branchOr400(tx, input.branchId, organizationId);
        if (input.responsiblePersonnelId)
          await this.personnelOr400(
            tx,
            input.responsiblePersonnelId,
            organizationId,
          );
        const account = await tx.cuentas_caja.create({
          data: {
            codigo: input.code.trim().toUpperCase(),
            nombre: input.name.trim(),
            tipo_cuenta: input.type,
            sucursal_id: input.branchId,
            personal_responsable_id: input.responsiblePersonnelId,
            moneda: input.currency ?? 'ARS',
            activo: input.active ?? true,
            organizacion_id: organizationId,
          },
          include: accountInclude,
        });
        event.entityId = account.id;
        return this.account(account, new Prisma.Decimal(0));
      },
      undefined,
      organizationId,
    );
  }

  async updateAccount(
    id: string,
    input: UpdateCashAccountDto,
    actor: AuthenticatedUser,
  ) {
    if (!Object.keys(input).length)
      throw new BadRequestException('At least one editable field is required');
    return this.mutate(
      actor,
      'CASH_ACCOUNT_UPDATED',
      'cuentas_caja',
      async (tx, event) => {
        const current = await this.accountOr404(tx, id, actor, true);
        event.targetOrganizationId = targetOrganization(
          actor,
          current.organizacion_id,
        );
        if (input.branchId)
          await this.branchOr400(tx, input.branchId, current.organizacion_id);
        if (input.responsiblePersonnelId)
          await this.personnelOr400(
            tx,
            input.responsiblePersonnelId,
            current.organizacion_id,
          );
        const updated = await tx.cuentas_caja.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: current.organizacion_id,
            },
          },
          data: {
            nombre: input.name?.trim(),
            tipo_cuenta: input.type,
            sucursal_id: input.branchId,
            personal_responsable_id: input.responsiblePersonnelId,
            activo: input.active,
          },
          include: accountInclude,
        });
        const balances = await this.accountBalances(tx, [id]);
        return this.account(updated, balances.get(id));
      },
      id,
    );
  }

  async findMovements(query: CashMovementQueryDto, actor: AuthenticatedUser) {
    assertOrganization(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const search = query.search?.trim();
    const where: Prisma.movimientos_cajaWhereInput = {
      organizacion_id: organizationId,
      cuenta_caja_id: query.accountId,
      tipo_movimiento: query.type,
      direccion: query.direction,
      contabilizado_en:
        query.from || query.to
          ? {
              gte: query.from ? new Date(query.from) : undefined,
              lte: query.to ? new Date(query.to) : undefined,
            }
          : undefined,
      OR: search
        ? [
            { referencia: { contains: search, mode: 'insensitive' } },
            { notas: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [total, items] = await this.prisma.withTenant(scope(actor), (tx) =>
      Promise.all([
        tx.movimientos_caja.count({ where }),
        tx.movimientos_caja.findMany({
          where,
          include: movementInclude,
          orderBy: [{ contabilizado_en: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ]),
    );
    return {
      items: items.map((item) => this.movement(item, actor)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findTransfers(query: CashTransferQueryDto, actor: AuthenticatedUser) {
    assertOrganization(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const where: Prisma.transferencias_cajaWhereInput = {
      organizacion_id: organizationId,
      OR: query.accountId
        ? [
            { cuenta_origen_id: query.accountId },
            { cuenta_destino_id: query.accountId },
          ]
        : undefined,
      transferenciaido_en:
        query.from || query.to
          ? {
              gte: query.from ? new Date(query.from) : undefined,
              lte: query.to ? new Date(query.to) : undefined,
            }
          : undefined,
    };
    const [total, items] = await this.prisma.withTenant(scope(actor), (tx) =>
      Promise.all([
        tx.transferencias_caja.count({ where }),
        tx.transferencias_caja.findMany({
          where,
          include: transferInclude,
          orderBy: [{ transferenciaido_en: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ]),
    );
    return {
      items: items.map((item) => this.transfer(item, actor)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findTransfer(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(scope(actor), async (tx) =>
      this.transfer(await this.transferOr404(tx, id, actor), actor),
    );
  }

  async createTransfer(input: CreateCashTransferDto, actor: AuthenticatedUser) {
    assertOrganization(actor, input.organizationId);
    const organizationId = input.organizationId ?? actor.organization.id;
    const amount = decimal(input.amount);
    const occurredAt = input.occurredAt
      ? this.timestamp(input.occurredAt)
      : new Date();
    const hash = stableHash({
      action: 'transfer',
      sourceAccountId: input.sourceAccountId,
      destinationAccountId: input.destinationAccountId,
      amount: amount.toFixed(2),
      occurredAt: input.occurredAt ?? null,
      reference: input.reference?.trim() ?? null,
      notes: input.notes?.trim() ?? null,
    });
    return this.mutate(
      actor,
      'CASH_TRANSFER_CREATED',
      'transferencias_caja',
      async (tx, event) => {
        const repeated = await this.idempotentMovement(
          tx,
          organizationId,
          input.idempotencyKey,
          hash,
        );
        if (repeated?.transferencia_id) {
          return this.transfer(
            await this.transferByIdOr404(
              tx,
              repeated.transferencia_id,
              organizationId,
            ),
            actor,
          );
        }
        if (input.sourceAccountId === input.destinationAccountId)
          financialBadRequest(
            'INVALID_TRANSFER_ACCOUNTS',
            'Source and destination accounts must be different',
          );
        const source = await this.activeAccountOr400(
          tx,
          input.sourceAccountId,
          organizationId,
        );
        const destination = await this.activeAccountOr400(
          tx,
          input.destinationAccountId,
          organizationId,
        );
        if (source.moneda !== destination.moneda)
          financialBadRequest(
            'CURRENCY_MISMATCH',
            'Transfer accounts must use the same currency',
          );
        const personnelId = await this.actorPersonnelId(
          tx,
          actor,
          organizationId,
        );
        const transfer = await tx.transferencias_caja.create({
          data: {
            cuenta_origen_id: source.id,
            cuenta_destino_id: destination.id,
            importe: amount,
            transferenciaido_en: occurredAt,
            referencia: input.reference?.trim(),
            estado: estado_transferencia_caja_luma.CONTABILIZADA,
            creado_por_personal_id: personnelId,
            organizacion_id: organizationId,
          },
        });
        event.entityId = transfer.id;
        await tx.movimientos_caja.createMany({
          data: [
            {
              cuenta_caja_id: source.id,
              tipo_movimiento: tipo_movimiento_caja_luma.TRANSFERENCIA_SALIENTE,
              direccion: direccion_caja_luma.DEBITO,
              importe: amount,
              contabilizado_en: occurredAt,
              transferencia_id: transfer.id,
              referencia: input.reference?.trim(),
              notas: input.notes?.trim(),
              registrado_por_personal_id: personnelId,
              organizacion_id: organizationId,
              clave_idempotencia: input.idempotencyKey,
              hash_idempotencia: hash,
            },
            {
              cuenta_caja_id: destination.id,
              tipo_movimiento: tipo_movimiento_caja_luma.TRANSFERENCIA_ENTRANTE,
              direccion: direccion_caja_luma.CREDITO,
              importe: amount,
              contabilizado_en: occurredAt,
              transferencia_id: transfer.id,
              referencia: input.reference?.trim(),
              notas: input.notes?.trim(),
              registrado_por_personal_id: personnelId,
              organizacion_id: organizationId,
              clave_idempotencia: `${input.idempotencyKey}:credit`,
              hash_idempotencia: hash,
            },
          ],
        });
        return this.transfer(
          await this.transferByIdOr404(tx, transfer.id, organizationId),
          actor,
        );
      },
      undefined,
      organizationId,
    );
  }

  async reverseTransfer(
    id: string,
    input: ReverseFinancialMovementDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'CASH_TRANSFER_REVERSED',
      'transferencias_caja',
      async (tx, event) => {
        const transfer = await this.transferOr404(tx, id, actor, true);
        event.targetOrganizationId = targetOrganization(
          actor,
          transfer.organizacion_id,
        );
        const hash = stableHash({
          action: 'reverse-transfer',
          transferId: id,
          reason: input.reason.trim(),
        });
        const repeated = await this.idempotentMovement(
          tx,
          transfer.organizacion_id,
          input.idempotencyKey,
          hash,
        );
        if (repeated)
          return this.transfer(
            await this.transferByIdOr404(
              tx,
              transfer.id,
              transfer.organizacion_id,
            ),
            actor,
          );
        if (transfer.estado === estado_transferencia_caja_luma.CANCELADA)
          financialConflict(
            'ALREADY_REVERSED',
            'Cash transfer is already reversed',
          );
        const originals =
          transfer.movimientos_caja_movimientos_caja_transferencia_idTotransferencias_caja.filter(
            (movement) => movement.revierte_a_id === null,
          );
        if (originals.length !== 2)
          financialConflict(
            'UNBALANCED_TRANSFER',
            'Cash transfer does not have exactly two original movements',
          );
        if (originals.some((movement) => movement.other_movimientos_caja))
          financialConflict(
            'ALREADY_REVERSED',
            'Cash transfer contains a reversed movement',
          );
        const personnelId = await this.actorPersonnelId(
          tx,
          actor,
          transfer.organizacion_id,
        );
        for (const [index, original] of originals.entries()) {
          await tx.movimientos_caja.create({
            data: {
              cuenta_caja_id: original.cuenta_caja_id,
              tipo_movimiento:
                original.direccion === direccion_caja_luma.CREDITO
                  ? tipo_movimiento_caja_luma.EGRESO
                  : tipo_movimiento_caja_luma.INGRESO,
              direccion:
                original.direccion === direccion_caja_luma.CREDITO
                  ? direccion_caja_luma.DEBITO
                  : direccion_caja_luma.CREDITO,
              importe: original.importe,
              contabilizado_en: new Date(),
              revierte_a_id: original.id,
              referencia: transfer.referencia,
              notas: input.reason.trim(),
              registrado_por_personal_id: personnelId,
              organizacion_id: transfer.organizacion_id,
              clave_idempotencia:
                index === 0
                  ? input.idempotencyKey
                  : `${input.idempotencyKey}:credit`,
              hash_idempotencia: hash,
            },
          });
        }
        await tx.transferencias_caja.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: transfer.organizacion_id,
            },
          },
          data: { estado: estado_transferencia_caja_luma.CANCELADA },
        });
        return this.transfer(
          await this.transferByIdOr404(
            tx,
            transfer.id,
            transfer.organizacion_id,
          ),
          actor,
        );
      },
      id,
    );
  }

  async registerEntityMovement(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    organizationId: string,
    currency: string,
    input: RegisterFinancialMovementDto,
    source:
      | { compra_proveedor_id: string }
      | { ingreso_id: string }
      | { gasto_id: string },
    type: tipo_movimiento_caja_luma,
    direction: direccion_caja_luma,
  ): Promise<MovementRecord> {
    const amount = decimal(input.amount);
    const occurredAt = input.occurredAt
      ? this.timestamp(input.occurredAt)
      : new Date();
    const hash = stableHash({
      action: 'entity-movement',
      source,
      type,
      direction,
      accountId: input.accountId,
      amount: amount.toFixed(2),
      occurredAt: input.occurredAt ?? null,
      reference: input.reference?.trim() ?? null,
      notes: input.notes?.trim() ?? null,
    });
    const repeated = await this.idempotentMovement(
      tx,
      organizationId,
      input.idempotencyKey,
      hash,
    );
    if (repeated)
      return tx.movimientos_caja.findUniqueOrThrow({
        where: { id: repeated.id },
        include: movementInclude,
      });
    const account = await this.activeAccountOr400(
      tx,
      input.accountId,
      organizationId,
    );
    if (account.moneda !== currency)
      financialBadRequest(
        'CURRENCY_MISMATCH',
        'Cash account currency must match the financial record',
      );
    return tx.movimientos_caja.create({
      data: {
        cuenta_caja_id: account.id,
        tipo_movimiento: type,
        direccion: direction,
        importe: amount,
        contabilizado_en: occurredAt,
        ...source,
        referencia: input.reference?.trim(),
        notas: input.notes?.trim(),
        registrado_por_personal_id: await this.actorPersonnelId(
          tx,
          actor,
          organizationId,
        ),
        organizacion_id: organizationId,
        clave_idempotencia: input.idempotencyKey,
        hash_idempotencia: hash,
      },
      include: movementInclude,
    });
  }

  async reverseEntityMovement(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    organizationId: string,
    movementId: string,
    input: ReverseFinancialMovementDto,
    sourceWhere: Prisma.movimientos_cajaWhereInput,
  ): Promise<MovementRecord> {
    const hash = stableHash({
      action: 'reverse-entity-movement',
      movementId,
      reason: input.reason.trim(),
    });
    const repeated = await this.idempotentMovement(
      tx,
      organizationId,
      input.idempotencyKey,
      hash,
    );
    if (repeated)
      return tx.movimientos_caja.findUniqueOrThrow({
        where: { id: repeated.id },
        include: movementInclude,
      });
    await tx.$queryRaw`
      SELECT "id"
      FROM "public"."movimientos_caja"
      WHERE "id" = CAST(${movementId} AS uuid)
        AND "organizacion_id" = CAST(${organizationId} AS uuid)
      FOR UPDATE
    `;
    const original = await tx.movimientos_caja.findFirst({
      where: {
        id: movementId,
        organizacion_id: organizationId,
        revierte_a_id: null,
        ...sourceWhere,
      },
      include: movementInclude,
    });
    if (!original) financialNotFound('Cash movement');
    if (original.other_movimientos_caja)
      financialConflict(
        'ALREADY_REVERSED',
        'Cash movement is already reversed',
      );
    return tx.movimientos_caja.create({
      data: {
        cuenta_caja_id: original.cuenta_caja_id,
        tipo_movimiento:
          original.direccion === direccion_caja_luma.CREDITO
            ? tipo_movimiento_caja_luma.EGRESO
            : tipo_movimiento_caja_luma.INGRESO,
        direccion:
          original.direccion === direccion_caja_luma.CREDITO
            ? direccion_caja_luma.DEBITO
            : direccion_caja_luma.CREDITO,
        importe: original.importe,
        contabilizado_en: new Date(),
        revierte_a_id: original.id,
        referencia: original.referencia,
        notas: input.reason.trim(),
        registrado_por_personal_id: await this.actorPersonnelId(
          tx,
          actor,
          organizationId,
        ),
        organizacion_id: organizationId,
        clave_idempotencia: input.idempotencyKey,
        hash_idempotencia: hash,
      },
      include: movementInclude,
    });
  }

  async settledAmount(
    tx: Prisma.TransactionClient,
    where: Prisma.movimientos_cajaWhereInput,
    type: tipo_movimiento_caja_luma,
  ): Promise<Prisma.Decimal> {
    const movements = await tx.movimientos_caja.findMany({
      where: {
        ...where,
        tipo_movimiento: type,
        revierte_a_id: null,
        other_movimientos_caja: null,
      },
      select: { importe: true },
    });
    return movements.reduce(
      (total, movement) => total.plus(movement.importe),
      new Prisma.Decimal(0),
    );
  }

  async entityMovements(
    tx: Prisma.TransactionClient,
    where: Prisma.movimientos_cajaWhereInput,
    actor: AuthenticatedUser,
  ) {
    const items = await tx.movimientos_caja.findMany({
      where,
      include: movementInclude,
      orderBy: [{ contabilizado_en: 'desc' }, { id: 'desc' }],
    });
    return items.map((item) => this.movement(item, actor));
  }

  movement(item: MovementRecord, actor: AuthenticatedUser) {
    const sensitivePurchase =
      (Boolean(item.compra_proveedor_id) ||
        Boolean(item.movimientos_caja?.compra_proveedor_id)) &&
      !actor.role.permissions.includes('compras.costos.consultar');
    return {
      id: item.id,
      account: {
        id: item.cuentas_caja.id,
        code: item.cuentas_caja.codigo,
        name: item.cuentas_caja.nombre,
        type: item.cuentas_caja.tipo_cuenta,
      },
      type: item.tipo_movimiento,
      direction: item.direccion,
      ...(sensitivePurchase ? {} : { amount: item.importe.toString() }),
      occurredAt: item.contabilizado_en,
      reference: item.referencia,
      notes: item.notas,
      registeredBy: {
        id: item.personal.id,
        fullName: item.personal.nombre_completo,
      },
      reversed: item.other_movimientos_caja !== null,
      reversalOfId: item.revierte_a_id,
      sourceType: this.sourceType(item),
      sourceId: this.sourceId(item),
      createdAt: item.creado_en,
    };
  }

  async actorPersonnelId(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    organizationId: string,
  ) {
    const personnel = await tx.personal.findFirst({
      where: {
        usuario_id: actor.id,
        organizacion_id: organizationId,
        estado: 'ACTIVO',
      },
      select: { id: true },
    });
    if (!personnel)
      throw new ForbiddenException(
        'Actor does not have an active personnel profile in the organization',
      );
    return personnel.id;
  }

  async branchOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const branch = await tx.sucursales.findFirst({
      where: { id, organizacion_id: organizationId, activa: true },
      select: { id: true },
    });
    if (!branch)
      financialBadRequest('INVALID_BRANCH', 'Branch is invalid or inactive');
  }

  async unitOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const unit = await tx.unidades_vehiculos.findFirst({
      where: { id, organizacion_id: organizationId },
      select: { id: true, version_id: true, sucursal_id: true },
    });
    if (!unit) financialBadRequest('INVALID_UNIT', 'Inventory unit is invalid');
    return unit;
  }

  async operationOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const operation = await tx.operaciones.findFirst({
      where: { id, organizacion_id: organizationId },
      select: { id: true, unidad_vehiculo_id: true, sucursal_id: true },
    });
    if (!operation)
      financialBadRequest('INVALID_OPERATION', 'Sales operation is invalid');
    return operation;
  }

  private async accountBalances(
    tx: Prisma.TransactionClient,
    accountIds: string[],
  ) {
    const balances = new Map<string, Prisma.Decimal>();
    if (!accountIds.length) return balances;
    const movements = await tx.movimientos_caja.findMany({
      where: {
        cuenta_caja_id: { in: accountIds },
        revierte_a_id: null,
        other_movimientos_caja: null,
      },
      select: { cuenta_caja_id: true, direccion: true, importe: true },
    });
    for (const movement of movements) {
      const current =
        balances.get(movement.cuenta_caja_id) ?? new Prisma.Decimal(0);
      balances.set(
        movement.cuenta_caja_id,
        movement.direccion === direccion_caja_luma.CREDITO
          ? current.plus(movement.importe)
          : current.minus(movement.importe),
      );
    }
    return balances;
  }

  private account(
    item: Prisma.cuentas_cajaGetPayload<{ include: typeof accountInclude }>,
    balance = new Prisma.Decimal(0),
  ) {
    return {
      id: item.id,
      code: item.codigo,
      name: item.nombre,
      type: item.tipo_cuenta,
      currency: item.moneda,
      active: item.activo,
      organizationId: item.organizacion_id,
      balance: balance.toString(),
      branch: item.sucursales
        ? {
            id: item.sucursales.id,
            code: item.sucursales.codigo,
            name: item.sucursales.nombre,
          }
        : null,
      responsiblePersonnel: item.personal
        ? { id: item.personal.id, fullName: item.personal.nombre_completo }
        : null,
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
    };
  }

  private transfer(item: TransferRecord, actor: AuthenticatedUser) {
    return {
      id: item.id,
      amount: item.importe.toString(),
      occurredAt: item.transferenciaido_en,
      reference: item.referencia,
      status:
        item.estado === estado_transferencia_caja_luma.CONTABILIZADA
          ? 'CONFIRMADA'
          : item.estado === estado_transferencia_caja_luma.CANCELADA
            ? 'REVERSADA'
            : 'PENDIENTE',
      organizationId: item.organizacion_id,
      sourceAccount: this.accountReference(
        item.cuentas_caja_transferencias_caja_cuenta_origen_idTocuentas_caja,
      ),
      destinationAccount: this.accountReference(
        item.cuentas_caja_transferencias_caja_cuenta_destino_idTocuentas_caja,
      ),
      createdBy: {
        id: item.personal.id,
        fullName: item.personal.nombre_completo,
      },
      movements:
        item.movimientos_caja_movimientos_caja_transferencia_idTotransferencias_caja.map(
          (movement) => this.movement(movement, actor),
        ),
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
    };
  }

  private accountReference(item: {
    id: string;
    codigo: string;
    nombre: string;
    tipo_cuenta: string;
  }) {
    return {
      id: item.id,
      code: item.codigo,
      name: item.nombre,
      type: item.tipo_cuenta,
    };
  }

  private sourceType(item: MovementRecord) {
    if (item.compra_proveedor_id) return 'PURCHASE';
    if (item.ingreso_id) return 'INCOME';
    if (item.gasto_id) return 'EXPENSE';
    if (item.transferencia_id) return 'TRANSFER';
    if (item.revierte_a_id) return 'REVERSAL';
    return 'OTHER';
  }

  private sourceId(item: MovementRecord) {
    return (
      item.compra_proveedor_id ??
      item.ingreso_id ??
      item.gasto_id ??
      item.transferencia_id ??
      item.revierte_a_id ??
      null
    );
  }

  private async idempotentMovement(
    tx: Prisma.TransactionClient,
    organizationId: string,
    key: string,
    hash: string,
  ) {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${organizationId}:${key}`}, 0)
      )
    `;
    const existing = await tx.movimientos_caja.findFirst({
      where: {
        organizacion_id: organizationId,
        clave_idempotencia: key,
      },
      select: {
        id: true,
        hash_idempotencia: true,
        transferencia_id: true,
      },
    });
    if (existing && existing.hash_idempotencia !== hash)
      financialConflict(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used with a different payload',
      );
    return existing;
  }

  private async activeAccountOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const account = await tx.cuentas_caja.findFirst({
      where: { id, organizacion_id: organizationId, activo: true },
      select: { id: true, moneda: true },
    });
    if (!account)
      financialBadRequest(
        'INVALID_CASH_ACCOUNT',
        'Cash account is invalid or inactive',
      );
    return account;
  }

  private async personnelOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const personnel = await tx.personal.findFirst({
      where: { id, organizacion_id: organizationId, estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!personnel)
      financialBadRequest(
        'INVALID_PERSONNEL',
        'Personnel is invalid or inactive',
      );
  }

  private async accountOr404(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
    lock = false,
  ) {
    if (lock)
      await tx.$queryRaw`
        SELECT "id"
        FROM "public"."cuentas_caja"
        WHERE "id" = CAST(${id} AS uuid)
          AND (${actor.globalAccess} OR "organizacion_id" = CAST(${actor.organization.id} AS uuid))
        FOR UPDATE
      `;
    const account = await tx.cuentas_caja.findFirst({
      where: {
        id,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
      },
      include: accountInclude,
    });
    if (!account) financialNotFound('Cash account');
    return account;
  }

  private async transferOr404(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
    lock = false,
  ) {
    if (lock)
      await tx.$queryRaw`
        SELECT "id"
        FROM "public"."transferencias_caja"
        WHERE "id" = CAST(${id} AS uuid)
          AND (${actor.globalAccess} OR "organizacion_id" = CAST(${actor.organization.id} AS uuid))
        FOR UPDATE
      `;
    const transfer = await tx.transferencias_caja.findFirst({
      where: {
        id,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
      },
      include: transferInclude,
    });
    if (!transfer) financialNotFound('Cash transfer');
    return transfer;
  }

  private async transferByIdOr404(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const transfer = await tx.transferencias_caja.findFirst({
      where: { id, organizacion_id: organizationId },
      include: transferInclude,
    });
    if (!transfer) financialNotFound('Cash transfer');
    return transfer;
  }

  private timestamp(value: string) {
    const result = new Date(value);
    if (Number.isNaN(result.getTime()))
      financialBadRequest('INVALID_TIMESTAMP', 'Timestamp is invalid');
    return result;
  }

  private mutate<T>(
    actor: AuthenticatedUser,
    action: string,
    entity: string,
    work: (
      tx: Prisma.TransactionClient,
      event: AuthenticatedAuditEvent,
    ) => Promise<T>,
    entityId?: string,
    organizationId?: string,
  ) {
    const event: AuthenticatedAuditEvent = {
      action,
      entity,
      entityId,
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId: targetOrganization(actor, organizationId),
    };
    return this.audit
      .execute(event, (tx) => work(tx, event))
      .catch((error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException(
            'A financial record conflicts with another request',
          );
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        )
          throw new BadRequestException('A referenced record is invalid');
        throw error;
      });
  }
}

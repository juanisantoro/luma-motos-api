import { Injectable } from '@nestjs/common';
import {
  direccion_caja_luma,
  Prisma,
  tipo_movimiento_caja_luma,
} from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BranchScope } from '../branch-scope/branch-scope';
import {
  CreatePartnerWithdrawalDto,
  PartnerWithdrawalQueryDto,
  ReverseFinancialMovementDto,
} from '../finance/finance.dto';
import {
  financialBadRequest,
  financialConflict,
  financialNotFound,
} from '../finance/finance.errors';
import {
  businessDate,
  decimal,
  scope,
  stableHash,
} from '../finance/finance.utils';
import { PrismaService } from '../prisma/prisma.service';
import { CashService } from './cash.service';

type Tx = Prisma.TransactionClient;
type WithdrawalRow = Prisma.retiros_socioGetPayload<Record<string, never>>;

const accountSelect = {
  id: true,
  codigo: true,
  nombre: true,
  tipo_cuenta: true,
  moneda: true,
  activo: true,
  es_importada: true,
  sucursal_id: true,
  personal_responsable_id: true,
  sucursales: { select: { id: true, codigo: true, nombre: true } },
} satisfies Prisma.cuentas_cajaSelect;

/**
 * Retiros de socios: plata que un socio saca de una caja de la que es
 * responsable. No son gastos: salen de la caja pero no del resultado del mes.
 *
 * Cada retiro crea un movimiento AJUSTE / DEBITO. Como los movimientos son
 * inmutables, anular un retiro registra el contramovimiento y lo deja
 * ANULADO; nunca se borra.
 */
@Injectable()
export class PartnerWithdrawalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
  ) {}

  async findAll(query: PartnerWithdrawalQueryDto, actor: AuthenticatedUser) {
    return this.prisma.withTenant(scope(actor), async (tx) => {
      // Sólo las cajas que el usuario puede ver (y la sucursal pedida).
      const accounts = await tx.cuentas_caja.findMany({
        where: {
          AND: [
            BranchScope.forActor(
              actor,
            ).whereSharedOrInScope<Prisma.cuentas_cajaWhereInput>() ?? {},
            query.branchId ? { sucursal_id: query.branchId } : {},
          ],
          organizacion_id: actor.globalAccess
            ? undefined
            : actor.organization.id,
          id: query.accountId,
        },
        select: { id: true },
      });
      const where: Prisma.retiros_socioWhereInput = {
        cuenta_caja_id: { in: accounts.map((account) => account.id) },
        socio_personal_id: query.partnerId,
        fecha:
          query.from || query.to
            ? {
                gte: query.from ? businessDate(query.from) : undefined,
                lte: query.to ? businessDate(query.to) : undefined,
              }
            : undefined,
      };
      const [total, rows, sums] = await Promise.all([
        tx.retiros_socio.count({ where }),
        tx.retiros_socio.findMany({
          where,
          orderBy: [{ fecha: 'desc' }, { creado_en: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        // Los anulados no suman.
        tx.retiros_socio.groupBy({
          by: ['moneda'],
          where: { ...where, estado: 'REGISTRADO' },
          _sum: { importe: true },
        }),
      ]);
      return {
        items: await this.present(tx, rows),
        total,
        page: query.page,
        limit: query.limit,
        totals: sums
          .map((row) => ({
            currency: row.moneda,
            amount: (row._sum.importe ?? new Prisma.Decimal(0)).toString(),
          }))
          .sort((left, right) => left.currency.localeCompare(right.currency)),
      };
    });
  }

  async create(input: CreatePartnerWithdrawalDto, actor: AuthenticatedUser) {
    const amount = decimal(input.amount);
    const date = businessDate(input.date);
    // Hoy en Argentina: no se registran retiros a futuro.
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
    }).format(new Date());
    if (input.date > today)
      financialBadRequest(
        'WITHDRAWAL_DATE_IN_FUTURE',
        'A withdrawal cannot be dated in the future',
      );
    const reason = input.reason.trim();
    const hash = stableHash({
      action: 'partner-withdrawal',
      accountId: input.accountId,
      amount: amount.toFixed(2),
      date: input.date,
      reason,
    });
    return this.mutate(
      actor,
      'PARTNER_WITHDRAWAL_REGISTERED',
      async (tx, event) => {
        const organizationId = actor.organization.id;
        const repeated = await this.repeated(
          tx,
          organizationId,
          input.idempotencyKey,
          hash,
        );
        if (repeated) {
          event.skipRecord = true;
          return (await this.present(tx, [repeated]))[0];
        }
        const account = await tx.cuentas_caja.findFirst({
          where: { id: input.accountId, organizacion_id: organizationId },
          select: accountSelect,
        });
        if (!account || !account.activo)
          financialBadRequest(
            'INVALID_CASH_ACCOUNT',
            'Cash account is invalid or inactive',
          );
        BranchScope.forActor(actor).assertSharedOrInScope(account.sucursal_id);
        if (account.es_importada)
          financialBadRequest(
            'HISTORIC_CASH_ACCOUNT',
            'Imported historic cash accounts do not accept new movements',
          );
        // El socio es el responsable de la caja: de ahí sale a nombre de quién
        // queda el retiro.
        if (!account.personal_responsable_id)
          financialBadRequest(
            'WITHDRAWAL_ACCOUNT_WITHOUT_PARTNER',
            'The cash account has no responsible partner',
          );
        const personnelId = await this.cash.actorPersonnelId(
          tx,
          actor,
          organizationId,
        );
        const movement = await tx.movimientos_caja.create({
          data: {
            cuenta_caja_id: account.id,
            tipo_movimiento: tipo_movimiento_caja_luma.AJUSTE,
            direccion: direccion_caja_luma.DEBITO,
            importe: amount,
            // Mediodía de Argentina: el día contable no cambia por el huso.
            contabilizado_en: new Date(`${input.date}T12:00:00.000-03:00`),
            notas: `Retiro de socio: ${reason}`,
            registrado_por_personal_id: personnelId,
            organizacion_id: organizationId,
            clave_idempotencia: input.idempotencyKey,
            hash_idempotencia: hash,
          },
          select: { id: true },
        });
        const withdrawal = await tx.retiros_socio.create({
          data: {
            organizacion_id: organizationId,
            cuenta_caja_id: account.id,
            socio_personal_id: account.personal_responsable_id,
            importe: amount,
            moneda: account.moneda,
            fecha: date,
            motivo: reason,
            movimiento_caja_id: movement.id,
            creado_por_personal_id: personnelId,
          },
        });
        const [item] = await this.present(tx, [withdrawal]);
        event.entityId = withdrawal.id;
        event.metadata = {
          account: item.account.name,
          branch: item.branch?.name ?? null,
          partner: item.partner?.fullName ?? null,
          amount: withdrawal.importe.toString(),
          currency: withdrawal.moneda,
          date: input.date,
          reason,
        };
        return item;
      },
    );
  }

  reverse(
    id: string,
    input: ReverseFinancialMovementDto,
    actor: AuthenticatedUser,
  ) {
    const reason = input.reason.trim();
    const hash = stableHash({
      action: 'partner-withdrawal-reverse',
      withdrawalId: id,
      reason,
    });
    return this.mutate(
      actor,
      'PARTNER_WITHDRAWAL_REVERSED',
      async (tx, event) => {
        const organizationId = actor.organization.id;
        // Reintento con la misma clave: devuelve el retiro ya anulado.
        const replayed = await this.replayedMovement(
          tx,
          organizationId,
          input.idempotencyKey,
          hash,
        );
        if (replayed) {
          const existing = await tx.retiros_socio.findFirst({
            where: { reversa_movimiento_id: replayed },
          });
          if (existing) {
            event.skipRecord = true;
            return (await this.present(tx, [existing]))[0];
          }
        }
        await tx.$queryRaw`
          SELECT "id"
          FROM "public"."retiros_socio"
          WHERE "id" = CAST(${id} AS uuid)
            AND "organizacion_id" = CAST(${organizationId} AS uuid)
          FOR UPDATE
        `;
        const withdrawal = await tx.retiros_socio.findFirst({
          where: { id, organizacion_id: organizationId },
        });
        if (!withdrawal) financialNotFound('Partner withdrawal');
        const account = await tx.cuentas_caja.findFirst({
          where: { id: withdrawal.cuenta_caja_id },
          select: { sucursal_id: true },
        });
        // Fuera del alcance de sucursal responde igual que si no existiera.
        const branchScope = BranchScope.forActor(actor);
        if (
          !account ||
          (account.sucursal_id !== null &&
            !branchScope.includes(account.sucursal_id))
        )
          financialNotFound('Partner withdrawal');
        if (withdrawal.estado !== 'REGISTRADO')
          financialConflict(
            'ALREADY_REVERSED',
            'Partner withdrawal is already reversed',
          );
        const personnelId = await this.cash.actorPersonnelId(
          tx,
          actor,
          organizationId,
        );
        const reversal = await tx.movimientos_caja.create({
          data: {
            cuenta_caja_id: withdrawal.cuenta_caja_id,
            tipo_movimiento: tipo_movimiento_caja_luma.INGRESO,
            direccion: direccion_caja_luma.CREDITO,
            importe: withdrawal.importe,
            contabilizado_en: new Date(),
            revierte_a_id: withdrawal.movimiento_caja_id,
            notas: reason,
            registrado_por_personal_id: personnelId,
            organizacion_id: organizationId,
            // La base exige clave y hash juntos.
            clave_idempotencia: input.idempotencyKey,
            hash_idempotencia: hash,
          },
          select: { id: true },
        });
        const updated = await tx.retiros_socio.update({
          where: { id },
          data: {
            estado: 'ANULADO',
            reversa_movimiento_id: reversal.id,
            anulado_motivo: reason,
            anulado_en: new Date(),
            anulado_por_personal_id: personnelId,
          },
        });
        const [item] = await this.present(tx, [updated]);
        event.previousData = { status: 'REGISTRADO' };
        event.metadata = {
          status: 'ANULADO',
          amount: updated.importe.toString(),
          currency: updated.moneda,
          partner: item.partner?.fullName ?? null,
          reason,
        };
        return item;
      },
      id,
    );
  }

  /**
   * Movimiento ya escrito con esa clave de idempotencia (o `null`). Con otra
   * carga distinta para la misma clave responde 409.
   */
  private async replayedMovement(
    tx: Tx,
    organizationId: string,
    key: string,
    hash: string,
  ): Promise<string | null> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${organizationId}:${key}`}, 0)
      )
    `;
    const movement = await tx.movimientos_caja.findFirst({
      where: { organizacion_id: organizationId, clave_idempotencia: key },
      select: { id: true, hash_idempotencia: true },
    });
    if (!movement) return null;
    if (movement.hash_idempotencia !== hash)
      financialConflict(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used with a different payload',
      );
    return movement.id;
  }

  /** Reintento con la misma clave: devuelve el retiro ya registrado. */
  private async repeated(
    tx: Tx,
    organizationId: string,
    key: string,
    hash: string,
  ): Promise<WithdrawalRow | null> {
    const movementId = await this.replayedMovement(
      tx,
      organizationId,
      key,
      hash,
    );
    return movementId
      ? tx.retiros_socio.findFirst({
          where: { movimiento_caja_id: movementId },
        })
      : null;
  }

  private async present(tx: Tx, rows: WithdrawalRow[]) {
    const ids = (values: Array<string | null>) => [
      ...new Set(values.filter((value): value is string => value !== null)),
    ];
    const [accounts, people] = await Promise.all([
      tx.cuentas_caja.findMany({
        where: { id: { in: ids(rows.map((row) => row.cuenta_caja_id)) } },
        select: accountSelect,
      }),
      tx.personal.findMany({
        where: {
          id: {
            in: ids(
              rows.flatMap((row) => [
                row.socio_personal_id,
                row.creado_por_personal_id,
                row.anulado_por_personal_id,
              ]),
            ),
          },
        },
        select: { id: true, nombre_completo: true },
      }),
    ]);
    const person = (id: string | null) => {
      const found = people.find((item) => item.id === id);
      return found ? { id: found.id, fullName: found.nombre_completo } : null;
    };
    return rows.map((row) => {
      const account = accounts.find((item) => item.id === row.cuenta_caja_id);
      return {
        id: row.id,
        date: row.fecha.toISOString().slice(0, 10),
        amount: row.importe.toString(),
        currency: row.moneda,
        reason: row.motivo,
        status: row.estado,
        account: {
          id: row.cuenta_caja_id,
          name: account?.nombre ?? '',
          type: account?.tipo_cuenta ?? null,
        },
        branch: account?.sucursales
          ? {
              id: account.sucursales.id,
              code: account.sucursales.codigo,
              name: account.sucursales.nombre,
            }
          : null,
        partner: person(row.socio_personal_id),
        registeredBy: person(row.creado_por_personal_id),
        createdAt: row.creado_en,
        reversal: row.anulado_en
          ? {
              at: row.anulado_en,
              by: person(row.anulado_por_personal_id),
              reason: row.anulado_motivo,
            }
          : null,
      };
    });
  }

  private mutate<T>(
    actor: AuthenticatedUser,
    action: string,
    work: (tx: Tx, event: AuthenticatedAuditEvent) => Promise<T>,
    entityId?: string,
  ) {
    const event: AuthenticatedAuditEvent = {
      action,
      entity: 'retiros_socio',
      entityId,
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
    };
    return this.audit
      .execute(event, (tx) => work(tx, event))
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' || error.code === 'P2034')
        )
          financialConflict(
            'CONFLICT',
            'The withdrawal conflicts with another request; retry',
          );
        throw error;
      });
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  estado_reserva_luma,
  luma_estado_inventario,
  luma_estado_operacion,
  Prisma,
  tipo_movimiento_inventario_luma,
} from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApproveSalesOperationDto,
  CreateSalesOperationDto,
  ReasonedSalesActionDto,
  ReleaseSalesReservationDto,
  ReserveSalesUnitDto,
  SalesOperationQueryDto,
  UpdateSalesOperationDto,
  VersionedSalesActionDto,
} from './sales.dto';

const operationInclude = {
  clientes: {
    select: { id: true, nombre_completo: true, activo: true },
  },
  sucursales: {
    select: { id: true, codigo: true, nombre: true },
  },
  versiones_vehiculos: {
    include: {
      modelos_vehiculos: {
        include: { marcas_vehiculos: true },
      },
    },
  },
  unidades_vehiculos: {
    select: {
      id: true,
      vin_mostrado: true,
      patente: true,
      estado_inventario: true,
      sucursal_id: true,
    },
  },
  asignaciones_personal_operacion: {
    where: { rol_asignacion: 'VENDEDOR' as const },
    include: { personal: true },
  },
  reservas_stock: {
    orderBy: [{ creado_en: 'desc' as const }, { id: 'desc' as const }],
  },
  aprobaciones_operacion: {
    orderBy: [{ solicitado_en: 'desc' as const }, { id: 'desc' as const }],
  },
} satisfies Prisma.operacionesInclude;

type OperationRecord = Prisma.operacionesGetPayload<{
  include: typeof operationInclude;
}>;

interface LockedReservation {
  id: string;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: SalesOperationQueryDto, actor: AuthenticatedUser) {
    this.assertOrganizationSelection(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const search = query.search?.trim();
    const operationNumber =
      search && /^\d+$/.test(search) ? BigInt(search) : undefined;
    const where: Prisma.operacionesWhereInput = {
      organizacion_id: organizationId,
      estado_operacion: query.status,
      sucursal_id: query.branchId,
      cliente_id: query.clientId,
      version_id: query.versionId,
      fecha_operacion:
        query.from || query.to
          ? {
              gte: query.from ? new Date(query.from) : undefined,
              lte: query.to ? new Date(query.to) : undefined,
            }
          : undefined,
      asignaciones_personal_operacion: query.sellerId
        ? {
            some: {
              personal_id: query.sellerId,
              rol_asignacion: 'VENDEDOR',
            },
          }
        : undefined,
      OR: search
        ? [
            ...(operationNumber ? [{ numero_operacion: operationNumber }] : []),
            {
              clientes: {
                nombre_completo: { contains: search, mode: 'insensitive' },
              },
            },
            {
              unidades_vehiculos: {
                vin_mostrado: { contains: search, mode: 'insensitive' },
              },
            },
            {
              unidades_vehiculos: {
                patente: { contains: search, mode: 'insensitive' },
              },
            },
          ]
        : undefined,
    };
    const [total, items] = await this.prisma.withTenant(
      this.scope(actor),
      (tx) =>
        Promise.all([
          tx.operaciones.count({ where }),
          tx.operaciones.findMany({
            where,
            include: operationInclude,
            orderBy: [{ fecha_operacion: 'desc' }, { id: 'desc' }],
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
        ]),
    );
    return {
      items: items.map((item) => this.operation(item)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(this.scope(actor), async (tx) =>
      this.operation(await this.operationOr404(tx, id, actor)),
    );
  }

  async create(input: CreateSalesOperationDto, actor: AuthenticatedUser) {
    this.assertOrganizationSelection(actor, input.organizationId);
    const organizationId = input.organizationId ?? actor.organization.id;
    return this.mutate(
      actor,
      'SALES_OPERATION_CREATED',
      async (tx) => {
        await this.branchOr400(tx, input.branchId, organizationId);
        await this.clientOr400(tx, input.clientId, organizationId);
        await this.versionOr400(tx, input.versionId, organizationId);
        const sellerId =
          input.sellerId ??
          (await this.actorPersonnelId(tx, actor, organizationId));
        await this.sellerOr400(tx, sellerId, input.branchId, organizationId);
        const policy = await this.pricePolicyOr400(
          tx,
          input.versionId,
          input.branchId,
          organizationId,
          input.operationDate ? new Date(input.operationDate) : new Date(),
        );
        const operation = await tx.operaciones.create({
          data: {
            sucursal_id: input.branchId,
            cliente_id: input.clientId,
            version_id: input.versionId,
            condicion: input.condition,
            fecha_operacion: input.operationDate
              ? new Date(input.operationDate)
              : new Date(),
            precio_lista: policy.precio_lista,
            precio_minimo: policy.precio_minimo,
            precio_acordado: input.agreedPrice,
            moneda: policy.moneda,
            creado_por_personal_id: await this.actorPersonnelId(
              tx,
              actor,
              organizationId,
            ),
            notas: input.notes?.trim(),
            organizacion_id: organizationId,
          },
        });
        await tx.asignaciones_personal_operacion.create({
          data: {
            operacion_id: operation.id,
            personal_id: sellerId,
            rol_asignacion: 'VENDEDOR',
            organizacion_id: organizationId,
          },
        });
        if (input.unitId) {
          await this.reserveUnit(
            tx,
            operation,
            input.unitId,
            input.reservationExpiresAt,
            actor,
          );
        }
        return this.operation(
          await this.operationOr404(tx, operation.id, actor),
        );
      },
      undefined,
      organizationId,
    );
  }

  async update(
    id: string,
    input: UpdateSalesOperationDto,
    actor: AuthenticatedUser,
  ) {
    if (Object.keys(input).length === 1)
      throw new BadRequestException('At least one editable field is required');
    return this.mutate(
      actor,
      'SALES_OPERATION_UPDATED',
      async (tx, event) => {
        const current = await this.operationOr404(tx, id, actor, true);
        this.setTargetOrganization(event, actor, current.organizacion_id);
        this.assertVersion(current.version_fila, input.expectedVersion);
        if (
          current.estado_operacion !== luma_estado_operacion.BORRADOR &&
          current.estado_operacion !== luma_estado_operacion.RECHAZADA
        )
          throw new ConflictException(
            'Only draft or rejected operations can be edited',
          );
        const branchId = input.branchId ?? current.sucursal_id;
        const activeReservation = await this.activeReservation(tx, current.id);
        if (input.branchId) {
          await this.branchOr400(tx, input.branchId, current.organizacion_id);
          if (activeReservation)
            throw new ConflictException(
              'Release the active reservation before changing the branch',
            );
        }
        if (input.clientId)
          await this.clientOr400(tx, input.clientId, current.organizacion_id);
        if (input.sellerId)
          await this.sellerOr400(
            tx,
            input.sellerId,
            branchId,
            current.organizacion_id,
          );
        const policy =
          input.branchId || input.agreedPrice !== undefined
            ? await this.pricePolicyOr400(
                tx,
                current.version_id,
                branchId,
                current.organizacion_id,
                new Date(),
              )
            : undefined;
        await tx.operaciones.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: current.organizacion_id,
            },
          },
          data: {
            sucursal_id: input.branchId,
            cliente_id: input.clientId,
            precio_lista: policy?.precio_lista,
            precio_minimo: policy?.precio_minimo,
            precio_acordado: input.agreedPrice,
            moneda: policy?.moneda,
            notas:
              input.notes === undefined
                ? undefined
                : input.notes === null
                  ? null
                  : input.notes.trim(),
            estado_operacion: luma_estado_operacion.BORRADOR,
            unidad_vehiculo_id:
              !activeReservation && current.unidad_vehiculo_id
                ? null
                : undefined,
            version_fila: { increment: 1 },
          },
        });
        if (input.sellerId) {
          await tx.asignaciones_personal_operacion.deleteMany({
            where: {
              operacion_id: id,
              organizacion_id: current.organizacion_id,
              rol_asignacion: 'VENDEDOR',
            },
          });
          await tx.asignaciones_personal_operacion.create({
            data: {
              operacion_id: id,
              personal_id: input.sellerId,
              rol_asignacion: 'VENDEDOR',
              organizacion_id: current.organizacion_id,
            },
          });
        }
        return this.operation(await this.operationOr404(tx, id, actor));
      },
      id,
    );
  }

  async reserve(
    id: string,
    input: ReserveSalesUnitDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'STOCK_RESERVATION_CREATED',
      async (tx, event) => {
        const operation = await this.operationOr404(tx, id, actor, true);
        this.setTargetOrganization(event, actor, operation.organizacion_id);
        this.assertVersion(operation.version_fila, input.expectedVersion);
        if (
          operation.estado_operacion !== luma_estado_operacion.BORRADOR &&
          operation.estado_operacion !== luma_estado_operacion.RECHAZADA
        )
          throw new ConflictException(
            'Units can only be reserved for draft or rejected operations',
          );
        await this.reserveUnit(
          tx,
          operation,
          input.unitId,
          input.expiresAt,
          actor,
        );
        await tx.operaciones.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: operation.organizacion_id,
            },
          },
          data: {
            estado_operacion: luma_estado_operacion.BORRADOR,
            version_fila: { increment: 1 },
          },
        });
        return this.operation(await this.operationOr404(tx, id, actor));
      },
      id,
    );
  }

  async releaseReservation(
    id: string,
    input: ReleaseSalesReservationDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'STOCK_RESERVATION_RELEASED',
      async (tx, event) => {
        const operation = await this.operationOr404(tx, id, actor, true);
        this.setTargetOrganization(event, actor, operation.organizacion_id);
        this.assertVersion(operation.version_fila, input.expectedVersion);
        if (
          operation.estado_operacion !== luma_estado_operacion.BORRADOR &&
          operation.estado_operacion !== luma_estado_operacion.RECHAZADA
        )
          throw new ConflictException(
            'The reservation cannot be released from the current operation state',
          );
        if (operation.unidad_vehiculo_id)
          await this.lockUnitOr404(
            tx,
            operation.unidad_vehiculo_id,
            operation.organizacion_id,
          );
        const reservation = await this.activeReservationOr409(tx, operation.id);
        await this.releaseActiveReservation(
          tx,
          operation,
          reservation.id,
          input.reason,
          actor,
        );
        await tx.operaciones.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: operation.organizacion_id,
            },
          },
          data: { unidad_vehiculo_id: null, version_fila: { increment: 1 } },
        });
        return this.operation(await this.operationOr404(tx, id, actor));
      },
      id,
    );
  }

  async submit(
    id: string,
    input: VersionedSalesActionDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'SALES_OPERATION_SUBMITTED',
      async (tx, event) => {
        const operation = await this.operationOr404(tx, id, actor, true);
        this.setTargetOrganization(event, actor, operation.organizacion_id);
        this.assertVersion(operation.version_fila, input.expectedVersion);
        if (operation.estado_operacion !== luma_estado_operacion.BORRADOR)
          throw new ConflictException('Only draft operations can be submitted');
        await this.assertUsableReservation(tx, operation);
        await this.clientOr400(
          tx,
          operation.cliente_id,
          operation.organizacion_id,
        );
        const policy = await this.pricePolicyOr400(
          tx,
          operation.version_id,
          operation.sucursal_id,
          operation.organizacion_id,
          new Date(),
        );
        const personnelId = await this.actorPersonnelId(
          tx,
          actor,
          operation.organizacion_id,
        );
        await tx.aprobaciones_operacion.create({
          data: {
            operacion_id: id,
            solicitado_por_personal_id: personnelId,
            precio_lista_referencia: policy.precio_lista,
            precio_minimo_referencia: policy.precio_minimo,
            precio_acordado_referencia: operation.precio_acordado,
            organizacion_id: operation.organizacion_id,
          },
        });
        await tx.operaciones.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: operation.organizacion_id,
            },
          },
          data: {
            estado_operacion: luma_estado_operacion.PENDIENTE_APROBACION,
            precio_lista: policy.precio_lista,
            precio_minimo: policy.precio_minimo,
            moneda: policy.moneda,
            version_fila: { increment: 1 },
          },
        });
        return this.operation(await this.operationOr404(tx, id, actor));
      },
      id,
    );
  }

  async approve(
    id: string,
    input: ApproveSalesOperationDto,
    actor: AuthenticatedUser,
  ) {
    return this.decide(id, input, actor, true);
  }

  async reject(
    id: string,
    input: ReasonedSalesActionDto,
    actor: AuthenticatedUser,
  ) {
    return this.decide(id, input, actor, false);
  }

  async cancel(
    id: string,
    input: ReasonedSalesActionDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'SALES_OPERATION_CANCELLED',
      async (tx, event) => {
        const operation = await this.operationOr404(tx, id, actor, true);
        this.setTargetOrganization(event, actor, operation.organizacion_id);
        this.assertVersion(operation.version_fila, input.expectedVersion);
        if (
          operation.estado_operacion === luma_estado_operacion.CANCELADA ||
          operation.estado_operacion === luma_estado_operacion.CERRADA
        )
          throw new ConflictException(
            'The operation cannot be cancelled from its current state',
          );
        const personnelId = await this.actorPersonnelId(
          tx,
          actor,
          operation.organizacion_id,
        );
        const pendingApproval = await this.pendingApproval(tx, id, true);
        if (pendingApproval) {
          await tx.aprobaciones_operacion.update({
            where: { id: pendingApproval.id },
            data: {
              decision: 'RECHAZADA',
              decidido_por_personal_id: personnelId,
              decidido_en: new Date(),
              motivo: `Cancelada: ${input.reason.trim()}`,
            },
          });
        }
        if (operation.unidad_vehiculo_id)
          await this.lockUnitOr404(
            tx,
            operation.unidad_vehiculo_id,
            operation.organizacion_id,
          );
        const reservation = await this.activeReservation(tx, id, true);
        if (reservation)
          await this.releaseActiveReservation(
            tx,
            operation,
            reservation.id,
            input.reason,
            actor,
          );
        await tx.operaciones.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: operation.organizacion_id,
            },
          },
          data: {
            estado_operacion: luma_estado_operacion.CANCELADA,
            unidad_vehiculo_id: null,
            version_fila: { increment: 1 },
          },
        });
        return this.operation(await this.operationOr404(tx, id, actor));
      },
      id,
    );
  }

  async close(
    id: string,
    input: VersionedSalesActionDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'SALES_OPERATION_CLOSED',
      async (tx, event) => {
        const operation = await this.operationOr404(tx, id, actor, true);
        this.setTargetOrganization(event, actor, operation.organizacion_id);
        this.assertVersion(operation.version_fila, input.expectedVersion);
        if (operation.estado_operacion !== luma_estado_operacion.APROBADA)
          throw new ConflictException('Only approved operations can be closed');
        const reservation = await this.assertUsableReservation(tx, operation);
        const unit = await this.lockUnitOr404(
          tx,
          reservation.unidad_vehiculo_id!,
          operation.organizacion_id,
        );
        if (unit.estado_inventario !== luma_estado_inventario.RESERVADO)
          throw new ConflictException('Reserved unit state is inconsistent');
        const paymentPlan = await tx.componentes_pago_operacion.aggregate({
          where: {
            operacion_id: id,
            organizacion_id: operation.organizacion_id,
            estado_pago: { not: 'CANCELADA' },
          },
          _sum: { importe_esperado: true },
        });
        const planned =
          paymentPlan._sum.importe_esperado ?? new Prisma.Decimal(0);
        if (!planned.equals(operation.precio_acordado))
          throw new ConflictException(
            'Payment plan total must equal the agreed price before closing',
          );
        const personnelId = await this.actorPersonnelId(
          tx,
          actor,
          operation.organizacion_id,
        );
        await tx.reservas_stock.update({
          where: { id: reservation.id },
          data: { estado: estado_reserva_luma.CONSUMIDA },
        });
        await tx.unidades_vehiculos.update({
          where: {
            id_organizacion_id: {
              id: unit.id,
              organizacion_id: operation.organizacion_id,
            },
          },
          data: { estado_inventario: luma_estado_inventario.VENDIDO },
        });
        await tx.movimientos_inventario.create({
          data: {
            unidad_vehiculo_id: unit.id,
            tipo_movimiento: tipo_movimiento_inventario_luma.VENTA,
            sucursal_origen_id: unit.sucursal_id,
            operacion_id: id,
            realizado_por_personal_id: personnelId,
            organizacion_id: operation.organizacion_id,
          },
        });
        await tx.operaciones.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: operation.organizacion_id,
            },
          },
          data: {
            estado_operacion: luma_estado_operacion.CERRADA,
            version_fila: { increment: 1 },
          },
        });
        return this.operation(await this.operationOr404(tx, id, actor));
      },
      id,
    );
  }

  private async decide(
    id: string,
    input: ApproveSalesOperationDto | ReasonedSalesActionDto,
    actor: AuthenticatedUser,
    approved: boolean,
  ) {
    return this.mutate(
      actor,
      approved ? 'SALES_OPERATION_APPROVED' : 'SALES_OPERATION_REJECTED',
      async (tx, event) => {
        const operation = await this.operationOr404(tx, id, actor, true);
        this.setTargetOrganization(event, actor, operation.organizacion_id);
        this.assertVersion(operation.version_fila, input.expectedVersion);
        if (
          operation.estado_operacion !==
          luma_estado_operacion.PENDIENTE_APROBACION
        )
          throw new ConflictException('Only pending operations can be decided');
        const approval = await this.pendingApproval(tx, id, true);
        if (!approval)
          throw new ConflictException(
            'Pending operation does not have a pending approval',
          );
        const personnelId = await this.actorPersonnelId(
          tx,
          actor,
          operation.organizacion_id,
        );
        if (approved) await this.assertUsableReservation(tx, operation);
        const reason =
          'reason' in input
            ? input.reason.trim()
            : input.notes?.trim() || undefined;
        await tx.aprobaciones_operacion.update({
          where: { id: approval.id },
          data: {
            decision: approved ? 'APROBADA' : 'RECHAZADA',
            decidido_por_personal_id: personnelId,
            decidido_en: new Date(),
            motivo: reason,
          },
        });
        if (!approved) {
          if (operation.unidad_vehiculo_id)
            await this.lockUnitOr404(
              tx,
              operation.unidad_vehiculo_id,
              operation.organizacion_id,
            );
          const reservation = await this.activeReservation(tx, id, true);
          if (reservation)
            await this.releaseActiveReservation(
              tx,
              operation,
              reservation.id,
              reason!,
              actor,
            );
        }
        await tx.operaciones.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: operation.organizacion_id,
            },
          },
          data: {
            estado_operacion: approved
              ? luma_estado_operacion.APROBADA
              : luma_estado_operacion.RECHAZADA,
            unidad_vehiculo_id: approved ? operation.unidad_vehiculo_id : null,
            version_fila: { increment: 1 },
          },
        });
        return this.operation(await this.operationOr404(tx, id, actor));
      },
      id,
    );
  }

  private async reserveUnit(
    tx: Prisma.TransactionClient,
    operation: Pick<
      OperationRecord,
      'id' | 'organizacion_id' | 'version_id' | 'condicion' | 'sucursal_id'
    >,
    unitId: string,
    expiresAtInput: string | undefined,
    actor: AuthenticatedUser,
  ) {
    const existingForOperation = await this.activeReservation(tx, operation.id);
    if (existingForOperation)
      throw new ConflictException(
        'The operation already has an active reservation',
      );
    let unit = await this.lockUnitOr404(tx, unitId, operation.organizacion_id);
    const existingForUnit = await this.activeUnitReservation(tx, unitId);
    if (existingForUnit) {
      if (existingForUnit.vence_en > new Date())
        throw new ConflictException(
          'The inventory unit is already reserved by another operation',
        );
      await this.expireReservation(tx, existingForUnit, unit, actor);
      unit = {
        ...unit,
        estado_inventario: luma_estado_inventario.EN_STOCK,
      };
    }
    if (unit.estado_inventario !== luma_estado_inventario.EN_STOCK)
      throw new ConflictException(
        'Only EN_STOCK inventory units can be reserved',
      );
    if (
      unit.version_id !== operation.version_id ||
      unit.condicion !== operation.condicion
    )
      throw new BadRequestException(
        'Inventory unit version and condition must match the operation',
      );
    if (unit.sucursal_id !== operation.sucursal_id)
      throw new BadRequestException(
        'Inventory unit must belong to the operation branch',
      );
    const now = new Date();
    const expiresAt = expiresAtInput
      ? new Date(expiresAtInput)
      : new Date(now.getTime() + 48 * 60 * 60 * 1000);
    if (expiresAt <= now)
      throw new BadRequestException('Reservation expiry must be in the future');
    if (expiresAt.getTime() > now.getTime() + 30 * 24 * 60 * 60 * 1000)
      throw new BadRequestException('Reservation expiry cannot exceed 30 days');
    const personnelId = await this.actorPersonnelId(
      tx,
      actor,
      operation.organizacion_id,
    );
    await tx.reservas_stock.create({
      data: {
        operacion_id: operation.id,
        unidad_vehiculo_id: unitId,
        vence_en: expiresAt,
        creado_por_personal_id: personnelId,
        organizacion_id: operation.organizacion_id,
      },
    });
    await tx.unidades_vehiculos.update({
      where: {
        id_organizacion_id: {
          id: unitId,
          organizacion_id: operation.organizacion_id,
        },
      },
      data: { estado_inventario: luma_estado_inventario.RESERVADO },
    });
    await tx.operaciones.update({
      where: {
        id_organizacion_id: {
          id: operation.id,
          organizacion_id: operation.organizacion_id,
        },
      },
      data: { unidad_vehiculo_id: unitId },
    });
    await tx.movimientos_inventario.create({
      data: {
        unidad_vehiculo_id: unitId,
        tipo_movimiento: tipo_movimiento_inventario_luma.RESERVA,
        sucursal_origen_id: unit.sucursal_id,
        operacion_id: operation.id,
        realizado_por_personal_id: personnelId,
        organizacion_id: operation.organizacion_id,
      },
    });
  }

  private async expireReservation(
    tx: Prisma.TransactionClient,
    reservation: {
      id: string;
      operacion_id: string;
      organizacion_id: string;
    },
    unit: {
      id: string;
      sucursal_id: string;
      estado_inventario: luma_estado_inventario;
    },
    actor: AuthenticatedUser,
  ) {
    const now = new Date();
    await tx.reservas_stock.update({
      where: { id: reservation.id },
      data: {
        estado: estado_reserva_luma.VENCIDA,
        liberado_en: now,
        motivo_liberacion: 'Vencimiento automático al intentar reservar',
      },
    });
    if (unit.estado_inventario !== luma_estado_inventario.RESERVADO)
      throw new ConflictException('Expired reservation state is inconsistent');
    await tx.unidades_vehiculos.update({
      where: {
        id_organizacion_id: {
          id: unit.id,
          organizacion_id: reservation.organizacion_id,
        },
      },
      data: { estado_inventario: luma_estado_inventario.EN_STOCK },
    });
    await tx.movimientos_inventario.create({
      data: {
        unidad_vehiculo_id: unit.id,
        tipo_movimiento: tipo_movimiento_inventario_luma.LIBERACION,
        sucursal_origen_id: unit.sucursal_id,
        operacion_id: reservation.operacion_id,
        realizado_por_personal_id: await this.actorPersonnelId(
          tx,
          actor,
          reservation.organizacion_id,
        ),
        notas: 'Reserva vencida',
        organizacion_id: reservation.organizacion_id,
      },
    });
  }

  private async releaseActiveReservation(
    tx: Prisma.TransactionClient,
    operation: Pick<
      OperationRecord,
      'id' | 'organizacion_id' | 'unidad_vehiculo_id'
    >,
    reservationId: string,
    reason: string,
    actor: AuthenticatedUser,
  ) {
    if (!operation.unidad_vehiculo_id)
      throw new ConflictException('Active reservation has no assigned unit');
    const unit = await this.lockUnitOr404(
      tx,
      operation.unidad_vehiculo_id,
      operation.organizacion_id,
    );
    if (unit.estado_inventario !== luma_estado_inventario.RESERVADO)
      throw new ConflictException('Reserved unit state is inconsistent');
    await tx.reservas_stock.update({
      where: { id: reservationId },
      data: {
        estado: estado_reserva_luma.LIBERADA,
        liberado_en: new Date(),
        motivo_liberacion: reason.trim(),
      },
    });
    await tx.unidades_vehiculos.update({
      where: {
        id_organizacion_id: {
          id: unit.id,
          organizacion_id: operation.organizacion_id,
        },
      },
      data: { estado_inventario: luma_estado_inventario.EN_STOCK },
    });
    await tx.movimientos_inventario.create({
      data: {
        unidad_vehiculo_id: unit.id,
        tipo_movimiento: tipo_movimiento_inventario_luma.LIBERACION,
        sucursal_origen_id: unit.sucursal_id,
        operacion_id: operation.id,
        realizado_por_personal_id: await this.actorPersonnelId(
          tx,
          actor,
          operation.organizacion_id,
        ),
        notas: reason.trim(),
        organizacion_id: operation.organizacion_id,
      },
    });
  }

  private async assertUsableReservation(
    tx: Prisma.TransactionClient,
    operation: OperationRecord,
  ) {
    if (!operation.unidad_vehiculo_id)
      throw new ConflictException(
        'The operation requires an assigned inventory unit',
      );
    const unit = await this.lockUnitOr404(
      tx,
      operation.unidad_vehiculo_id,
      operation.organizacion_id,
    );
    const reservation = await this.activeReservationOr409(tx, operation.id);
    if (
      !reservation.unidad_vehiculo_id ||
      operation.unidad_vehiculo_id !== reservation.unidad_vehiculo_id
    )
      throw new ConflictException(
        'Operation unit and active reservation are inconsistent',
      );
    if (reservation.vence_en <= new Date())
      throw new ConflictException('The stock reservation has expired');
    if (unit.estado_inventario !== luma_estado_inventario.RESERVADO)
      throw new ConflictException('Reserved unit state is inconsistent');
    return reservation;
  }

  private async operationOr404(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
    lock = false,
  ) {
    if (lock) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "public"."operaciones"
        WHERE "id" = CAST(${id} AS uuid)
          AND (${actor.globalAccess} OR "organizacion_id" = CAST(${actor.organization.id} AS uuid))
        FOR UPDATE
      `;
      if (!rows.length)
        throw new NotFoundException('Sales operation not found');
    }
    const operation = await tx.operaciones.findFirst({
      where: {
        id,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
      },
      include: operationInclude,
    });
    if (!operation) throw new NotFoundException('Sales operation not found');
    return operation;
  }

  private async lockUnitOr404(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "public"."unidades_vehiculos"
      WHERE "id" = CAST(${id} AS uuid)
        AND "organizacion_id" = CAST(${organizationId} AS uuid)
      FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException('Inventory unit not found');
    const unit = await tx.unidades_vehiculos.findFirst({
      where: { id, organizacion_id: organizationId },
      select: {
        id: true,
        version_id: true,
        condicion: true,
        sucursal_id: true,
        estado_inventario: true,
      },
    });
    if (!unit) throw new NotFoundException('Inventory unit not found');
    return unit;
  }

  private async activeReservation(
    tx: Prisma.TransactionClient,
    operationId: string,
    lock = false,
  ) {
    if (lock) {
      await tx.$queryRaw<LockedReservation[]>`
        SELECT "id"
        FROM "public"."reservas_stock"
        WHERE "operacion_id" = CAST(${operationId} AS uuid)
          AND "estado" = 'ACTIVO'
        FOR UPDATE
      `;
    }
    return tx.reservas_stock.findFirst({
      where: { operacion_id: operationId, estado: estado_reserva_luma.ACTIVO },
      orderBy: { creado_en: 'desc' },
    });
  }

  private async activeReservationOr409(
    tx: Prisma.TransactionClient,
    operationId: string,
  ) {
    const reservation = await this.activeReservation(tx, operationId, true);
    if (!reservation)
      throw new ConflictException(
        'The operation requires an active stock reservation',
      );
    return reservation;
  }

  private async activeUnitReservation(
    tx: Prisma.TransactionClient,
    unitId: string,
  ) {
    await tx.$queryRaw<LockedReservation[]>`
      SELECT "id"
      FROM "public"."reservas_stock"
      WHERE "unidad_vehiculo_id" = CAST(${unitId} AS uuid)
        AND "estado" = 'ACTIVO'
      FOR UPDATE
    `;
    return tx.reservas_stock.findFirst({
      where: {
        unidad_vehiculo_id: unitId,
        estado: estado_reserva_luma.ACTIVO,
      },
      orderBy: { creado_en: 'desc' },
    });
  }

  private async pendingApproval(
    tx: Prisma.TransactionClient,
    operationId: string,
    lock: boolean,
  ) {
    if (lock) {
      await tx.$queryRaw<LockedReservation[]>`
        SELECT "id"
        FROM "public"."aprobaciones_operacion"
        WHERE "operacion_id" = CAST(${operationId} AS uuid)
          AND "decision" = 'PENDIENTE'
        FOR UPDATE
      `;
    }
    return tx.aprobaciones_operacion.findFirst({
      where: { operacion_id: operationId, decision: 'PENDIENTE' },
      orderBy: { solicitado_en: 'desc' },
    });
  }

  private async pricePolicyOr400(
    tx: Prisma.TransactionClient,
    versionId: string,
    branchId: string,
    organizationId: string,
    at: Date,
  ) {
    const day = new Date(at);
    day.setHours(0, 0, 0, 0);
    const valid = {
      organizacion_id: organizationId,
      version_id: versionId,
      vigente_desde: { lte: day },
      OR: [{ vigente_hasta: null }, { vigente_hasta: { gte: day } }],
    } satisfies Prisma.politicas_precios_vehiculosWhereInput;
    const branchPolicy = await tx.politicas_precios_vehiculos.findFirst({
      where: { ...valid, sucursal_id: branchId },
      orderBy: [{ vigente_desde: 'desc' }, { creado_en: 'desc' }],
    });
    const policy =
      branchPolicy ??
      (await tx.politicas_precios_vehiculos.findFirst({
        where: { ...valid, sucursal_id: null },
        orderBy: [{ vigente_desde: 'desc' }, { creado_en: 'desc' }],
      }));
    if (!policy)
      throw new BadRequestException(
        'No active price policy exists for the operation',
      );
    return policy;
  }

  private async branchOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const branch = await tx.sucursales.findFirst({
      where: { id, organizacion_id: organizationId, activa: true },
      select: { id: true },
    });
    if (!branch) throw new BadRequestException('Branch is invalid or inactive');
  }

  private async clientOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const client = await tx.clientes.findFirst({
      where: { id, organizacion_id: organizationId, activo: true },
      select: { id: true },
    });
    if (!client) throw new BadRequestException('Client is invalid or inactive');
  }

  private async versionOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const version = await tx.versiones_vehiculos.findUnique({
      where: { id },
      include: { catalogo_organizaciones: true },
    });
    if (
      !version ||
      (version.alcance !== 'GLOBAL' &&
        version.organizacion_propietaria_id !== organizationId &&
        !version.catalogo_organizaciones.some(
          (item) => item.organizacion_id === organizationId,
        ))
    )
      throw new BadRequestException(
        'Version is not available to the organization',
      );
  }

  private async sellerOr400(
    tx: Prisma.TransactionClient,
    id: string,
    branchId: string,
    organizationId: string,
  ) {
    const seller = await tx.personal.findFirst({
      where: {
        id,
        organizacion_id: organizationId,
        estado: 'ACTIVO',
        OR: [
          { sucursal_principal_id: branchId },
          { acceso_personal_sucursal: { some: { sucursal_id: branchId } } },
        ],
      },
      select: { id: true },
    });
    if (!seller)
      throw new BadRequestException(
        'Seller is inactive or cannot access the operation branch',
      );
  }

  private async actorPersonnelId(
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

  private assertVersion(actual: number, expected: number) {
    if (actual !== expected)
      throw new ConflictException(
        'Sales operation was modified by another request',
      );
  }

  private assertOrganizationSelection(
    actor: AuthenticatedUser,
    organizationId?: string,
  ) {
    if (organizationId && !actor.globalAccess)
      throw new ForbiddenException(
        'Only users with global access can select an organization',
      );
  }

  private scope(actor: AuthenticatedUser) {
    return {
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
    };
  }

  private setTargetOrganization(
    event: AuthenticatedAuditEvent,
    actor: AuthenticatedUser,
    organizationId: string,
  ) {
    event.targetOrganizationId =
      organizationId === actor.organization.id ? undefined : organizationId;
  }

  private mutate<T>(
    actor: AuthenticatedUser,
    action: string,
    work: (
      tx: Prisma.TransactionClient,
      event: AuthenticatedAuditEvent,
    ) => Promise<T>,
    entityId?: string,
    targetOrganizationId?: string,
  ) {
    const event: AuthenticatedAuditEvent = {
      action,
      entity: 'operaciones',
      entityId,
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId:
        targetOrganizationId && targetOrganizationId !== actor.organization.id
          ? targetOrganizationId
          : undefined,
    };
    return this.audit
      .execute(event, (tx) => work(tx, event))
      .catch((error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        )
          throw new BadRequestException('A referenced record is invalid');
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' || error.code === 'P2034')
        )
          throw new ConflictException(
            'The sales operation conflicts with another request',
          );
        throw error;
      });
  }

  private operation(item: OperationRecord) {
    const seller = item.asignaciones_personal_operacion[0]?.personal;
    const reservation = item.reservas_stock[0];
    const approval = item.aprobaciones_operacion[0];
    const currentUnit =
      item.unidades_vehiculos &&
      reservation?.unidad_vehiculo_id === item.unidades_vehiculos.id &&
      (reservation.estado === estado_reserva_luma.ACTIVO ||
        reservation.estado === estado_reserva_luma.CONSUMIDA)
        ? item.unidades_vehiculos
        : null;
    return {
      id: item.id,
      number: item.numero_operacion.toString(),
      operationDate: item.fecha_operacion,
      status: item.estado_operacion,
      deliveryStatus: item.estado_entrega,
      documentationStatus: item.estado_documentacion,
      listPrice: item.precio_lista?.toString() ?? null,
      minimumPrice: item.precio_minimo?.toString() ?? null,
      agreedPrice: item.precio_acordado.toString(),
      currency: item.moneda,
      notes: item.notas,
      rowVersion: item.version_fila,
      organizationId: item.organizacion_id,
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
      client: {
        id: item.clientes.id,
        fullName: item.clientes.nombre_completo,
        active: item.clientes.activo,
      },
      branch: {
        id: item.sucursales.id,
        code: item.sucursales.codigo,
        name: item.sucursales.nombre,
      },
      vehicle: {
        versionId: item.version_id,
        versionName: item.versiones_vehiculos.nombre,
        condition: item.condicion,
        model: {
          id: item.versiones_vehiculos.modelos_vehiculos.id,
          name: item.versiones_vehiculos.modelos_vehiculos.nombre,
          vehicleType: item.versiones_vehiculos.modelos_vehiculos.tipo_vehiculo,
          brand: {
            id: item.versiones_vehiculos.modelos_vehiculos.marcas_vehiculos.id,
            name: item.versiones_vehiculos.modelos_vehiculos.marcas_vehiculos
              .nombre,
          },
        },
        unit: currentUnit
          ? {
              id: currentUnit.id,
              vin: currentUnit.vin_mostrado,
              licensePlate: currentUnit.patente,
              inventoryStatus: currentUnit.estado_inventario,
            }
          : null,
      },
      seller: seller
        ? { id: seller.id, fullName: seller.nombre_completo }
        : null,
      reservation: reservation
        ? {
            id: reservation.id,
            unitId: reservation.unidad_vehiculo_id,
            status: reservation.estado,
            quantity: reservation.cantidad,
            expiresAt: reservation.vence_en,
            releasedAt: reservation.liberado_en,
            releaseReason: reservation.motivo_liberacion,
          }
        : null,
      approval: approval
        ? {
            id: approval.id,
            decision: approval.decision,
            requestedAt: approval.solicitado_en,
            decidedAt: approval.decidido_en,
            reason: approval.motivo,
            listPriceReference: approval.precio_lista_referencia.toString(),
            minimumPriceReference: approval.precio_minimo_referencia.toString(),
            agreedPriceReference:
              approval.precio_acordado_referencia.toString(),
          }
        : null,
    };
  }
}

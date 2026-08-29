import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  estado_abastecimiento_luma,
  Prisma,
  tipo_movimiento_inventario_luma,
} from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeVin, validateVin } from '../inventory/vin';
import {
  CreateSupplyRequestDto,
  ReceiveSupplyRequestDto,
  SupplyRequestQueryDto,
  SupplyTransitionDto,
} from './supply.dto';

const requestInclude = {
  proveedores: true,
  versiones_vehiculos: {
    include: { modelos_vehiculos: { include: { marcas_vehiculos: true } } },
  },
  sucursales: true,
  unidades_vehiculos: true,
  operaciones: {
    select: {
      id: true,
      numero_operacion: true,
      estado_operacion: true,
      clientes: {
        select: { nombre_completo: true, numero_documento: true },
      },
    },
  },
} satisfies Prisma.solicitudes_abastecimientoInclude;
const requestUnitInclude = {
  versiones_vehiculos: {
    include: { modelos_vehiculos: { include: { marcas_vehiculos: true } } },
  },
  sucursales: true,
  proveedores: true,
} satisfies Prisma.unidades_vehiculosInclude;
const forward: Record<string, estado_abastecimiento_luma> = {
  PENDIENTE_APROBACION: 'PENDIENTE_CONFIRMACION',
  PENDIENTE_CONFIRMACION: 'CONFIRMADO',
  CONFIRMADO: 'PEDIDO',
  PEDIDO: 'EN_TRANSITO',
};
@Injectable()
export class SupplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  async findAll(query: SupplyRequestQueryDto, actor: AuthenticatedUser) {
    this.assertOrg(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const where: Prisma.solicitudes_abastecimientoWhereInput = {
      organizacion_id: organizationId,
      estado: query.status,
      proveedor_id: query.supplierId,
      version_id: query.versionId,
      condicion: query.condition,
      sucursal_llegada_id: query.arrivalBranchId,
      versiones_vehiculos: query.vehicleType
        ? { modelos_vehiculos: { tipo_vehiculo: query.vehicleType } }
        : undefined,
    };
    const [total, items] = await this.prisma.withTenant(
      this.scope(actor),
      (tx) =>
        Promise.all([
          tx.solicitudes_abastecimiento.count({ where }),
          tx.solicitudes_abastecimiento.findMany({
            where,
            include: requestInclude,
            orderBy: { solicitado_en: 'desc' },
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
        ]),
    );
    return {
      items: items.map((item) => this.request(item, actor)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
  async findOne(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(this.scope(actor), async (tx) =>
      this.request(await this.requestOr404(tx, id, actor), actor),
    );
  }
  async create(input: CreateSupplyRequestDto, actor: AuthenticatedUser) {
    this.assertOrg(actor, input.organizationId);
    const organizationId = input.organizationId ?? actor.organization.id;
    return this.mutate(
      actor,
      'SUPPLY_REQUEST_CREATED',
      'solicitudes_abastecimiento',
      async (tx) => {
        const personalId = await this.personalId(tx, actor, organizationId);
        await this.supplierOr400(tx, input.supplierId, organizationId);
        await this.branchOr400(tx, input.arrivalBranchId, organizationId);
        await this.versionOr400(tx, input.versionId, organizationId);
        if (input.operationId) {
          const operation = await tx.operaciones.findFirst({
            where: { id: input.operationId, organizacion_id: organizationId },
            select: { id: true },
          });
          if (!operation)
            throw new BadRequestException(
              'Operation does not belong to the selected organization',
            );
        }
        if (input.supplierAvailabilityId) {
          const availability = await tx.disponibilidad_proveedor.findFirst({
            where: {
              id: input.supplierAvailabilityId,
              proveedor_id: input.supplierId,
              version_id: input.versionId,
              condicion: input.condition,
              organizacion_id: organizationId,
            },
            select: { id: true },
          });
          if (!availability)
            throw new BadRequestException(
              'Supplier availability does not match the request',
            );
        }
        const item = await tx.solicitudes_abastecimiento.create({
          data: {
            proveedor_id: input.supplierId,
            operacion_id: input.operationId,
            disponibilidad_proveedor_id: input.supplierAvailabilityId,
            version_id: input.versionId,
            condicion: input.condition,
            sucursal_llegada_id: input.arrivalBranchId,
            referencia_proveedor: input.supplierReference?.trim(),
            costo_estimado: input.estimatedCost,
            creado_por_personal_id: personalId,
            notas: input.notes,
            organizacion_id: organizationId,
          },
          include: requestInclude,
        });
        return this.request(item, actor);
      },
      undefined,
      undefined,
      organizationId,
    );
  }
  async transition(
    id: string,
    input: SupplyTransitionDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'SUPPLY_REQUEST_TRANSITIONED',
      'solicitudes_abastecimiento',
      async (tx, event) => {
        const current = await this.requestOr404(tx, id, actor, true);
        event.targetOrganizationId = this.targetOrganization(
          actor,
          current.organizacion_id,
        );
        if (input.toStatus === 'RECIBIDO' || input.toStatus === 'ASIGNADO')
          throw new BadRequestException('Invalid supply request transition');
        if (input.toStatus === 'CANCELADA') {
          if (
            current.estado === 'RECIBIDO' ||
            current.estado === 'ASIGNADO' ||
            current.estado === 'CANCELADA'
          )
            throw new BadRequestException(
              'Supply request cannot be cancelled from its current status',
            );
        } else if (forward[current.estado] !== input.toStatus)
          throw new BadRequestException('Invalid supply request transition');
        const now = new Date();
        const data: Prisma.solicitudes_abastecimientoUpdateInput = {
          estado: input.toStatus,
          notas: input.notes === undefined ? undefined : input.notes,
          referencia_proveedor:
            input.supplierReference === undefined
              ? undefined
              : input.supplierReference.trim(),
        };
        if (input.toStatus === 'CONFIRMADO') data.confirmado_en = now;
        if (input.toStatus === 'PEDIDO') data.pedido_en = now;
        if (input.toStatus === 'EN_TRANSITO') data.despachado_en = now;
        return this.request(
          await tx.solicitudes_abastecimiento.update({
            where: {
              id_organizacion_id: {
                id,
                organizacion_id: current.organizacion_id,
              },
            },
            data,
            include: requestInclude,
          }),
          actor,
        );
      },
      id,
    );
  }
  async receive(
    id: string,
    input: ReceiveSupplyRequestDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'SUPPLY_REQUEST_RECEIVED',
      'solicitudes_abastecimiento',
      async (tx, event) => {
        const locked = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT "id" FROM "public"."solicitudes_abastecimiento" WHERE "id" = CAST(${id} AS uuid) AND (${actor.globalAccess} OR "organizacion_id" = CAST(${actor.organization.id} AS uuid)) FOR UPDATE`;
        if (!locked.length)
          throw new NotFoundException('Supply request not found');
        const current = await this.requestOr404(tx, id, actor);
        event.targetOrganizationId = this.targetOrganization(
          actor,
          current.organizacion_id,
        );
        if (input.branchId !== current.sucursal_llegada_id)
          throw new BadRequestException(
            'Reception branch must match the supply request arrival branch',
          );
        if (current.unidad_vehiculo_recibida_id) {
          const unit = await tx.unidades_vehiculos.findFirst({
            where: {
              id: current.unidad_vehiculo_recibida_id,
              organizacion_id: current.organizacion_id,
            },
            include: requestUnitInclude,
          });
          const movement = await tx.movimientos_inventario.findFirst({
            where: {
              unidad_vehiculo_id: current.unidad_vehiculo_recibida_id,
              solicitud_abastecimiento_id: id,
              organizacion_id: current.organizacion_id,
              tipo_movimiento: 'RECEPCION',
            },
            orderBy: { creado_en: 'asc' },
          });
          if (!unit || !movement)
            throw new ConflictException(
              'Supply reception link is inconsistent',
            );
          if (normalizeVin(input.vin) !== unit.vin_normalizado)
            throw new ConflictException(
              'VIN conflicts with the completed supply reception',
            );
          return {
            supplyRequest: this.request(current, actor),
            unit: this.unit(unit, actor),
            inventoryMovement: this.movement(movement),
            replayed: true,
          };
        }
        if (current.estado !== 'EN_TRANSITO')
          throw new ConflictException(
            'Only EN_TRANSITO supply requests can be received',
          );
        const vin = validateVin(input.vin);
        const personalId = await this.personalId(
          tx,
          actor,
          current.organizacion_id,
        );
        const receivedAt = input.receivedAt
          ? new Date(input.receivedAt)
          : new Date();
        let operation: {
          id: string;
          unidad_vehiculo_id: string | null;
        } | null = null;
        if (current.operacion_id) {
          await tx.$queryRaw`
            SELECT "id"
            FROM "public"."operaciones"
            WHERE "id" = CAST(${current.operacion_id} AS uuid)
              AND "organizacion_id" = CAST(${current.organizacion_id} AS uuid)
            FOR UPDATE
          `;
          operation = await tx.operaciones.findFirst({
            where: {
              id: current.operacion_id,
              organizacion_id: current.organizacion_id,
              version_id: current.version_id,
              condicion: current.condicion,
              sucursal_id: current.sucursal_llegada_id,
              estado_operacion: {
                notIn: ['CERRADA', 'CANCELADA', 'RECHAZADA'],
              },
            },
            select: { id: true, unidad_vehiculo_id: true },
          });
          if (!operation)
            throw new ConflictException(
              'Linked operation is incompatible or cannot receive inventory in its current state',
            );
          if (operation.unidad_vehiculo_id)
            throw new ConflictException(
              'Linked operation already has a physical unit',
            );
          if (current.disponibilidad_proveedor_id)
            await tx.reservas_stock.updateMany({
              where: {
                operacion_id: operation.id,
                organizacion_id: current.organizacion_id,
                estado: 'ACTIVO',
                disponibilidad_proveedor_id:
                  current.disponibilidad_proveedor_id,
              },
              data: {
                estado: 'CONSUMIDA',
                liberado_en: receivedAt,
                motivo_liberacion: 'Disponibilidad recibida y asignada',
              },
            });
        }
        if (current.disponibilidad_proveedor_id) {
          const decremented = await tx.disponibilidad_proveedor.updateMany({
            where: {
              id: current.disponibilidad_proveedor_id,
              organizacion_id: current.organizacion_id,
              cantidad_informada: { gt: 0 },
            },
            data: { cantidad_informada: { decrement: 1 } },
          });
          if (decremented.count !== 1)
            throw new ConflictException(
              'Supplier availability has no remaining quantity',
            );
        }
        const unit = await tx.unidades_vehiculos.create({
          data: {
            version_id: current.version_id,
            condicion: current.condicion,
            vin_mostrado: vin.vin,
            vin_normalizado: vin.normalizedVin,
            numero_motor: input.engineNumber?.trim(),
            motor_normalizado: input.engineNumber
              ? this.normal(input.engineNumber)
              : null,
            patente: input.licensePlate?.trim(),
            patente_normalizada: input.licensePlate
              ? this.normal(input.licensePlate)
              : null,
            anio_fabricacion: input.manufactureYear,
            kilometraje_km: input.mileageKm ?? 0,
            color: input.color?.trim(),
            sucursal_id: current.sucursal_llegada_id,
            proveedor_id: current.proveedor_id,
            origen_adquisicion: 'PROVEEDOR',
            costo_compra: input.purchaseCost ?? current.costo_estimado,
            recibido_en: receivedAt,
            organizacion_id: current.organizacion_id,
          },
          include: requestUnitInclude,
        });
        const movement = await tx.movimientos_inventario.create({
          data: {
            unidad_vehiculo_id: unit.id,
            solicitud_abastecimiento_id: id,
            tipo_movimiento: tipo_movimiento_inventario_luma.RECEPCION,
            sucursal_destino_id: current.sucursal_llegada_id,
            realizado_por_personal_id: personalId,
            notas: input.notes,
            organizacion_id: current.organizacion_id,
          },
        });
        let assignedToOperation = false;
        if (operation) {
          await tx.reservas_stock.create({
            data: {
              operacion_id: operation.id,
              unidad_vehiculo_id: unit.id,
              vence_en: new Date(
                receivedAt.getTime() + 30 * 24 * 60 * 60 * 1000,
              ),
              creado_por_personal_id: personalId,
              organizacion_id: current.organizacion_id,
            },
          });
          await tx.unidades_vehiculos.update({
            where: {
              id_organizacion_id: {
                id: unit.id,
                organizacion_id: current.organizacion_id,
              },
            },
            data: { estado_inventario: 'RESERVADO' },
          });
          await tx.operaciones.update({
            where: {
              id_organizacion_id: {
                id: operation.id,
                organizacion_id: current.organizacion_id,
              },
            },
            data: {
              unidad_vehiculo_id: unit.id,
              version_fila: { increment: 1 },
            },
          });
          await tx.movimientos_inventario.create({
            data: {
              unidad_vehiculo_id: unit.id,
              operacion_id: operation.id,
              solicitud_abastecimiento_id: id,
              tipo_movimiento: tipo_movimiento_inventario_luma.RESERVA,
              sucursal_origen_id: current.sucursal_llegada_id,
              realizado_por_personal_id: personalId,
              notas: 'Asignación automática por recepción de abastecimiento',
              organizacion_id: current.organizacion_id,
            },
          });
          assignedToOperation = true;
        }
        const request = await tx.solicitudes_abastecimiento.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: current.organizacion_id,
            },
          },
          data: {
            estado: assignedToOperation ? 'ASIGNADO' : 'RECIBIDO',
            unidad_vehiculo_recibida_id: unit.id,
            recibido_en: receivedAt,
            asignado_en: assignedToOperation ? receivedAt : undefined,
          },
          include: requestInclude,
        });
        return {
          supplyRequest: this.request(request, actor),
          unit: this.unit(unit, actor),
          inventoryMovement: this.movement(movement),
          replayed: false,
        };
      },
      id,
      input.idempotencyKey
        ? { idempotencyKey: input.idempotencyKey }
        : undefined,
    );
  }
  private async requestOr404(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
    lock = false,
  ) {
    if (lock) {
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "public"."solicitudes_abastecimiento" WHERE "id" = CAST(${id} AS uuid) AND (${actor.globalAccess} OR "organizacion_id" = CAST(${actor.organization.id} AS uuid)) FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Supply request not found');
    }
    const item = await tx.solicitudes_abastecimiento.findFirst({
      where: {
        id,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
      },
      include: requestInclude,
    });
    if (!item) throw new NotFoundException('Supply request not found');
    return item;
  }
  private async personalId(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    organizationId: string,
  ) {
    const item = await tx.personal.findFirst({
      where: {
        usuario_id: actor.id,
        organizacion_id: organizationId,
        estado: 'ACTIVO',
      },
      select: { id: true },
    });
    if (!item)
      throw new ForbiddenException(
        'Actor does not have an active personnel profile in the organization',
      );
    return item.id;
  }
  private async supplierOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const item = await tx.proveedores.findFirst({
      where: { id, organizacion_id: organizationId, activo: true },
      select: { id: true },
    });
    if (!item) throw new BadRequestException('Supplier is invalid or inactive');
  }
  private async branchOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const item = await tx.sucursales.findFirst({
      where: { id, organizacion_id: organizationId, activa: true },
      select: { id: true },
    });
    if (!item) throw new BadRequestException('Branch is invalid or inactive');
  }
  private async versionOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const item = await tx.versiones_vehiculos.findUnique({
      where: { id },
      include: { catalogo_organizaciones: true },
    });
    if (
      !item ||
      (item.alcance !== 'GLOBAL' &&
        item.organizacion_propietaria_id !== organizationId &&
        !item.catalogo_organizaciones.some(
          (row) => row.organizacion_id === organizationId,
        ))
    )
      throw new BadRequestException(
        'Version is not available to the organization',
      );
  }
  private normal(value: string) {
    return normalizeVin(value);
  }
  private request(
    item: Prisma.solicitudes_abastecimientoGetPayload<{
      include: typeof requestInclude;
    }>,
    actor: AuthenticatedUser,
  ) {
    const canViewCosts = actor.role.permissions.includes(
      'compras.costos.consultar',
    );
    return {
      id: item.id,
      supplierId: item.proveedor_id,
      supplierAvailabilityId: item.disponibilidad_proveedor_id,
      operationId: item.operacion_id,
      organizationId: item.organizacion_id,
      versionId: item.version_id,
      condition: item.condicion,
      arrivalBranchId: item.sucursal_llegada_id,
      status: item.estado,
      supplierReference: item.referencia_proveedor,
      ...(canViewCosts
        ? { estimatedCost: item.costo_estimado?.toString() ?? null }
        : {}),
      receivedUnitId: item.unidad_vehiculo_recibida_id,
      chassis: item.unidades_vehiculos?.vin_mostrado ?? null,
      requestedAt: item.solicitado_en,
      confirmedAt: item.confirmado_en,
      orderedAt: item.pedido_en,
      dispatchedAt: item.despachado_en,
      receivedAt: item.recibido_en,
      assignedAt: item.asignado_en,
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
      notes: item.notas,
      supplier: {
        id: item.proveedores.id,
        legalName: item.proveedores.razon_social,
      },
      version: {
        id: item.versiones_vehiculos.id,
        name: item.versiones_vehiculos.nombre,
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
      },
      branch: {
        id: item.sucursales.id,
        code: item.sucursales.codigo,
        name: item.sucursales.nombre,
      },
      operation: item.operaciones
        ? {
            id: item.operaciones.id,
            number: item.operaciones.numero_operacion.toString(),
            status: item.operaciones.estado_operacion,
            commercialStatus: item.operaciones.estado_operacion,
            client: {
              fullName: item.operaciones.clientes.nombre_completo,
              documentNumber: item.operaciones.clientes.numero_documento,
            },
          }
        : null,
    };
  }
  private assertOrg(actor: AuthenticatedUser, organizationId?: string) {
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
  private mutate<T>(
    actor: AuthenticatedUser,
    action: string,
    entity: string,
    work: (
      tx: Prisma.TransactionClient,
      event: AuthenticatedAuditEvent,
    ) => Promise<T>,
    entityId?: string,
    metadata?: Prisma.InputJsonObject,
    targetOrganizationId?: string,
  ) {
    const event: AuthenticatedAuditEvent = {
      action,
      entity,
      entityId,
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId: this.targetOrganization(
        actor,
        targetOrganizationId,
      ),
      metadata,
    };
    return this.audit
      .execute(event, (tx) => work(tx, event))
      .catch((error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException(
            'Inventory unit VIN conflicts with an existing reception',
          );
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        )
          throw new BadRequestException('A referenced record is invalid');
        throw error;
      });
  }
  private targetOrganization(
    actor: AuthenticatedUser,
    organizationId?: string,
  ) {
    return organizationId && organizationId !== actor.organization.id
      ? organizationId
      : undefined;
  }
  private unit(
    item: Prisma.unidades_vehiculosGetPayload<{
      include: typeof requestUnitInclude;
    }>,
    actor: AuthenticatedUser,
  ) {
    const canViewCosts = actor.role.permissions.includes(
      'compras.costos.consultar',
    );
    return {
      id: item.id,
      versionId: item.version_id,
      vin: item.vin_mostrado,
      normalizedVin: item.vin_normalizado,
      condition: item.condicion,
      engineNumber: item.numero_motor,
      licensePlate: item.patente,
      manufactureYear: item.anio_fabricacion,
      mileageKm: item.kilometraje_km,
      color: item.color,
      branchId: item.sucursal_id,
      supplierId: item.proveedor_id,
      acquisitionOrigin: item.origen_adquisicion,
      ...(canViewCosts
        ? { purchaseCost: item.costo_compra?.toString() ?? null }
        : {}),
      inventoryStatus: item.estado_inventario,
      receivedAt: item.recibido_en,
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
      organizationId: item.organizacion_id,
      version: {
        id: item.versiones_vehiculos.id,
        name: item.versiones_vehiculos.nombre,
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
      },
      branch: {
        id: item.sucursales.id,
        code: item.sucursales.codigo,
        name: item.sucursales.nombre,
      },
      supplier: item.proveedores
        ? { id: item.proveedores.id, legalName: item.proveedores.razon_social }
        : null,
    };
  }
  private movement(
    item: Prisma.movimientos_inventarioGetPayload<Record<string, never>>,
  ) {
    return {
      id: item.id,
      unitId: item.unidad_vehiculo_id,
      type: item.tipo_movimiento,
      originBranchId: item.sucursal_origen_id,
      destinationBranchId: item.sucursal_destino_id,
      supplyRequestId: item.solicitud_abastecimiento_id,
      occurredAt: item.ocurrido_en,
      notes: item.notas,
      organizationId: item.organizacion_id,
      createdAt: item.creado_en,
    };
  }
}

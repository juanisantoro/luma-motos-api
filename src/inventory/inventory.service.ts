import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, tipo_movimiento_inventario_luma } from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  BulkInventoryUnitsDto,
  InventoryBranchQueryDto,
  InventoryMovementQueryDto,
  CreateInventoryUnitDto,
  InventoryQueryDto,
  TransferInventoryUnitDto,
  UpdateInventoryUnitDto,
} from './inventory.dto';
import { normalizeVin, validateVin } from './vin';

const unitInclude = {
  versiones_vehiculos: {
    include: { modelos_vehiculos: { include: { marcas_vehiculos: true } } },
  },
  sucursales: true,
  proveedores: true,
} satisfies Prisma.unidades_vehiculosInclude;
const safeStatuses = new Set<string>([
  'EN_STOCK',
  'EN_ACONDICIONAMIENTO',
  'BLOQUEADO',
]);

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  async findAll(query: InventoryQueryDto, actor: AuthenticatedUser) {
    this.assertOrganization(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const search = query.search?.trim();
    const normalized = search ? normalizeVin(search) : undefined;
    const where: Prisma.unidades_vehiculosWhereInput = {
      organizacion_id: organizationId,
      condicion: query.condition,
      estado_inventario: query.inventoryStatus,
      sucursal_id: query.branchId,
      version_id: query.versionId,
      proveedor_id: query.supplierId,
      versiones_vehiculos: {
        modelos_vehiculos: { tipo_vehiculo: query.vehicleType },
      },
      OR: normalized
        ? [
            { vin_normalizado: { contains: normalized } },
            { patente_normalizada: { contains: normalized } },
            { numero_motor: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [total, items] = await this.prisma.withTenant(
      this.scope(actor),
      (tx) =>
        Promise.all([
          tx.unidades_vehiculos.count({ where }),
          tx.unidades_vehiculos.findMany({
            where,
            include: unitInclude,
            orderBy: [{ creado_en: 'desc' }, { id: 'desc' }],
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
        ]),
    );
    return {
      items: items.map((item) => this.unit(item)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
  async findOne(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(this.scope(actor), async (tx) =>
      this.unit(await this.unitOr404(tx, id, actor)),
    );
  }
  async create(input: CreateInventoryUnitDto, actor: AuthenticatedUser) {
    this.assertOrganization(actor, input.organizationId);
    const organizationId = input.organizationId ?? actor.organization.id;
    return this.mutate(
      actor,
      'INVENTORY_UNIT_CREATED',
      'unidades_vehiculos',
      async (tx) => this.createUnit(tx, input, actor, organizationId),
      undefined,
      organizationId,
    );
  }
  async createBulk(input: BulkInventoryUnitsDto, actor: AuthenticatedUser) {
    const normalizedVins = input.units.map(
      (unit) => validateVin(unit.vin).normalizedVin,
    );
    if (new Set(normalizedVins).size !== normalizedVins.length)
      throw new BadRequestException(
        'Bulk inventory units must have unique VINs',
      );
    const organizationIds = new Set(
      input.units.map((unit) => unit.organizationId ?? actor.organization.id),
    );
    for (const organizationId of organizationIds)
      this.assertOrganization(
        actor,
        organizationId === actor.organization.id ? undefined : organizationId,
      );
    const targetOrganizationId =
      organizationIds.size === 1 ? [...organizationIds][0] : undefined;
    return this.mutate(
      actor,
      'INVENTORY_UNITS_BULK_CREATED',
      'unidades_vehiculos',
      async (tx) => {
        const items = [];
        for (const unit of input.units) {
          items.push(
            await this.createUnit(
              tx,
              unit,
              actor,
              unit.organizationId ?? actor.organization.id,
            ),
          );
        }
        return { items, count: items.length };
      },
      undefined,
      targetOrganizationId,
    );
  }
  async update(
    id: string,
    input: UpdateInventoryUnitDto,
    actor: AuthenticatedUser,
  ) {
    if (Object.keys(input).length === 0)
      throw new BadRequestException('At least one editable field is required');
    if (input.inventoryStatus && !safeStatuses.has(input.inventoryStatus))
      throw new BadRequestException(
        'Inventory status cannot be set through this endpoint',
      );
    return this.mutate(
      actor,
      'INVENTORY_UNIT_UPDATED',
      'unidades_vehiculos',
      async (tx, event) => {
        const current = await this.unitOr404(tx, id, actor, true);
        event.targetOrganizationId = this.targetOrganization(
          actor,
          current.organizacion_id,
        );
        const updated = await tx.unidades_vehiculos.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: current.organizacion_id,
            },
          },
          data: {
            numero_motor: input.engineNumber,
            motor_normalizado:
              input.engineNumber === undefined
                ? undefined
                : input.engineNumber === null
                  ? null
                  : this.normal(input.engineNumber),
            patente: input.licensePlate,
            patente_normalizada:
              input.licensePlate === undefined
                ? undefined
                : input.licensePlate === null
                  ? null
                  : this.normal(input.licensePlate),
            anio_fabricacion: input.manufactureYear,
            kilometraje_km: input.mileageKm,
            color: input.color,
            costo_compra: input.purchaseCost,
            estado_inventario: input.inventoryStatus,
          },
          include: unitInclude,
        });
        return this.unit(updated);
      },
      id,
    );
  }
  async transfer(
    id: string,
    input: TransferInventoryUnitDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'INVENTORY_UNIT_TRANSFERRED',
      'unidades_vehiculos',
      async (tx, event) => {
        const current = await this.unitOr404(tx, id, actor, true);
        event.targetOrganizationId = this.targetOrganization(
          actor,
          current.organizacion_id,
        );
        if (current.estado_inventario !== 'EN_STOCK')
          throw new ConflictException('Only EN_STOCK units can be transferred');
        if (current.sucursal_id === input.destinationBranchId)
          throw new BadRequestException(
            'Transfer destination must differ from origin',
          );
        await this.branchOr400(
          tx,
          input.destinationBranchId,
          current.organizacion_id,
        );
        const personalId = await this.personalId(
          tx,
          actor,
          current.organizacion_id,
        );
        const unit = await tx.unidades_vehiculos.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: current.organizacion_id,
            },
          },
          data: { sucursal_id: input.destinationBranchId },
          include: unitInclude,
        });
        const movement = await tx.movimientos_inventario.create({
          data: {
            unidad_vehiculo_id: id,
            tipo_movimiento: tipo_movimiento_inventario_luma.TRASLADO,
            sucursal_origen_id: current.sucursal_id,
            sucursal_destino_id: input.destinationBranchId,
            realizado_por_personal_id: personalId,
            notas: input.notes,
            organizacion_id: current.organizacion_id,
          },
        });
        return { unit: this.unit(unit), movement: this.movement(movement) };
      },
      id,
    );
  }
  async movements(
    id: string,
    query: InventoryMovementQueryDto,
    actor: AuthenticatedUser,
  ) {
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const unit = await this.unitOr404(tx, id, actor);
      const where: Prisma.movimientos_inventarioWhereInput = {
        unidad_vehiculo_id: id,
        organizacion_id: unit.organizacion_id,
      };
      const [total, rows] = await Promise.all([
        tx.movimientos_inventario.count({ where }),
        tx.movimientos_inventario.findMany({
          where,
          orderBy: [{ ocurrido_en: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ]);
      return {
        items: rows.map((row) => this.movement(row)),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }
  async branches(query: InventoryBranchQueryDto, actor: AuthenticatedUser) {
    this.assertOrganization(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    return this.prisma.withTenant(this.scope(actor), (tx) =>
      tx.sucursales
        .findMany({
          where: { activa: true, organizacion_id: organizationId },
          select: {
            id: true,
            codigo: true,
            nombre: true,
            organizacion_id: true,
          },
          orderBy: { nombre: 'asc' },
        })
        .then((rows) =>
          rows.map((row) => ({
            id: row.id,
            code: row.codigo,
            name: row.nombre,
            organizationId: row.organizacion_id,
          })),
        ),
    );
  }
  private async createUnit(
    tx: Prisma.TransactionClient,
    input: CreateInventoryUnitDto,
    actor: AuthenticatedUser,
    organizationId: string,
  ) {
    const vin = validateVin(input.vin);
    const personalId = await this.personalId(tx, actor, organizationId);
    await this.versionOr400(tx, input.versionId, organizationId);
    await this.branchOr400(tx, input.branchId, organizationId);
    if (input.supplierId)
      await this.supplierOr400(tx, input.supplierId, organizationId);
    const unit = await tx.unidades_vehiculos.create({
      data: {
        version_id: input.versionId,
        condicion: input.condition,
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
        sucursal_id: input.branchId,
        proveedor_id: input.supplierId,
        origen_adquisicion: input.acquisitionOrigin,
        costo_compra: input.purchaseCost,
        recibido_en: input.receivedAt ? new Date(input.receivedAt) : new Date(),
        organizacion_id: organizationId,
      },
      include: unitInclude,
    });
    await tx.movimientos_inventario.create({
      data: {
        unidad_vehiculo_id: unit.id,
        tipo_movimiento: tipo_movimiento_inventario_luma.RECEPCION,
        sucursal_destino_id: unit.sucursal_id,
        realizado_por_personal_id: personalId,
        organizacion_id: organizationId,
      },
    });
    return this.unit(unit);
  }
  private async unitOr404(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
    lock = false,
  ) {
    if (lock) {
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "public"."unidades_vehiculos" WHERE "id" = CAST(${id} AS uuid) AND (${actor.globalAccess} OR "organizacion_id" = CAST(${actor.organization.id} AS uuid)) FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Inventory unit not found');
    }
    const row = await tx.unidades_vehiculos.findFirst({
      where: {
        id,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
      },
      include: unitInclude,
    });
    if (!row) throw new NotFoundException('Inventory unit not found');
    return row;
  }
  private async versionOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const row = await tx.versiones_vehiculos.findUnique({
      where: { id },
      include: { catalogo_organizaciones: true },
    });
    if (
      !row ||
      (row.alcance !== 'GLOBAL' &&
        row.organizacion_propietaria_id !== organizationId &&
        !row.catalogo_organizaciones.some(
          (item) => item.organizacion_id === organizationId,
        ))
    )
      throw new BadRequestException(
        'Version is not available to the organization',
      );
  }
  private async branchOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const row = await tx.sucursales.findFirst({
      where: { id, organizacion_id: organizationId, activa: true },
      select: { id: true },
    });
    if (!row) throw new BadRequestException('Branch is invalid or inactive');
  }
  private async supplierOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const row = await tx.proveedores.findFirst({
      where: { id, organizacion_id: organizationId, activo: true },
      select: { id: true },
    });
    if (!row) throw new BadRequestException('Supplier is invalid or inactive');
  }
  private async personalId(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    organizationId: string,
  ) {
    const row = await tx.personal.findFirst({
      where: {
        usuario_id: actor.id,
        organizacion_id: organizationId,
        estado: 'ACTIVO',
      },
      select: { id: true },
    });
    if (!row)
      throw new ForbiddenException(
        'Actor does not have an active personnel profile in the organization',
      );
    return row.id;
  }
  private normal(value: string) {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  private assertOrganization(
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
  private mutate<T>(
    actor: AuthenticatedUser,
    action: string,
    entity: string,
    work: (
      tx: Prisma.TransactionClient,
      event: AuthenticatedAuditEvent,
    ) => Promise<T>,
    entityId?: string,
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
    };
    return this.audit
      .execute(event, (tx) => work(tx, event))
      .catch((error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException(
            'An inventory unit with that VIN already exists',
          );
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        )
          throw new BadRequestException('A referenced record is invalid');
        throw error;
      });
  }
  private unit(
    item: Prisma.unidades_vehiculosGetPayload<{ include: typeof unitInclude }>,
  ) {
    return {
      id: item.id,
      versionId: item.version_id,
      vin: item.vin_mostrado,
      condition: item.condicion,
      engineNumber: item.numero_motor,
      licensePlate: item.patente,
      manufactureYear: item.anio_fabricacion,
      mileageKm: item.kilometraje_km,
      color: item.color,
      branchId: item.sucursal_id,
      supplierId: item.proveedor_id,
      acquisitionOrigin: item.origen_adquisicion,
      purchaseCost: item.costo_compra?.toString() ?? null,
      inventoryStatus: item.estado_inventario,
      receivedAt: item.recibido_en,
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
      normalizedVin: item.vin_normalizado,
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
  private targetOrganization(
    actor: AuthenticatedUser,
    organizationId?: string,
  ) {
    return organizationId && organizationId !== actor.organization.id
      ? organizationId
      : undefined;
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

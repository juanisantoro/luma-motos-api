import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { alcance_catalogo_luma, Prisma } from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogQueryDto,
  CreateModelDto,
  CreatePricePolicyDto,
  CreateVersionDto,
  NameDto,
  UpdateModelDto,
  UpdateNameDto,
  UpdateVersionDto,
} from './catalog.dto';

const brandSelect = {
  id: true,
  nombre: true,
  activo: true,
  creado_en: true,
  actualizado_en: true,
} satisfies Prisma.marcas_vehiculosSelect;
const modelSelect = {
  id: true,
  nombre: true,
  tipo_vehiculo: true,
  activo: true,
  creado_en: true,
  actualizado_en: true,
  marcas_vehiculos: { select: brandSelect },
} satisfies Prisma.modelos_vehiculosSelect;
const versionSelect = {
  id: true,
  nombre: true,
  es_marcador: true,
  activo: true,
  alcance: true,
  organizacion_propietaria_id: true,
  creado_en: true,
  actualizado_en: true,
  modelos_vehiculos: { select: modelSelect },
  catalogo_organizaciones: { select: { organizacion_id: true } },
} satisfies Prisma.versiones_vehiculosSelect;
const pricePolicyInclude = {
  versiones_vehiculos: {
    include: { modelos_vehiculos: { include: { marcas_vehiculos: true } } },
  },
  sucursales: true,
} satisfies Prisma.politicas_precios_vehiculosInclude;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async brands(query: CatalogQueryDto, actor: AuthenticatedUser) {
    this.assertOrganizationFilter(actor, query.organizationId);
    const where: Prisma.marcas_vehiculosWhereInput = {
      activo: query.active,
      nombre_normalizado: query.search
        ? { contains: this.normalize(query.search), mode: 'insensitive' }
        : undefined,
      modelos_vehiculos: query.vehicleType
        ? { some: { tipo_vehiculo: query.vehicleType } }
        : undefined,
    };
    return this.page(
      query,
      actor,
      (tx) =>
        Promise.all([
          tx.marcas_vehiculos.count({ where }),
          tx.marcas_vehiculos.findMany({
            where,
            select: brandSelect,
            orderBy: { nombre_normalizado: 'asc' },
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
        ]),
      (item) => this.toBrand(item),
    );
  }
  async brand(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(this.scope(actor), async (tx) =>
      this.brandOr404(tx, id),
    );
  }
  async createBrand(input: NameDto, actor: AuthenticatedUser) {
    this.requireGlobal(
      actor,
      'Only users with global access can manage shared catalog brands',
    );
    return this.mutate(
      actor,
      'CATALOG_BRAND_CREATED',
      'marcas_vehiculos',
      async (tx) =>
        this.toBrand(
          await tx.marcas_vehiculos.create({
            data: {
              nombre: input.name.trim(),
              nombre_normalizado: this.normalize(input.name),
            },
            select: brandSelect,
          }),
        ),
    );
  }
  async updateBrand(
    id: string,
    input: UpdateNameDto,
    actor: AuthenticatedUser,
  ) {
    this.requireGlobal(
      actor,
      'Only users with global access can manage shared catalog brands',
    );
    if (input.name === undefined && input.active === undefined)
      throw new BadRequestException('At least one editable field is required');
    return this.mutate(
      actor,
      'CATALOG_BRAND_UPDATED',
      'marcas_vehiculos',
      async (tx) => {
        await this.brandOr404(tx, id);
        return this.toBrand(
          await tx.marcas_vehiculos.update({
            where: { id },
            data: {
              nombre: input.name?.trim(),
              nombre_normalizado: input.name
                ? this.normalize(input.name)
                : undefined,
              activo: input.active,
            },
            select: brandSelect,
          }),
        );
      },
      id,
    );
  }
  async models(query: CatalogQueryDto, actor: AuthenticatedUser) {
    this.assertOrganizationFilter(actor, query.organizationId);
    const where: Prisma.modelos_vehiculosWhereInput = {
      tipo_vehiculo: query.vehicleType,
      marca_id: query.brandId,
      activo: query.active,
      nombre_normalizado: query.search
        ? { contains: this.normalize(query.search), mode: 'insensitive' }
        : undefined,
    };
    return this.page(
      query,
      actor,
      (tx) =>
        Promise.all([
          tx.modelos_vehiculos.count({
            where,
          }),
          tx.modelos_vehiculos.findMany({
            where,
            select: modelSelect,
            orderBy: { nombre_normalizado: 'asc' },
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
        ]),
      (item) => this.toModel(item),
    );
  }
  async model(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(this.scope(actor), async (tx) =>
      this.toModel(await this.modelOr404(tx, id)),
    );
  }
  async createModel(input: CreateModelDto, actor: AuthenticatedUser) {
    this.requireGlobal(
      actor,
      'Only users with global access can manage shared catalog models',
    );
    return this.mutate(
      actor,
      'CATALOG_MODEL_CREATED',
      'modelos_vehiculos',
      async (tx) => {
        await this.brandOr404(tx, input.brandId);
        return this.toModel(
          await tx.modelos_vehiculos.create({
            data: {
              marca_id: input.brandId,
              tipo_vehiculo: input.vehicleType,
              nombre: input.name.trim(),
              nombre_normalizado: this.normalize(input.name),
            },
            select: modelSelect,
          }),
        );
      },
    );
  }
  async updateModel(
    id: string,
    input: UpdateModelDto,
    actor: AuthenticatedUser,
  ) {
    this.requireGlobal(
      actor,
      'Only users with global access can manage shared catalog models',
    );
    if (
      input.name === undefined &&
      input.active === undefined &&
      input.vehicleType === undefined
    )
      throw new BadRequestException('At least one editable field is required');
    return this.mutate(
      actor,
      'CATALOG_MODEL_UPDATED',
      'modelos_vehiculos',
      async (tx) => {
        await this.modelOr404(tx, id);
        return this.toModel(
          await tx.modelos_vehiculos.update({
            where: { id },
            data: {
              nombre: input.name?.trim(),
              nombre_normalizado: input.name
                ? this.normalize(input.name)
                : undefined,
              activo: input.active,
              tipo_vehiculo: input.vehicleType,
            },
            select: modelSelect,
          }),
        );
      },
      id,
    );
  }
  async versions(query: CatalogQueryDto, actor: AuthenticatedUser) {
    this.assertOrganizationFilter(actor, query.organizationId);
    const organizationId = query.organizationId ?? actor.organization.id;
    const where: Prisma.versiones_vehiculosWhereInput =
      actor.globalAccess && !query.organizationId
        ? {}
        : {
            OR: [
              { alcance: 'GLOBAL' },
              { organizacion_propietaria_id: organizationId },
              {
                catalogo_organizaciones: {
                  some: { organizacion_id: organizationId },
                },
              },
            ],
          };
    if (query.vehicleType || query.brandId)
      where.modelos_vehiculos = {
        tipo_vehiculo: query.vehicleType,
        marca_id: query.brandId,
      };
    where.modelo_id = query.modelId;
    where.alcance = query.scope;
    where.activo = query.active;
    if (query.search)
      where.nombre_normalizado = {
        contains: this.normalize(query.search),
        mode: 'insensitive',
      };
    return this.page(
      query,
      actor,
      (tx) =>
        Promise.all([
          tx.versiones_vehiculos.count({ where }),
          tx.versiones_vehiculos.findMany({
            where,
            select: versionSelect,
            orderBy: { nombre_normalizado: 'asc' },
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
        ]),
      (item) => this.toVersion(item),
    );
  }
  async version(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(this.scope(actor), async (tx) =>
      this.toVersion(await this.versionOr404(tx, id, actor)),
    );
  }
  async createVersion(input: CreateVersionDto, actor: AuthenticatedUser) {
    this.assertOrganizationSelection(actor, input.organizationId);
    const ownerId = input.organizationId ?? actor.organization.id;
    const scope = input.scope ?? alcance_catalogo_luma.RESTRINGIDO;
    if (scope === 'GLOBAL')
      this.requireGlobal(
        actor,
        'Only users with global access can create global catalog versions',
      );
    return this.mutate(
      actor,
      'CATALOG_VERSION_CREATED',
      'versiones_vehiculos',
      async (tx) => {
        await this.modelOr404(tx, input.modelId);
        const created = await tx.versiones_vehiculos.create({
          data: {
            modelo_id: input.modelId,
            nombre: input.name.trim(),
            nombre_normalizado: this.normalize(input.name),
            es_marcador: input.marker ?? false,
            alcance: scope,
            organizacion_propietaria_id:
              scope === 'RESTRINGIDO' ? ownerId : null,
            catalogo_organizaciones:
              scope === 'RESTRINGIDO'
                ? {
                    createMany: {
                      data: [
                        ...new Set([ownerId, ...(input.organizationIds ?? [])]),
                      ].map((organizacion_id) => ({ organizacion_id })),
                    },
                  }
                : undefined,
          },
          select: versionSelect,
        });
        return this.toVersion(created);
      },
      undefined,
      ownerId,
    );
  }
  async updateVersion(
    id: string,
    input: UpdateVersionDto,
    actor: AuthenticatedUser,
  ) {
    if (
      input.name === undefined &&
      input.active === undefined &&
      input.marker === undefined &&
      input.scope === undefined &&
      input.organizationIds === undefined
    )
      throw new BadRequestException('At least one editable field is required');
    return this.mutate(
      actor,
      'CATALOG_VERSION_UPDATED',
      'versiones_vehiculos',
      async (tx, event) => {
        const current = await this.versionOr404(tx, id, actor);
        event.targetOrganizationId = this.targetOrganization(
          actor,
          current.organizacion_propietaria_id ?? undefined,
        );
        if (
          !actor.globalAccess &&
          current.organizacion_propietaria_id !== actor.organization.id
        )
          throw new ForbiddenException(
            'Only the catalog owner can update this version',
          );
        if (input.scope === 'GLOBAL')
          this.requireGlobal(
            actor,
            'Only users with global access can make a catalog version global',
          );
        const scope = input.scope ?? current.alcance;
        const ownerId =
          current.organizacion_propietaria_id ?? actor.organization.id;
        const assignmentIds =
          input.organizationIds ??
          (input.scope === 'RESTRINGIDO' ? [ownerId] : undefined);
        if (assignmentIds !== undefined) {
          if (
            !actor.globalAccess &&
            assignmentIds.some((value) => value !== actor.organization.id)
          )
            throw new ForbiddenException(
              'Only users with global access can assign other organizations',
            );
          await tx.catalogo_organizaciones.deleteMany({
            where: { version_id: id },
          });
          if (scope === 'RESTRINGIDO')
            await tx.catalogo_organizaciones.createMany({
              data: [...new Set([ownerId, ...assignmentIds])].map(
                (organizacion_id) => ({ organizacion_id, version_id: id }),
              ),
            });
        }
        return this.toVersion(
          await tx.versiones_vehiculos.update({
            where: { id },
            data: {
              nombre: input.name?.trim(),
              nombre_normalizado: input.name
                ? this.normalize(input.name)
                : undefined,
              activo: input.active,
              es_marcador: input.marker,
              alcance: input.scope,
              organizacion_propietaria_id:
                input.scope === undefined
                  ? undefined
                  : scope === 'RESTRINGIDO'
                    ? ownerId
                    : null,
            },
            select: versionSelect,
          }),
        );
      },
      id,
    );
  }
  async pricePolicies(query: CatalogQueryDto, actor: AuthenticatedUser) {
    this.assertOrganizationFilter(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const currentOn = query.currentOn ? new Date(query.currentOn) : new Date();
    currentOn.setHours(0, 0, 0, 0);
    const where: Prisma.politicas_precios_vehiculosWhereInput = {
      organizacion_id: organizationId,
      version_id: query.versionId,
      sucursal_id: query.branchId,
      vigente_desde: { lte: currentOn },
      OR: [{ vigente_hasta: null }, { vigente_hasta: { gte: currentOn } }],
      versiones_vehiculos: query.vehicleType
        ? { modelos_vehiculos: { tipo_vehiculo: query.vehicleType } }
        : undefined,
    };
    return this.page(
      query,
      actor,
      (tx) =>
        Promise.all([
          tx.politicas_precios_vehiculos.count({ where }),
          tx.politicas_precios_vehiculos.findMany({
            where,
            include: {
              versiones_vehiculos: {
                include: {
                  modelos_vehiculos: { include: { marcas_vehiculos: true } },
                },
              },
              sucursales: true,
            },
            orderBy: { vigente_desde: 'desc' },
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
        ]),
      (item) => this.toPricePolicy(item),
    );
  }
  async createPricePolicy(
    input: CreatePricePolicyDto,
    actor: AuthenticatedUser,
  ) {
    this.assertOrganizationSelection(actor, input.organizationId);
    if (input.minimumPrice > input.listPrice)
      throw new BadRequestException('Minimum price cannot exceed list price');
    const organizationId = input.organizationId ?? actor.organization.id;
    const validFrom = new Date(input.validFrom);
    const validUntil = input.validUntil ? new Date(input.validUntil) : null;
    if (validUntil && validUntil <= validFrom)
      throw new BadRequestException('Valid until must be after valid from');
    return this.mutate(
      actor,
      'PRICE_POLICY_CREATED',
      'politicas_precios_vehiculos',
      async (tx) => {
        const personalId = await this.personalId(tx, actor, organizationId);
        await this.versionAvailableOr400(tx, input.versionId, organizationId);
        if (input.branchId)
          await this.branchOr400(tx, input.branchId, organizationId);
        return this.toPricePolicy(
          await tx.politicas_precios_vehiculos.create({
            data: {
              version_id: input.versionId,
              sucursal_id: input.branchId,
              moneda: input.currency.trim().toUpperCase(),
              precio_lista: input.listPrice,
              precio_minimo: input.minimumPrice,
              vigente_desde: validFrom,
              vigente_hasta: validUntil,
              creado_por_personal_id: personalId,
              organizacion_id: organizationId,
            },
            include: pricePolicyInclude,
          }),
        );
      },
      undefined,
      organizationId,
    );
  }
  private async page<T, R>(
    query: CatalogQueryDto,
    actor: AuthenticatedUser,
    action: (tx: Prisma.TransactionClient) => Promise<[number, T[]]>,
    map: (item: T) => R,
  ) {
    const [total, items] = await this.prisma.withTenant(
      this.scope(actor),
      action,
    );
    return {
      items: items.map(map),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
  private mutate<T>(
    actor: AuthenticatedUser,
    action: string,
    entity: string,
    operation: (
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
      .execute(event, async (tx) => {
        const result = await operation(tx, event);
        return result;
      })
      .catch((error) => this.conflict(error));
  }
  private scope(actor: AuthenticatedUser) {
    return {
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
    };
  }
  private normalize(value: string) {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-AR');
  }
  private requireGlobal(actor: AuthenticatedUser, message: string) {
    if (!actor.globalAccess) throw new ForbiddenException(message);
  }
  private assertOrganizationFilter(
    actor: AuthenticatedUser,
    organizationId?: string,
  ) {
    if (organizationId && !actor.globalAccess)
      throw new ForbiddenException(
        'Only users with global access can filter by organization',
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
  private async brandOr404(tx: Prisma.TransactionClient, id: string) {
    const item = await tx.marcas_vehiculos.findUnique({
      where: { id },
      select: brandSelect,
    });
    if (!item) throw new NotFoundException('Brand not found');
    return this.toBrand(item);
  }
  private async modelOr404(tx: Prisma.TransactionClient, id: string) {
    const item = await tx.modelos_vehiculos.findUnique({
      where: { id },
      select: modelSelect,
    });
    if (!item) throw new NotFoundException('Model not found');
    return item;
  }
  private async versionOr404(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
  ) {
    const item = await tx.versiones_vehiculos.findUnique({
      where: { id },
      select: versionSelect,
    });
    if (
      !item ||
      (!actor.globalAccess &&
        item.alcance !== 'GLOBAL' &&
        item.organizacion_propietaria_id !== actor.organization.id &&
        !item.catalogo_organizaciones.some(
          (row) => row.organizacion_id === actor.organization.id,
        ))
    )
      throw new NotFoundException('Version not found');
    return item;
  }
  private async versionAvailableOr400(
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
  private toBrand(
    item: Prisma.marcas_vehiculosGetPayload<{ select: typeof brandSelect }>,
  ) {
    return {
      id: item.id,
      name: item.nombre,
      active: item.activo,
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
    };
  }
  private toModel(
    item: Prisma.modelos_vehiculosGetPayload<{ select: typeof modelSelect }>,
  ) {
    return {
      id: item.id,
      name: item.nombre,
      vehicleType: item.tipo_vehiculo,
      active: item.activo,
      brand: this.toBrand(item.marcas_vehiculos),
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
    };
  }
  private toVersion(
    item: Prisma.versiones_vehiculosGetPayload<{
      select: typeof versionSelect;
    }>,
  ) {
    return {
      id: item.id,
      name: item.nombre,
      marker: item.es_marcador,
      active: item.activo,
      scope: item.alcance,
      ownerOrganizationId: item.organizacion_propietaria_id,
      sellableOrganizationIds: item.catalogo_organizaciones.map(
        (row) => row.organizacion_id,
      ),
      model: this.toModel(item.modelos_vehiculos),
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
    };
  }
  private toPricePolicy(
    item: Prisma.politicas_precios_vehiculosGetPayload<{
      include: typeof pricePolicyInclude;
    }>,
  ) {
    return {
      id: item.id,
      versionId: item.version_id,
      branchId: item.sucursal_id,
      organizationId: item.organizacion_id,
      currency: item.moneda,
      listPrice: item.precio_lista.toString(),
      minimumPrice: item.precio_minimo.toString(),
      validFrom: item.vigente_desde,
      validUntil: item.vigente_hasta,
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
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
      branch: item.sucursales
        ? {
            id: item.sucursales.id,
            code: item.sucursales.codigo,
            name: item.sucursales.nombre,
          }
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
  private conflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    )
      throw new ConflictException('A record with that name already exists');
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    )
      throw new BadRequestException('A referenced record is invalid');
    throw error;
  }
}

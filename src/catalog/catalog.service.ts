import { unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  alcance_catalogo_luma,
  Prisma,
  tipo_vehiculo_luma,
} from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import { PERMISSION_CODES } from '../auth/auth.constants';
import { AuthenticatedUser } from '../auth/auth.types';
import { EnvironmentVariables } from '../config/environment';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogQueryDto,
  CreateModelDto,
  CreatePricePolicyDto,
  CreateVersionDto,
  EffectivePricePolicyQueryDto,
  NameDto,
  UpdateModelDto,
  UpdateNameDto,
  UpdateVersionDto,
} from './catalog.dto';
import {
  activePricePolicyRequired,
  findEffectivePricePolicy,
  previousDate,
  selectEffectivePricePolicy,
  toDateOnly,
} from './price-policy';

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
  foto_url: true,
  precio_costo: true,
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

export interface ProvisionCatalogPriceInput {
  vehicleType: tipo_vehiculo_luma;
  brandName: string;
  modelName: string;
  versionName: string;
  pricePolicy: {
    currency: string;
    listPrice: number;
    minimumPrice: number;
    validFrom?: string;
  };
}

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}
  async provisionVersionWithPolicy(
    tx: Prisma.TransactionClient,
    input: ProvisionCatalogPriceInput,
    organizationId: string,
    personalId: string,
    globalAccess: boolean,
  ) {
    if (input.pricePolicy.minimumPrice > input.pricePolicy.listPrice)
      throw new BadRequestException('Minimum price cannot exceed list price');
    const brandName = input.brandName.trim().replace(/\s+/g, ' ');
    const modelName = input.modelName.trim().replace(/\s+/g, ' ');
    const versionName = input.versionName.trim().replace(/\s+/g, ' ');
    const brandNormalized = this.normalize(brandName);
    const modelNormalized = this.normalize(modelName);
    const versionNormalized = this.normalize(versionName);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${brandNormalized}:${input.vehicleType}:${modelNormalized}`}, 0))`;
    let brand = await tx.marcas_vehiculos.findUnique({
      where: { nombre_normalizado: brandNormalized },
    });
    if (!brand) {
      if (!globalAccess)
        throw new ForbiddenException(
          'Global access is required to create a shared vehicle brand',
        );
      brand = await tx.marcas_vehiculos.create({
        data: { nombre: brandName, nombre_normalizado: brandNormalized },
      });
    } else if (!brand.activo) {
      if (!globalAccess)
        throw new ConflictException('Vehicle brand is inactive');
      brand = await tx.marcas_vehiculos.update({
        where: { id: brand.id },
        data: { activo: true },
      });
    }
    let model = await tx.modelos_vehiculos.findFirst({
      where: {
        marca_id: brand.id,
        tipo_vehiculo: input.vehicleType,
        nombre_normalizado: modelNormalized,
      },
    });
    if (!model) {
      if (!globalAccess)
        throw new ForbiddenException(
          'Global access is required to create a shared vehicle model',
        );
      model = await tx.modelos_vehiculos.create({
        data: {
          marca_id: brand.id,
          tipo_vehiculo: input.vehicleType,
          nombre: modelName,
          nombre_normalizado: modelNormalized,
        },
      });
    } else if (!model.activo) {
      if (!globalAccess)
        throw new ConflictException('Vehicle model is inactive');
      model = await tx.modelos_vehiculos.update({
        where: { id: model.id },
        data: { activo: true },
      });
    }
    let version = await tx.versiones_vehiculos.findFirst({
      where: {
        modelo_id: model.id,
        nombre_normalizado: versionNormalized,
        OR: [
          { alcance: 'GLOBAL' },
          { organizacion_propietaria_id: organizationId },
          {
            catalogo_organizaciones: {
              some: { organizacion_id: organizationId },
            },
          },
        ],
      },
    });
    if (!version)
      version = await tx.versiones_vehiculos.create({
        data: {
          modelo_id: model.id,
          nombre: versionName,
          nombre_normalizado: versionNormalized,
          alcance: 'RESTRINGIDO',
          organizacion_propietaria_id: organizationId,
        },
      });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const validFrom = input.pricePolicy.validFrom
      ? new Date(input.pricePolicy.validFrom)
      : today;
    if (validFrom > today)
      throw new BadRequestException(
        'Initial price policy must be active today',
      );
    let policy = await tx.politicas_precios_vehiculos.findFirst({
      where: {
        organizacion_id: organizationId,
        version_id: version.id,
        sucursal_id: null,
        vigente_desde: { lte: today },
        OR: [{ vigente_hasta: null }, { vigente_hasta: { gte: today } }],
      },
      orderBy: [{ vigente_desde: 'desc' }, { creado_en: 'desc' }],
    });
    const pricePolicyCreated = !policy;
    if (!policy)
      policy = await tx.politicas_precios_vehiculos.create({
        data: {
          version_id: version.id,
          moneda: input.pricePolicy.currency.toUpperCase(),
          precio_lista: input.pricePolicy.listPrice,
          precio_minimo: input.pricePolicy.minimumPrice,
          vigente_desde: validFrom,
          creado_por_personal_id: personalId,
          organizacion_id: organizationId,
        },
      });
    if (
      version.alcance === 'RESTRINGIDO' &&
      version.organizacion_propietaria_id === organizationId
    )
      await tx.catalogo_organizaciones.upsert({
        where: {
          organizacion_id_version_id: {
            organizacion_id: organizationId,
            version_id: version.id,
          },
        },
        create: {
          organizacion_id: organizationId,
          version_id: version.id,
        },
        update: { puede_vender: true },
      });
    return { brand, model, version, policy, pricePolicyCreated };
  }

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
        const current = await this.modelOr404(tx, id);
        if (
          input.vehicleType &&
          input.vehicleType !== current.tipo_vehiculo &&
          (await tx.versiones_vehiculos.count({ where: { modelo_id: id } })) > 0
        )
          throw new ConflictException(
            'Vehicle type cannot be changed after versions have been created; deactivate the model and create a new one',
          );
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
    const currentOn = toDateOnly(query.currentOn ?? new Date());
    const [total, items] = await this.prisma.withTenant(
      this.scope(actor),
      (tx) =>
        Promise.all([
          tx.versiones_vehiculos.count({ where }),
          tx.versiones_vehiculos.findMany({
            relationLoadStrategy: 'join',
            where,
            select: {
              ...versionSelect,
              politicas_precios_vehiculos: {
                where: {
                  organizacion_id: organizationId,
                  activa: true,
                  vigente_desde: { lte: currentOn },
                  AND: [
                    {
                      OR: [
                        { vigente_hasta: null },
                        { vigente_hasta: { gte: currentOn } },
                      ],
                    },
                    {
                      OR: query.branchId
                        ? [
                            { sucursal_id: query.branchId },
                            { sucursal_id: null },
                          ]
                        : [{ sucursal_id: null }],
                    },
                  ],
                },
                select: {
                  id: true,
                  sucursal_id: true,
                  moneda: true,
                  precio_lista: true,
                  precio_minimo: true,
                  vigente_desde: true,
                  vigente_hasta: true,
                },
                orderBy: [{ vigente_desde: 'desc' }, { creado_en: 'desc' }],
              },
            },
            orderBy: { nombre_normalizado: 'asc' },
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
        ]),
    );
    return {
      items: items.map((item) => {
        const policies = item.politicas_precios_vehiculos ?? [];
        const policy = selectEffectivePricePolicy(policies, query.branchId);
        return {
          ...this.toVersion(item, actor),
          hasActivePricePolicy: Boolean(policy),
          pricingStatus: policy ? 'ACTIVE' : 'MISSING',
          activePricePolicy: policy
            ? {
                id: policy.id,
                branchId: policy.sucursal_id,
                currency: policy.moneda,
                listPrice: policy.precio_lista.toString(),
                minimumPrice: policy.precio_minimo.toString(),
                validFrom: policy.vigente_desde,
                validUntil: policy.vigente_hasta,
                scope: policy.sucursal_id ? 'BRANCH' : 'ORGANIZATION',
                status: 'ACTIVE',
              }
            : null,
        };
      }),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
  async version(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(this.scope(actor), async (tx) =>
      this.toVersion(await this.versionOr404(tx, id, actor), actor),
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
            // The cost price is a sensitive margin figure: only persist it
            // when the actor holds catalogo.costos.gestionar. A caller
            // without that permission who sends it anyway is silently
            // ignored rather than rejected, matching how the read side
            // simply omits the field instead of erroring.
            precio_costo: this.canManageCosts(actor)
              ? input.costPrice
              : undefined,
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
        return this.toVersion(created, actor);
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
      input.organizationIds === undefined &&
      input.costPrice === undefined
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
              // See createVersion: only persist when the actor can manage
              // catalog costs; otherwise silently ignored.
              precio_costo:
                input.costPrice === undefined
                  ? undefined
                  : this.canManageCosts(actor)
                    ? input.costPrice
                    : undefined,
            },
            select: versionSelect,
          }),
          actor,
        );
      },
      id,
    );
  }
  async setVersionPhoto(
    id: string,
    file: Express.Multer.File,
    actor: AuthenticatedUser,
  ) {
    const uploadsDir = resolve(
      this.config.get('CATALOG_UPLOADS_DIR', { infer: true }),
    );
    // Normalize every upload to WebP: it compresses noticeably smaller than
    // JPEG/PNG at the same visual quality, which matters a lot for phone
    // camera photos (often several MB straight out of the camera). We also
    // downscale to a sane max size, since catalog photos are never shown
    // larger than the lightbox.
    const webpFilename = `${basename(file.filename, extname(file.filename))}.webp`;
    const webpPath = join(uploadsDir, webpFilename);
    const isAlreadyWebpFile = webpFilename === file.filename;
    try {
      const pipeline = () =>
        sharp(file.path)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 });
      if (isAlreadyWebpFile) {
        // Input and output share the same path - read fully into memory
        // first so we don't read from and write to the file at once.
        const optimized = await pipeline().toBuffer();
        await writeFile(webpPath, optimized);
      } else {
        await pipeline().toFile(webpPath);
        await unlink(file.path).catch((error: unknown) => {
          this.logger.warn(
            `Could not remove original catalog photo upload ${file.filename}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      }
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      if (!isAlreadyWebpFile) await unlink(webpPath).catch(() => undefined);
      throw new BadRequestException('The uploaded file is not a valid image');
    }
    const photoUrl = `/uploads/catalog/${webpFilename}`;
    try {
      const result = await this.mutate(
        actor,
        'CATALOG_VERSION_PHOTO_UPDATED',
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
          const updated = await tx.versiones_vehiculos.update({
            where: { id },
            data: { foto_url: photoUrl },
            select: versionSelect,
          });
          return { version: this.toVersion(updated, actor), previousPhotoUrl: current.foto_url };
        },
        id,
      );
      // Best-effort cleanup of the file the new photo replaces. Failure here
      // just leaves an orphaned file on disk - never block the response on it.
      if (result.previousPhotoUrl && result.previousPhotoUrl !== photoUrl) {
        const previousFilename = result.previousPhotoUrl.split('/').pop();
        if (previousFilename) {
          await unlink(join(uploadsDir, previousFilename)).catch((error: unknown) => {
            this.logger.warn(
              `Could not remove previous catalog photo ${previousFilename}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
        }
      }
      return result.version;
    } catch (error) {
      // The conversion already wrote the WebP file to disk by the time
      // validation runs (e.g. version not found, wrong organization) -
      // clean it up so it doesn't linger unreferenced.
      await unlink(webpPath).catch(() => undefined);
      throw error;
    }
  }
  async pricePolicies(query: CatalogQueryDto, actor: AuthenticatedUser) {
    this.assertOrganizationFilter(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const currentOn = toDateOnly(query.currentOn ?? new Date());
    const where: Prisma.politicas_precios_vehiculosWhereInput = {
      organizacion_id: organizationId,
      version_id: query.versionId,
      sucursal_id: query.branchId,
      activa: true,
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
  async effectivePricePolicy(
    query: EffectivePricePolicyQueryDto,
    actor: AuthenticatedUser,
  ) {
    this.assertOrganizationFilter(actor, query.organizationId);
    const organizationId = query.organizationId ?? actor.organization.id;
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      await this.versionAvailableOr400(tx, query.versionId, organizationId);
      await this.branchOr400(tx, query.branchId, organizationId);
      const policy = await findEffectivePricePolicy(tx, {
        versionId: query.versionId,
        branchId: query.branchId,
        organizationId,
        at: query.currentOn ?? new Date(),
      });
      if (!policy)
        throw activePricePolicyRequired(query.versionId, query.branchId);
      return this.toPricePolicy(
        await tx.politicas_precios_vehiculos.findUniqueOrThrow({
          where: { id: policy.id },
          include: pricePolicyInclude,
        }),
      );
    });
  }
  async createPricePolicy(
    input: CreatePricePolicyDto,
    actor: AuthenticatedUser,
  ) {
    this.assertOrganizationSelection(actor, input.organizationId);
    if (input.minimumPrice > input.listPrice)
      throw new BadRequestException('Minimum price cannot exceed list price');
    const organizationId = input.organizationId ?? actor.organization.id;
    const validFrom = toDateOnly(input.validFrom);
    const validUntil = input.validUntil ? toDateOnly(input.validUntil) : null;
    if (validUntil && validUntil < validFrom)
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
        const policyScope = input.branchId ?? 'ORGANIZATION';
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${input.versionId}:${policyScope}`}, 0))`;
        const overlapping = await tx.politicas_precios_vehiculos.findMany({
          where: {
            organizacion_id: organizationId,
            version_id: input.versionId,
            sucursal_id: input.branchId ?? null,
            activa: true,
            vigente_desde: validUntil ? { lte: validUntil } : undefined,
            OR: [
              { vigente_hasta: null },
              { vigente_hasta: { gte: validFrom } },
            ],
          },
          orderBy: [{ vigente_desde: 'asc' }, { creado_en: 'asc' }],
        });
        for (const policy of overlapping) {
          const policyStart = toDateOnly(policy.vigente_desde);
          if (policyStart > validFrom)
            throw new ConflictException(
              'Price policy overlaps a future policy; choose a non-overlapping validity range',
            );
          if (policyStart.getTime() === validFrom.getTime()) {
            await tx.politicas_precios_vehiculos.update({
              where: { id: policy.id },
              data: { activa: false, desactivada_en: new Date() },
            });
          } else {
            await tx.politicas_precios_vehiculos.update({
              where: { id: policy.id },
              data: { vigente_hasta: previousDate(validFrom) },
            });
          }
        }
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
              activa: true,
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
    if (
      organizationId &&
      organizationId !== actor.organization.id &&
      !actor.globalAccess
    )
      throw new ForbiddenException(
        'Only users with global access can filter by organization',
      );
  }
  private assertOrganizationSelection(
    actor: AuthenticatedUser,
    organizationId?: string,
  ) {
    if (
      organizationId &&
      organizationId !== actor.organization.id &&
      !actor.globalAccess
    )
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
    actor: AuthenticatedUser,
  ) {
    const canSeeOrganization = (organizationId: string | null) =>
      actor.globalAccess || organizationId === actor.organization.id;
    return {
      id: item.id,
      name: item.nombre,
      marker: item.es_marcador,
      active: item.activo,
      scope: item.alcance,
      ownerOrganizationId: canSeeOrganization(item.organizacion_propietaria_id)
        ? item.organizacion_propietaria_id
        : null,
      sellableOrganizationIds: item.catalogo_organizaciones
        .map((row) => row.organizacion_id)
        .filter(canSeeOrganization),
      photoUrl: item.foto_url,
      // Sensitive margin figure: the costPrice key itself must not exist in
      // the response body for an actor without catalogo.costos.consultar -
      // never send it as null, so nothing about it can be inferred from the
      // network payload.
      ...(this.canViewCosts(actor)
        ? { costPrice: item.precio_costo?.toString() ?? null }
        : {}),
      model: this.toModel(item.modelos_vehiculos),
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
    };
  }
  private canViewCosts(actor: AuthenticatedUser) {
    return actor.role.permissions.includes(PERMISSION_CODES.CATALOG_COST_READ);
  }
  private canManageCosts(actor: AuthenticatedUser) {
    return actor.role.permissions.includes(
      PERMISSION_CODES.CATALOG_COST_MANAGE,
    );
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
      active: item.activa,
      deactivatedAt: item.desactivada_en,
      scope: item.sucursal_id ? 'BRANCH' : 'ORGANIZATION',
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

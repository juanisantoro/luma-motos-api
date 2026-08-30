import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CatalogService } from '../catalog/catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AvailabilityQueryDto,
  CreateCatalogAvailabilityDto,
  SupplierInputDto,
  SupplierQueryDto,
  UpdateSupplierDto,
  UpsertAvailabilityDto,
} from './suppliers.dto';

const supplierSelect = {
  id: true,
  razon_social: true,
  identificacion_fiscal: true,
  direccion: true,
  nombre_contacto: true,
  telefono: true,
  notas: true,
  activo: true,
  organizacion_id: true,
  creado_en: true,
  actualizado_en: true,
} satisfies Prisma.proveedoresSelect;
const availabilityInclude = {
  proveedores: true,
  versiones_vehiculos: {
    include: {
      modelos_vehiculos: { include: { marcas_vehiculos: true } },
    },
  },
} satisfies Prisma.disponibilidad_proveedorInclude;
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
  ) {}
  async findAll(query: SupplierQueryDto, actor: AuthenticatedUser) {
    this.assertOrg(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const search = query.search?.trim();
    const normalized = search ? this.normalName(search) : undefined;
    const where: Prisma.proveedoresWhereInput = {
      organizacion_id: organizationId,
      activo: query.active,
      OR: normalized
        ? [
            {
              nombre_normalizado: { contains: normalized, mode: 'insensitive' },
            },
            {
              identificacion_fiscal: {
                contains: search,
                mode: 'insensitive',
              },
            },
          ]
        : undefined,
    };
    const [total, items] = await this.prisma.withTenant(
      this.scope(actor),
      (tx) =>
        Promise.all([
          tx.proveedores.count({ where }),
          tx.proveedores.findMany({
            where,
            select: supplierSelect,
            orderBy: { nombre_normalizado: 'asc' },
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
        ]),
    );
    return {
      items: items.map((item) => this.supplier(item)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
  async findOne(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(this.scope(actor), async (tx) =>
      this.supplier(await this.supplierOr404(tx, id, actor)),
    );
  }
  async create(input: SupplierInputDto, actor: AuthenticatedUser) {
    this.assertOrg(actor, input.organizationId);
    const organizationId = input.organizationId ?? actor.organization.id;
    return this.mutate(
      actor,
      'SUPPLIER_CREATED',
      'proveedores',
      async (tx) =>
        this.supplier(
          await tx.proveedores.create({
            data: this.createSupplierData(input, organizationId),
            select: supplierSelect,
          }),
        ),
      undefined,
      organizationId,
    );
  }
  async update(id: string, input: UpdateSupplierDto, actor: AuthenticatedUser) {
    if (Object.keys(input).length === 0)
      throw new BadRequestException('At least one editable field is required');
    return this.mutate(
      actor,
      'SUPPLIER_UPDATED',
      'proveedores',
      async (tx, event) => {
        const current = await this.supplierOr404(tx, id, actor);
        event.targetOrganizationId = this.targetOrganization(
          actor,
          current.organizacion_id,
        );
        return this.supplier(
          await tx.proveedores.update({
            where: {
              id_organizacion_id: {
                id,
                organizacion_id: current.organizacion_id,
              },
            },
            data: this.updateSupplierData(input),
            select: supplierSelect,
          }),
        );
      },
      id,
    );
  }
  async availability(query: AvailabilityQueryDto, actor: AuthenticatedUser) {
    this.assertOrg(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const now = new Date();
    const where: Prisma.disponibilidad_proveedorWhereInput = {
      organizacion_id: organizationId,
      proveedor_id: query.supplierId,
      version_id: query.versionId,
      condicion: query.condition,
      OR: query.includeExpired
        ? undefined
        : [{ vence_en: null }, { vence_en: { gte: now } }],
      versiones_vehiculos: query.vehicleType
        ? { modelos_vehiculos: { tipo_vehiculo: query.vehicleType } }
        : undefined,
    };
    const [total, items] = await this.prisma.withTenant(
      this.scope(actor),
      (tx) =>
        Promise.all([
          tx.disponibilidad_proveedor.count({ where }),
          tx.disponibilidad_proveedor.findMany({
            where,
            include: availabilityInclude,
            orderBy: { informado_en: 'desc' },
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
        ]),
    );
    return {
      items: items.map((item) => this.availabilityResponse(item, now)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
  async upsertAvailability(
    input: UpsertAvailabilityDto,
    actor: AuthenticatedUser,
  ) {
    this.assertOrg(actor, input.organizationId);
    const organizationId = input.organizationId ?? actor.organization.id;
    const reportedAt = input.reportedAt
      ? new Date(input.reportedAt)
      : new Date();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= reportedAt)
      throw new BadRequestException('Expiry must be after report time');
    return this.mutate(
      actor,
      'SUPPLIER_AVAILABILITY_UPSERTED',
      'disponibilidad_proveedor',
      async (tx) => {
        await this.supplierOr400(tx, input.supplierId, organizationId);
        await this.versionOr400(tx, input.versionId, organizationId);
        return this.availabilityResponse(
          await tx.disponibilidad_proveedor.upsert({
            where: {
              proveedor_id_version_id_condicion: {
                proveedor_id: input.supplierId,
                version_id: input.versionId,
                condicion: input.condition,
              },
            },
            create: {
              proveedor_id: input.supplierId,
              version_id: input.versionId,
              condicion: input.condition,
              cantidad_informada: input.reportedQuantity,
              informado_en: reportedAt,
              vence_en: expiresAt,
              notas: input.notes,
              organizacion_id: organizationId,
            },
            update: {
              cantidad_informada: input.reportedQuantity,
              informado_en: reportedAt,
              vence_en: expiresAt,
              notas: input.notes,
            },
            include: availabilityInclude,
          }),
          new Date(),
        );
      },
      undefined,
      organizationId,
    );
  }
  async createCatalogAvailability(
    input: CreateCatalogAvailabilityDto,
    actor: AuthenticatedUser,
  ) {
    this.assertOrg(actor, input.organizationId);
    const organizationId = input.organizationId ?? actor.organization.id;
    const reportedAt = input.reportedAt
      ? new Date(input.reportedAt)
      : new Date();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= reportedAt)
      throw new BadRequestException('Expiry must be after report time');
    return this.mutate(
      actor,
      'CATALOG_POLICY_AVAILABILITY_CREATED',
      'disponibilidad_proveedor',
      async (tx) => {
        await this.supplierOr400(tx, input.supplierId, organizationId);
        const personalId = await this.personalId(tx, actor, organizationId);
        const { brand, model, version, policy, pricePolicyCreated } =
          await this.catalog.provisionVersionWithPolicy(
            tx,
            input,
            organizationId,
            personalId,
            actor.globalAccess,
          );
        const availability = await tx.disponibilidad_proveedor.upsert({
          where: {
            proveedor_id_version_id_condicion: {
              proveedor_id: input.supplierId,
              version_id: version.id,
              condicion: input.condition,
            },
          },
          create: {
            proveedor_id: input.supplierId,
            version_id: version.id,
            condicion: input.condition,
            cantidad_informada: input.reportedQuantity,
            informado_en: reportedAt,
            vence_en: expiresAt,
            notas: input.notes,
            organizacion_id: organizationId,
          },
          update: {
            cantidad_informada: input.reportedQuantity,
            informado_en: reportedAt,
            vence_en: expiresAt,
            notas: input.notes,
          },
          include: availabilityInclude,
        });
        return {
          catalog: {
            brand: { id: brand.id, name: brand.nombre },
            model: { id: model.id, name: model.nombre },
            version: { id: version.id, name: version.nombre },
          },
          pricePolicy: {
            id: policy.id,
            currency: policy.moneda,
            listPrice: policy.precio_lista.toString(),
            minimumPrice: policy.precio_minimo.toString(),
            validFrom: policy.vigente_desde,
            created: pricePolicyCreated,
          },
          availability: this.availabilityResponse(availability, new Date()),
        };
      },
      undefined,
      organizationId,
    );
  }
  private createSupplierData(
    input: SupplierInputDto,
    organizationId: string,
  ): Prisma.proveedoresUncheckedCreateInput {
    return {
      razon_social: input.legalName.trim(),
      nombre_normalizado: this.normalName(input.legalName),
      identificacion_fiscal: input.taxId,
      direccion: input.address,
      nombre_contacto: input.contactName,
      telefono: input.phone,
      notas: input.notes,
      activo: input.active,
      organizacion_id: organizationId,
    };
  }
  private updateSupplierData(
    input: UpdateSupplierDto,
  ): Prisma.proveedoresUncheckedUpdateInput {
    return {
      razon_social: input.legalName?.trim(),
      nombre_normalizado: input.legalName
        ? this.normalName(input.legalName)
        : undefined,
      identificacion_fiscal: input.taxId,
      direccion: input.address,
      nombre_contacto: input.contactName,
      telefono: input.phone,
      notas: input.notes,
      activo: input.active,
    };
  }
  private async supplierOr404(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
  ) {
    const row = await tx.proveedores.findFirst({
      where: {
        id,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
      },
      select: supplierSelect,
    });
    if (!row) throw new NotFoundException('Supplier not found');
    return row;
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
          (value) => value.organizacion_id === organizationId,
        ))
    )
      throw new BadRequestException(
        'Version is not available to the organization',
      );
  }
  private supplier(
    item: Prisma.proveedoresGetPayload<{ select: typeof supplierSelect }>,
  ) {
    return {
      id: item.id,
      legalName: item.razon_social,
      taxId: item.identificacion_fiscal,
      address: item.direccion,
      contactName: item.nombre_contacto,
      phone: item.telefono,
      notes: item.notas,
      active: item.activo,
      organizationId: item.organizacion_id,
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
    };
  }
  private availabilityResponse(
    item: Prisma.disponibilidad_proveedorGetPayload<{
      include: typeof availabilityInclude;
    }>,
    now: Date,
  ) {
    return {
      id: item.id,
      supplierId: item.proveedor_id,
      versionId: item.version_id,
      organizationId: item.organizacion_id,
      condition: item.condicion,
      reportedQuantity: item.cantidad_informada,
      reportedAt: item.informado_en,
      expiresAt: item.vence_en,
      expired: item.vence_en !== null && item.vence_en < now,
      notes: item.notas,
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
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
    };
  }
  private normalName(value: string) {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-AR');
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
  private assertOrg(actor: AuthenticatedUser, organizationId?: string) {
    if (
      organizationId &&
      organizationId !== actor.organization.id &&
      !actor.globalAccess
    )
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
            'A supplier with that name already exists',
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
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CashService } from '../cash/cash.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateVehiclePaymentCatalogEntryDto,
  CreateVehiclePaymentDto,
  UpdateVehiclePaymentDto,
  VehiclePaymentQueryDto,
} from './vehicle-payments.dto';

type CatalogRow = { id: string; nombre: string };

type VehiclePaymentRow = {
  id: string;
  fecha: Date;
  estado: string;
  observaciones: string | null;
  creado_en: Date;
  actualizado_en: Date;
  concepto_id: string;
  concepto_nombre: string;
  proveedor_id: string;
  proveedor_nombre: string;
  importe: Prisma.Decimal;
  unidad_vehiculo_id: string;
  vin_mostrado: string;
  patente: string | null;
  version_id: string;
  version_nombre: string;
  modelo_nombre: string;
  marca_nombre: string;
  tipo_vehiculo: string;
  operacion_id: string | null;
  numero_operacion: bigint | null;
};

function parseBusinessDate(value: string): Date {
  const result = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(result.getTime()) ||
    result.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('Invalid business date');
  }
  return result;
}

@Injectable()
export class VehiclePaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
  ) {}

  private assertOrganization(actor: AuthenticatedUser, organizationId?: string) {
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

  private normalizeName(value: string) {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-AR');
  }

  private mapCatalog(rows: CatalogRow[]) {
    return rows.map((row) => ({ id: row.id, name: row.nombre }));
  }

  async concepts(): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.prisma.$queryRaw<CatalogRow[]>(
      Prisma.sql`SELECT id, nombre FROM conceptos_pago_vehiculo WHERE activo = true ORDER BY nombre ASC`,
    );
    return this.mapCatalog(rows);
  }

  async providers(): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.prisma.$queryRaw<CatalogRow[]>(
      Prisma.sql`SELECT id, nombre FROM proveedores_pago_vehiculo WHERE activo = true ORDER BY nombre ASC`,
    );
    return this.mapCatalog(rows);
  }

  async addConcept(input: CreateVehiclePaymentCatalogEntryDto) {
    return this.addCatalogEntry('conceptos_pago_vehiculo', input.name);
  }

  async addProvider(input: CreateVehiclePaymentCatalogEntryDto) {
    return this.addCatalogEntry('proveedores_pago_vehiculo', input.name);
  }

  private async addCatalogEntry(table: 'conceptos_pago_vehiculo' | 'proveedores_pago_vehiculo', name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Name is required');
    const normalized = this.normalizeName(trimmed);
    const existing = await this.prisma.$queryRaw<CatalogRow[]>(
      Prisma.sql`SELECT id, nombre FROM ${Prisma.raw(`"${table}"`)} WHERE nombre_normalizado = ${normalized}`,
    );
    if (existing[0]) throw new ConflictException('That value already exists');
    const created = await this.prisma.$queryRaw<CatalogRow[]>(
      Prisma.sql`INSERT INTO ${Prisma.raw(`"${table}"`)} (nombre, nombre_normalizado)
        VALUES (${trimmed}, ${normalized})
        RETURNING id, nombre`,
    );
    return { id: created[0].id, name: created[0].nombre };
  }

  private joinedSelect() {
    return Prisma.sql`
      SELECT
        p.id, p.fecha, p.estado, p.observaciones, p.creado_en, p.actualizado_en,
        p.concepto_id, c.nombre AS concepto_nombre,
        p.proveedor_id, b.nombre AS proveedor_nombre, p.importe,
        p.unidad_vehiculo_id, u.vin_mostrado, u.patente, u.version_id,
        v.nombre AS version_nombre, m.nombre AS modelo_nombre,
        mk.nombre AS marca_nombre, m.tipo_vehiculo,
        p.operacion_id, o.numero_operacion
      FROM pagos_vehiculo p
      JOIN conceptos_pago_vehiculo c ON c.id = p.concepto_id
      JOIN proveedores_pago_vehiculo b ON b.id = p.proveedor_id
      JOIN unidades_vehiculos u ON u.id = p.unidad_vehiculo_id
      JOIN versiones_vehiculos v ON v.id = u.version_id
      JOIN modelos_vehiculos m ON m.id = v.modelo_id
      JOIN marcas_vehiculos mk ON mk.id = m.marca_id
      LEFT JOIN operaciones o ON o.id = p.operacion_id
    `;
  }

  private mapRow(row: VehiclePaymentRow) {
    return {
      id: row.id,
      date: row.fecha.toISOString().slice(0, 10),
      status: row.estado as 'PENDIENTE' | 'PAGADO',
      month: row.fecha.getUTCMonth() + 1,
      year: row.fecha.getUTCFullYear(),
      notes: row.observaciones,
      concept: { id: row.concepto_id, name: row.concepto_nombre },
      provider: { id: row.proveedor_id, name: row.proveedor_nombre },
      amount: Number(row.importe),
      unit: {
        id: row.unidad_vehiculo_id,
        vin: row.vin_mostrado,
        licensePlate: row.patente,
      },
      vehicle: {
        vehicleType: row.tipo_vehiculo,
        brand: row.marca_nombre,
        model: row.modelo_nombre,
        version: row.version_nombre,
      },
      operation: row.operacion_id
        ? { id: row.operacion_id, number: row.numero_operacion?.toString() ?? '' }
        : null,
      createdAt: row.creado_en.toISOString(),
      updatedAt: row.actualizado_en.toISOString(),
    };
  }

  // Dashboard support: count of vehicle-documentation payments still
  // PENDIENTE for units belonging to one branch, plus how many of those
  // have been pending for more than 5 days. pagos_vehiculo has no
  // sucursal_id of its own, so this joins through the unit's branch -
  // same join shape as joinedSelect() above, just without the catalog
  // joins this doesn't need.
  async unconfirmedSummary(actor: AuthenticatedUser, branchId: string) {
    const rows = await this.prisma.withTenant(this.scope(actor), (tx) =>
      tx.$queryRaw<Array<{ count: bigint; stale_count: bigint }>>(Prisma.sql`
        SELECT
          COUNT(*)::bigint AS count,
          COUNT(*) FILTER (WHERE p.fecha <= CURRENT_DATE - INTERVAL '5 days')::bigint AS stale_count
        FROM pagos_vehiculo p
        JOIN unidades_vehiculos u ON u.id = p.unidad_vehiculo_id
        WHERE p.organizacion_id = ${actor.organization.id}::uuid
          AND u.sucursal_id = ${branchId}::uuid
          AND p.estado = 'PENDIENTE'
      `),
    );
    return {
      count: Number(rows[0]?.count ?? 0),
      staleCount: Number(rows[0]?.stale_count ?? 0),
    };
  }

  async findAll(query: VehiclePaymentQueryDto, actor: AuthenticatedUser) {
    this.assertOrganization(actor, query.organizationId);
    const organizationId =
      query.organizationId ?? (actor.globalAccess ? undefined : actor.organization.id);
    const search = query.search?.trim();

    const conditions: Prisma.Sql[] = [
      Prisma.sql`m.tipo_vehiculo = ${query.vehicleType}::tipo_vehiculo_luma`,
    ];
    if (organizationId) conditions.push(Prisma.sql`p.organizacion_id = ${organizationId}::uuid`);
    if (query.conceptId) conditions.push(Prisma.sql`p.concepto_id = ${query.conceptId}::uuid`);
    if (query.providerId) conditions.push(Prisma.sql`p.proveedor_id = ${query.providerId}::uuid`);
    if (query.status) conditions.push(Prisma.sql`p.estado = ${query.status}`);
    if (query.month) conditions.push(Prisma.sql`EXTRACT(MONTH FROM p.fecha) = ${query.month}`);
    if (query.year) conditions.push(Prisma.sql`EXTRACT(YEAR FROM p.fecha) = ${query.year}`);
    if (search) {
      conditions.push(Prisma.sql`(
        u.vin_mostrado ILIKE ${`%${search}%`}
        OR u.patente ILIKE ${`%${search}%`}
        OR mk.nombre ILIKE ${`%${search}%`}
        OR m.nombre ILIKE ${`%${search}%`}
        OR v.nombre ILIKE ${`%${search}%`}
        OR o.numero_operacion::text ILIKE ${`%${search}%`}
      )`);
    }
    const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const rows = await this.prisma.withTenant(this.scope(actor), (tx) =>
      tx.$queryRaw<VehiclePaymentRow[]>(Prisma.sql`
        ${this.joinedSelect()}
        ${where}
        ORDER BY p.fecha DESC, p.creado_en DESC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
      `),
    );
    const [{ count }] = await this.prisma.withTenant(this.scope(actor), (tx) =>
      tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM pagos_vehiculo p
        JOIN unidades_vehiculos u ON u.id = p.unidad_vehiculo_id
        JOIN versiones_vehiculos v ON v.id = u.version_id
        JOIN modelos_vehiculos m ON m.id = v.modelo_id
        JOIN marcas_vehiculos mk ON mk.id = m.marca_id
        LEFT JOIN operaciones o ON o.id = p.operacion_id
        ${where}
      `),
    );
    return {
      items: rows.map((row) => this.mapRow(row)),
      total: Number(count),
      page: query.page,
      limit: query.limit,
    };
  }

  async create(input: CreateVehiclePaymentDto, actor: AuthenticatedUser) {
    this.assertOrganization(actor, input.organizationId);
    const organizationId = input.organizationId ?? actor.organization.id;
    const event: AuthenticatedAuditEvent = {
      action: 'VEHICLE_PAYMENT_CREATED',
      entity: 'pagos_vehiculo',
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId: organizationId,
    };
    return this.audit.execute(event, async (tx) => {
      const personnelId = await this.cash.actorPersonnelId(tx, actor, organizationId);
      await this.assertConceptActive(tx, input.conceptId);
      await this.assertProviderActive(tx, input.providerId);
      const unit = await tx.unidades_vehiculos.findFirst({
        where: { id: input.unitId, organizacion_id: organizationId },
        select: { id: true },
      });
      if (!unit) throw new BadRequestException('Vehicle unit not found');
      if (input.operationId) {
        const operation = await tx.operaciones.findFirst({
          where: { id: input.operationId, organizacion_id: organizationId },
          select: { id: true },
        });
        if (!operation) throw new BadRequestException('Sales operation not found');
      }
      const fecha = parseBusinessDate(input.paymentDate);
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        INSERT INTO pagos_vehiculo (
          organizacion_id, concepto_id, unidad_vehiculo_id, operacion_id,
          proveedor_id, importe, estado, fecha, observaciones, creado_por_personal_id
        ) VALUES (
          ${organizationId}::uuid, ${input.conceptId}::uuid, ${input.unitId}::uuid,
          ${input.operationId ?? null}::uuid, ${input.providerId}::uuid, ${input.amount}::numeric,
          ${input.status ?? 'PENDIENTE'}, ${fecha}, ${input.notes?.trim() ?? null},
          ${personnelId}::uuid
        )
        RETURNING id
      `);
      event.entityId = rows[0].id;
      return this.detail(tx, rows[0].id);
    });
  }

  async update(id: string, input: UpdateVehiclePaymentDto, actor: AuthenticatedUser) {
    if (!Object.keys(input).length)
      throw new BadRequestException('At least one editable field is required');
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const current = await tx.$queryRaw<Array<{ organizacion_id: string }>>(Prisma.sql`
        SELECT organizacion_id FROM pagos_vehiculo
        WHERE id = ${id}::uuid
        AND (${actor.globalAccess} OR organizacion_id = ${actor.organization.id}::uuid)
      `);
      if (!current[0]) throw new NotFoundException('Vehicle payment not found');
      const organizationId = current[0].organizacion_id;

      if (input.conceptId) await this.assertConceptActive(tx, input.conceptId);
      if (input.providerId) await this.assertProviderActive(tx, input.providerId);
      if (input.operationId) {
        const operation = await tx.operaciones.findFirst({
          where: { id: input.operationId, organizacion_id: organizationId },
          select: { id: true },
        });
        if (!operation) throw new BadRequestException('Sales operation not found');
      }

      const event: AuthenticatedAuditEvent = {
        action: 'VEHICLE_PAYMENT_UPDATED',
        entity: 'pagos_vehiculo',
        entityId: id,
        actorId: actor.id,
        organizationId: actor.organization.id,
        globalAccess: actor.globalAccess,
        targetOrganizationId: organizationId,
      };
      await this.audit.record(event, tx);

      await tx.$executeRaw(Prisma.sql`
        UPDATE pagos_vehiculo SET
          concepto_id = COALESCE(${input.conceptId ?? null}::uuid, concepto_id),
          operacion_id = ${input.operationId === undefined ? Prisma.sql`operacion_id` : Prisma.sql`${input.operationId}::uuid`},
          proveedor_id = COALESCE(${input.providerId ?? null}::uuid, proveedor_id),
          importe = COALESCE(${input.amount ?? null}::numeric, importe),
          estado = COALESCE(${input.status ?? null}, estado),
          fecha = COALESCE(${input.paymentDate ? parseBusinessDate(input.paymentDate) : null}, fecha),
          observaciones = ${input.notes === undefined ? Prisma.sql`observaciones` : Prisma.sql`${input.notes?.trim() || null}`}
        WHERE id = ${id}::uuid
      `);
      return this.detail(tx, id);
    });
  }

  private async detail(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<VehiclePaymentRow[]>(Prisma.sql`
      ${this.joinedSelect()}
      WHERE p.id = ${id}::uuid
    `);
    if (!rows[0]) throw new NotFoundException('Vehicle payment not found');
    return this.mapRow(rows[0]);
  }

  private async assertConceptActive(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS(SELECT 1 FROM conceptos_pago_vehiculo WHERE id = ${id}::uuid AND activo = true) AS "exists"
    `);
    if (!rows[0]?.exists) throw new BadRequestException('Invalid or inactive concept');
  }

  private async assertProviderActive(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS(SELECT 1 FROM proveedores_pago_vehiculo WHERE id = ${id}::uuid AND activo = true) AS "exists"
    `);
    if (!rows[0]?.exists) throw new BadRequestException('Invalid or inactive provider');
  }
}

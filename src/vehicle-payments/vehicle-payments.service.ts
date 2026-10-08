import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  direccion_caja_luma,
  luma_estado_operacion,
  Prisma,
  tipo_movimiento_caja_luma,
  tipo_vehiculo_luma,
} from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BranchScope } from '../branch-scope/branch-scope';
import { CashService } from '../cash/cash.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  argentinaToday,
  isLicensingOverdue,
  isPlateReceived,
  LICENSING_INCOME_TYPE,
  LicensingMode,
  licensingPlateStatus,
} from '../sales/licensing';
import {
  CreateVehiclePaymentCatalogEntryDto,
  CreateVehiclePaymentDto,
  UpdateVehiclePaymentDto,
  VehiclePaymentQueryDto,
} from './vehicle-payments.dto';

type CatalogRow = { id: string; nombre: string };

// Rol cuyas cajas pueden pagar gastos de vehículos. Además, cada uno sólo
// puede pagar (y devolver) desde sus propias cajas.
const PAYER_ROLE = 'ADMINISTRADOR';

type AccountRow = {
  id: string;
  nombre: string;
  moneda: string;
  sucursal_id: string | null;
  responsable_nombre: string | null;
  propia: boolean;
};

type ExpenseState = {
  organizacion_id: string;
  estado: string;
  importe: Prisma.Decimal;
  fecha: Date;
  cuenta_caja_id: string | null;
  movimiento_caja_id: string | null;
  moneda: string;
  concepto_nombre: string;
  tipo_vehiculo: tipo_vehiculo_luma;
};

type VehiclePaymentRow = {
  id: string;
  fecha: Date;
  estado: string;
  observaciones: string | null;
  creado_en: Date;
  actualizado_en: Date;
  concepto_id: string;
  concepto_nombre: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  importe: Prisma.Decimal;
  moneda: string;
  unidad_vehiculo_id: string | null;
  vin_mostrado: string | null;
  patente: string | null;
  version_id: string | null;
  version_nombre: string | null;
  modelo_nombre: string | null;
  marca_nombre: string | null;
  tipo_vehiculo: string;
  sucursal_id: string;
  sucursal_nombre: string;
  cuenta_caja_id: string | null;
  cuenta_nombre: string | null;
  cuenta_responsable: string | null;
  operacion_id: string | null;
  numero_operacion: bigint | null;
  numero_boleto: string | null;
  estado_operacion: luma_estado_operacion | null;
  modalidad_patentamiento: LicensingMode | null;
  patente_estimada_desde: Date | null;
  patente_estimada_hasta: Date | null;
  patente_recibida_en: Date | null;
  operacion_patente: string | null;
  cobro_patente_cubierto: boolean | null;
};

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

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

  private assertOrganization(
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

  private async addCatalogEntry(
    table: 'conceptos_pago_vehiculo' | 'proveedores_pago_vehiculo',
    name: string,
  ) {
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
        p.proveedor_id, b.nombre AS proveedor_nombre, p.importe, p.moneda,
        p.unidad_vehiculo_id, u.vin_mostrado, u.patente, u.version_id,
        v.nombre AS version_nombre, m.nombre AS modelo_nombre,
        mk.nombre AS marca_nombre, p.tipo_vehiculo,
        p.sucursal_id, s.nombre AS sucursal_nombre,
        p.cuenta_caja_id, cc.nombre AS cuenta_nombre,
        resp.nombre_completo AS cuenta_responsable,
        p.operacion_id, o.numero_operacion, o.numero_boleto,
        o.estado_operacion, o.modalidad_patentamiento,
        o.patente_estimada_desde, o.patente_estimada_hasta,
        o.patente_recibida_en, ou.patente AS operacion_patente,
        (
          o.id IS NOT NULL
          AND lc.total > 0 AND lc.open = 0
          AND (o.importe_patentamiento IS NULL OR lc.paid >= o.importe_patentamiento)
        ) AS cobro_patente_cubierto
      ${this.joins()}
      LEFT JOIN unidades_vehiculos ou
        ON ou.id = o.unidad_vehiculo_id AND ou.organizacion_id = o.organizacion_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE i.estado_registro <> 'PAGADO') AS open,
          COALESCE(SUM(i.importe) FILTER (WHERE i.estado_registro = 'PAGADO'), 0) AS paid
        FROM ingresos i
        WHERE i.operacion_id = o.id
          AND i.organizacion_id = o.organizacion_id
          AND lower(i.tipo_original) = ${LICENSING_INCOME_TYPE}
          AND i.estado_registro <> 'ANULADO'
      ) lc ON TRUE
    `;
  }

  // Proveedor, unidad y caja son opcionales: todo LEFT JOIN salvo concepto y
  // sucursal. Lo comparten el listado y su conteo.
  private joins() {
    return Prisma.sql`
      FROM pagos_vehiculo p
      JOIN conceptos_pago_vehiculo c ON c.id = p.concepto_id
      JOIN sucursales s ON s.id = p.sucursal_id
      LEFT JOIN proveedores_pago_vehiculo b ON b.id = p.proveedor_id
      LEFT JOIN unidades_vehiculos u ON u.id = p.unidad_vehiculo_id
      LEFT JOIN versiones_vehiculos v ON v.id = u.version_id
      LEFT JOIN modelos_vehiculos m ON m.id = v.modelo_id
      LEFT JOIN marcas_vehiculos mk ON mk.id = m.marca_id
      LEFT JOIN cuentas_caja cc ON cc.id = p.cuenta_caja_id
      LEFT JOIN personal resp ON resp.id = cc.personal_responsable_id
      LEFT JOIN operaciones o ON o.id = p.operacion_id
    `;
  }

  // Fase 5: patent situation of the linked operation, same rules as
  // licensing.plate in sales operations.
  private operationLicensing(row: VehiclePaymentRow, today: Date) {
    if (!row.operacion_id || !row.estado_operacion) return null;
    const plateReceived = isPlateReceived({
      receivedAt: row.patente_recibida_en,
      unitPlate: row.operacion_patente,
    });
    const overdue = isLicensingOverdue({
      status: row.estado_operacion,
      estimatedTo: row.patente_estimada_hasta,
      plateReceived,
      today,
    });
    return {
      mode: row.modalidad_patentamiento,
      estimatedFrom: dateOnly(row.patente_estimada_desde),
      estimatedTo: dateOnly(row.patente_estimada_hasta),
      overdue,
      plate: {
        status: licensingPlateStatus({
          mode: row.modalidad_patentamiento,
          operationStatus: row.estado_operacion,
          plateReceived,
          overdue,
          collectionCovered: row.cobro_patente_cubierto === true,
        }),
        number: row.operacion_patente,
        receivedAt: dateOnly(row.patente_recibida_en),
      },
    };
  }

  private mapRow(row: VehiclePaymentRow, today = argentinaToday()) {
    return {
      id: row.id,
      date: row.fecha.toISOString().slice(0, 10),
      status: row.estado as 'PENDIENTE' | 'PAGADO',
      month: row.fecha.getUTCMonth() + 1,
      year: row.fecha.getUTCFullYear(),
      notes: row.observaciones,
      concept: { id: row.concepto_id, name: row.concepto_nombre },
      provider:
        row.proveedor_id && row.proveedor_nombre
          ? { id: row.proveedor_id, name: row.proveedor_nombre }
          : null,
      amount: Number(row.importe),
      currency: row.moneda.trim(),
      vehicleType: row.tipo_vehiculo,
      branch: { id: row.sucursal_id, name: row.sucursal_nombre },
      account:
        row.cuenta_caja_id && row.cuenta_nombre
          ? {
              id: row.cuenta_caja_id,
              name: row.cuenta_nombre,
              responsible: row.cuenta_responsable,
            }
          : null,
      unit: row.unidad_vehiculo_id
        ? {
            id: row.unidad_vehiculo_id,
            vin: row.vin_mostrado ?? '',
            licensePlate: row.patente,
          }
        : null,
      vehicle: row.unidad_vehiculo_id
        ? {
            vehicleType: row.tipo_vehiculo,
            brand: row.marca_nombre ?? '',
            model: row.modelo_nombre ?? '',
            version: row.version_nombre ?? '',
          }
        : null,
      operation: row.operacion_id
        ? {
            id: row.operacion_id,
            number: row.numero_operacion?.toString() ?? '',
            ticketNumber: row.numero_boleto,
            licensing: this.operationLicensing(row, today),
          }
        : null,
      createdAt: row.creado_en.toISOString(),
      updatedAt: row.actualizado_en.toISOString(),
    };
  }

  // Dashboard support: count of vehicle expenses still PENDIENTE in the
  // actor's branch scope, plus how many of those have been pending for more
  // than 5 days.
  async unconfirmedSummary(actor: AuthenticatedUser, branches: BranchScope) {
    const rows = await this.prisma.withTenant(this.scope(actor), (tx) =>
      tx.$queryRaw<Array<{ count: bigint; stale_count: bigint }>>(Prisma.sql`
        SELECT
          COUNT(*)::bigint AS count,
          COUNT(*) FILTER (WHERE p.fecha <= CURRENT_DATE - INTERVAL '5 days')::bigint AS stale_count
        FROM pagos_vehiculo p
        WHERE p.organizacion_id = ${actor.organization.id}::uuid
          AND ${branches.sql(Prisma.sql`p.sucursal_id`)}
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
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const search = query.search?.trim();

    const conditions: Prisma.Sql[] = [
      Prisma.sql`p.tipo_vehiculo = ${query.vehicleType}::tipo_vehiculo_luma`,
    ];
    if (organizationId)
      conditions.push(Prisma.sql`p.organizacion_id = ${organizationId}::uuid`);
    conditions.push(BranchScope.forActor(actor).sql(Prisma.sql`p.sucursal_id`));
    if (query.branchId)
      conditions.push(Prisma.sql`p.sucursal_id = ${query.branchId}::uuid`);
    if (query.accountId)
      conditions.push(Prisma.sql`p.cuenta_caja_id = ${query.accountId}::uuid`);
    if (query.conceptId)
      conditions.push(Prisma.sql`p.concepto_id = ${query.conceptId}::uuid`);
    if (query.providerId)
      conditions.push(Prisma.sql`p.proveedor_id = ${query.providerId}::uuid`);
    if (query.status) conditions.push(Prisma.sql`p.estado = ${query.status}`);
    if (query.month)
      conditions.push(Prisma.sql`EXTRACT(MONTH FROM p.fecha) = ${query.month}`);
    if (query.year)
      conditions.push(Prisma.sql`EXTRACT(YEAR FROM p.fecha) = ${query.year}`);
    if (search) {
      conditions.push(Prisma.sql`(
        u.vin_mostrado ILIKE ${`%${search}%`}
        OR u.patente ILIKE ${`%${search}%`}
        OR mk.nombre ILIKE ${`%${search}%`}
        OR m.nombre ILIKE ${`%${search}%`}
        OR v.nombre ILIKE ${`%${search}%`}
        OR c.nombre ILIKE ${`%${search}%`}
        OR b.nombre ILIKE ${`%${search}%`}
        OR p.observaciones ILIKE ${`%${search}%`}
        OR o.numero_operacion::text ILIKE ${`%${search}%`}
        OR o.numero_boleto ILIKE ${`%${search}%`}
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
        ${this.joins()}
        ${where}
      `),
    );
    const today = argentinaToday();
    return {
      items: rows.map((row) => this.mapRow(row, today)),
      total: Number(count),
      page: query.page,
      limit: query.limit,
    };
  }

  // Cajas de administradores (activas, no importadas, en el alcance del
  // usuario). `own`: es del usuario, así que puede pagar desde ella; las demás
  // sirven para filtrar y mostrar.
  async accounts(actor: AuthenticatedUser) {
    const rows = await this.prisma.withTenant(this.scope(actor), (tx) =>
      this.payerAccounts(tx, actor, actor.organization.id),
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.nombre,
      currency: row.moneda.trim(),
      branchId: row.sucursal_id,
      responsible: row.responsable_nombre,
      own: row.propia,
    }));
  }

  private payerAccounts(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    organizationId: string,
    accountId?: string,
  ) {
    const scope = BranchScope.forActor(actor);
    return tx.$queryRaw<AccountRow[]>(Prisma.sql`
      SELECT cc.id, cc.nombre, cc.moneda, cc.sucursal_id,
        resp.nombre_completo AS responsable_nombre,
        (resp.usuario_id = ${actor.id}::uuid) IS TRUE AS propia
      FROM cuentas_caja cc
      JOIN personal resp ON resp.id = cc.personal_responsable_id
      LEFT JOIN usuarios us ON us.id = resp.usuario_id
      JOIN roles r ON r.id = COALESCE(resp.rol_id, us.rol_id)
      WHERE cc.organizacion_id = ${organizationId}::uuid
        AND cc.activo = true
        AND cc.es_importada = false
        AND r.codigo = ${PAYER_ROLE}
        AND (cc.sucursal_id IS NULL OR ${scope.sql(Prisma.sql`cc.sucursal_id`)})
        ${accountId ? Prisma.sql`AND cc.id = ${accountId}::uuid` : Prisma.empty}
      ORDER BY resp.nombre_completo ASC, cc.nombre ASC
    `);
  }

  // Caja desde la que el usuario puede pagar: una de las suyas.
  private async payerAccount(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    organizationId: string,
    accountId: string,
  ) {
    const [account] = await this.payerAccounts(
      tx,
      actor,
      organizationId,
      accountId,
    );
    if (!account)
      throw new BadRequestException(
        'La caja no existe, no está activa o no es de un administrador',
      );
    if (!account.propia)
      throw new ForbiddenException(
        `Sólo ${account.responsable_nombre ?? 'el dueño de la caja'} puede pagar desde ${account.nombre}.`,
      );
    return account;
  }

  // Devolver plata a una caja también es sólo de su dueño.
  private async assertOwnsAccount(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    accountId: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{ nombre: string; responsable: string | null; propia: boolean }>
    >(Prisma.sql`
      SELECT cc.nombre, resp.nombre_completo AS responsable,
        (resp.usuario_id = ${actor.id}::uuid) IS TRUE AS propia
      FROM cuentas_caja cc
      LEFT JOIN personal resp ON resp.id = cc.personal_responsable_id
      WHERE cc.id = ${accountId}::uuid
    `);
    const account = rows[0];
    if (!account?.propia)
      throw new ForbiddenException(
        `Este gasto se pagó desde ${account?.nombre ?? 'otra caja'}: sólo ${account?.responsable ?? 'su dueño'} puede cambiarlo.`,
      );
  }

  // Débito en la caja de quien paga. AJUSTE porque movimientos_caja no tiene
  // columna de origen para este gasto (el vínculo es pagos_vehiculo.
  // movimiento_caja_id), igual que los retiros de socios.
  private async debit(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      accountId: string;
      amount: Prisma.Decimal;
      date: Date;
      vehicleType: tipo_vehiculo_luma;
      concept: string;
      personnelId: string;
    },
  ) {
    const movement = await tx.movimientos_caja.create({
      data: {
        cuenta_caja_id: input.accountId,
        tipo_movimiento: tipo_movimiento_caja_luma.AJUSTE,
        direccion: direccion_caja_luma.DEBITO,
        importe: input.amount,
        // Mediodía de Argentina: el día contable no cambia por el huso.
        contabilizado_en: new Date(
          `${input.date.toISOString().slice(0, 10)}T12:00:00.000-03:00`,
        ),
        notas: `Gasto de ${input.vehicleType === 'AUTO' ? 'autos' : 'motos'}: ${input.concept}`,
        registrado_por_personal_id: input.personnelId,
        organizacion_id: input.organizationId,
      },
      select: { id: true },
    });
    return movement.id;
  }

  // Devuelve a la caja lo debitado: contramovimiento que apunta al original.
  private async refund(
    tx: Prisma.TransactionClient,
    state: ExpenseState,
    reason: string,
    personnelId: string,
  ) {
    if (!state.movimiento_caja_id || !state.cuenta_caja_id) return;
    await tx.movimientos_caja.create({
      data: {
        cuenta_caja_id: state.cuenta_caja_id,
        tipo_movimiento: tipo_movimiento_caja_luma.INGRESO,
        direccion: direccion_caja_luma.CREDITO,
        importe: state.importe,
        contabilizado_en: new Date(),
        revierte_a_id: state.movimiento_caja_id,
        notas: reason,
        registrado_por_personal_id: personnelId,
        organizacion_id: state.organizacion_id,
      },
    });
  }

  private async conceptName(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Array<{ nombre: string }>>(Prisma.sql`
      SELECT nombre FROM conceptos_pago_vehiculo WHERE id = ${id}::uuid
    `);
    return rows[0]?.nombre ?? '';
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
      const personnelId = await this.cash.actorPersonnelId(
        tx,
        actor,
        organizationId,
      );
      await this.assertConceptActive(tx, input.conceptId);
      if (input.providerId)
        await this.assertProviderActive(tx, input.providerId);
      const scope = BranchScope.forActor(actor);
      let branchId: string;
      if (input.unitId) {
        const unit = await tx.unidades_vehiculos.findFirst({
          where: { id: input.unitId, organizacion_id: organizationId },
          select: {
            sucursal_id: true,
            versiones_vehiculos: {
              select: {
                modelos_vehiculos: { select: { tipo_vehiculo: true } },
              },
            },
          },
        });
        if (!unit) throw new BadRequestException('Vehicle unit not found');
        scope.assert(unit.sucursal_id);
        if (
          unit.versiones_vehiculos.modelos_vehiculos.tipo_vehiculo !==
          input.vehicleType
        )
          throw new BadRequestException(
            input.vehicleType === 'AUTO'
              ? 'La unidad elegida es una moto: cargala en Gastos de motos'
              : 'La unidad elegida es un auto: cargala en Gastos de autos',
          );
        branchId = unit.sucursal_id;
      } else {
        branchId = scope.resolveBranchId(input.branchId);
      }
      if (input.operationId) {
        const operation = await tx.operaciones.findFirst({
          where: { id: input.operationId, organizacion_id: organizationId },
          select: { id: true },
        });
        if (!operation)
          throw new BadRequestException('Sales operation not found');
      }
      // La caja es opcional (por ejemplo, si lo carga alguien sin caja propia).
      const account = input.accountId
        ? await this.payerAccount(tx, actor, organizationId, input.accountId)
        : null;
      const fecha = parseBusinessDate(input.paymentDate);
      const status = input.status ?? 'PENDIENTE';
      const amount = new Prisma.Decimal(input.amount);
      if (status === 'PAGADO' && fecha.getTime() > argentinaToday().getTime())
        throw new BadRequestException(
          'La fecha de pago no puede ser posterior a hoy.',
        );
      const movementId =
        status === 'PAGADO' && account
          ? await this.debit(tx, {
              organizationId,
              accountId: account.id,
              amount,
              date: fecha,
              vehicleType: input.vehicleType,
              concept: await this.conceptName(tx, input.conceptId),
              personnelId,
            })
          : null;
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        INSERT INTO pagos_vehiculo (
          organizacion_id, concepto_id, unidad_vehiculo_id, operacion_id,
          proveedor_id, importe, moneda, estado, fecha, observaciones,
          creado_por_personal_id, sucursal_id, tipo_vehiculo, cuenta_caja_id,
          movimiento_caja_id
        ) VALUES (
          ${organizationId}::uuid, ${input.conceptId}::uuid, ${input.unitId ?? null}::uuid,
          ${input.operationId ?? null}::uuid, ${input.providerId ?? null}::uuid,
          ${amount}::numeric, ${account?.moneda ?? 'ARS'}, ${status}, ${fecha},
          ${input.notes?.trim() || null}, ${personnelId}::uuid, ${branchId}::uuid,
          ${input.vehicleType}::tipo_vehiculo_luma, ${account?.id ?? null}::uuid,
          ${movementId}::uuid
        )
        RETURNING id
      `);
      event.entityId = rows[0].id;
      event.metadata = {
        vehicleType: input.vehicleType,
        amount: amount.toFixed(2),
        currency: account?.moneda.trim() ?? 'ARS',
        account: account?.nombre ?? null,
        status,
      };
      return this.detail(tx, rows[0].id);
    });
  }

  async update(
    id: string,
    input: UpdateVehiclePaymentDto,
    actor: AuthenticatedUser,
  ) {
    if (!Object.keys(input).length)
      throw new BadRequestException('At least one editable field is required');
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      // Bloquea la fila: dos cambios de estado a la vez no deben debitar dos veces.
      const current = await tx.$queryRaw<ExpenseState[]>(Prisma.sql`
        SELECT p.organizacion_id, p.estado, p.importe, p.fecha, p.cuenta_caja_id,
          p.movimiento_caja_id, p.moneda, p.tipo_vehiculo, c.nombre AS concepto_nombre
        FROM pagos_vehiculo p
        JOIN conceptos_pago_vehiculo c ON c.id = p.concepto_id
        WHERE p.id = ${id}::uuid
        AND (${actor.globalAccess} OR p.organizacion_id = ${actor.organization.id}::uuid)
        AND ${BranchScope.forActor(actor).sql(Prisma.sql`p.sucursal_id`)}
        FOR UPDATE OF p
      `);
      const state = current[0];
      if (!state) throw new NotFoundException('Vehicle payment not found');
      const organizationId = state.organizacion_id;

      if (input.conceptId) await this.assertConceptActive(tx, input.conceptId);
      if (input.providerId)
        await this.assertProviderActive(tx, input.providerId);
      if (input.operationId) {
        const operation = await tx.operaciones.findFirst({
          where: { id: input.operationId, organizacion_id: organizationId },
          select: { id: true },
        });
        if (!operation)
          throw new BadRequestException('Sales operation not found');
      }
      const account =
        input.accountId && input.accountId !== state.cuenta_caja_id
          ? await this.payerAccount(tx, actor, organizationId, input.accountId)
          : null;
      const accountId = account?.id ?? state.cuenta_caja_id;

      const status = input.status ?? state.estado;
      const amount =
        input.amount !== undefined
          ? new Prisma.Decimal(input.amount)
          : state.importe;
      const fecha = input.paymentDate
        ? parseBusinessDate(input.paymentDate)
        : state.fecha;
      // Pagado sin caja (cargado así o antes de que existieran las cajas): no
      // se debita después un pago que ya figuraba hecho. Para asignarle caja,
      // primero a pendiente y después pagado eligiendo la caja.
      const paidWithoutDebit =
        state.estado === 'PAGADO' && state.movimiento_caja_id === null;
      if (paidWithoutDebit && status === 'PAGADO' && account)
        throw new BadRequestException(
          'Este gasto ya figuraba pagado sin caja. Para asignarle una, volvelo a pendiente y marcalo pagado eligiendo la caja.',
        );
      // Otra moneda: el importe anterior no vale en la caja nueva.
      if (
        account &&
        account.moneda.trim() !== state.moneda.trim() &&
        input.amount === undefined
      )
        throw new BadRequestException(
          `La caja elegida es en ${account.moneda.trim()}: indicá el importe en esa moneda.`,
        );

      const personnelId = await this.cash.actorPersonnelId(
        tx,
        actor,
        organizationId,
      );
      // El débito tiene que reflejar caja, importe y fecha del gasto pagado:
      // si cambia alguno (o deja de estar pagado), se devuelve el anterior y,
      // si sigue pagado, se registra uno nuevo.
      const debitChanged =
        state.movimiento_caja_id !== null &&
        (status !== 'PAGADO' ||
          accountId !== state.cuenta_caja_id ||
          !amount.equals(state.importe) ||
          fecha.getTime() !== state.fecha.getTime());
      let movementId = state.movimiento_caja_id;
      if (debitChanged) {
        // Mover plata de una caja (también devolverla) es sólo de su dueño.
        await this.assertOwnsAccount(tx, actor, state.cuenta_caja_id!);
        await this.refund(
          tx,
          state,
          status === 'PAGADO'
            ? 'Corrección de un gasto de vehículo'
            : 'Gasto de vehículo vuelto a pendiente',
          personnelId,
        );
        movementId = null;
      }
      if (
        status === 'PAGADO' &&
        movementId === null &&
        !paidWithoutDebit &&
        accountId
      ) {
        // Cada débito revalida la caja (propia, activa, de un administrador y
        // en el alcance del usuario), aunque sea la que ya tenía el gasto.
        const payer =
          account ??
          (await this.payerAccount(tx, actor, organizationId, accountId));
        if (amount.lessThanOrEqualTo(0))
          throw new BadRequestException(
            'El gasto no tiene importe: cargá el importe antes de marcarlo pagado.',
          );
        if (fecha.getTime() > argentinaToday().getTime())
          throw new BadRequestException(
            'La fecha de pago no puede ser posterior a hoy.',
          );
        movementId = await this.debit(tx, {
          organizationId,
          accountId: payer.id,
          amount,
          date: fecha,
          vehicleType: state.tipo_vehiculo,
          concept: input.conceptId
            ? await this.conceptName(tx, input.conceptId)
            : state.concepto_nombre,
          personnelId,
        });
      }
      const currency = account?.moneda ?? null;

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
          proveedor_id = ${input.providerId === undefined ? Prisma.sql`proveedor_id` : Prisma.sql`${input.providerId}::uuid`},
          importe = ${amount}::numeric,
          estado = ${status},
          fecha = ${fecha},
          cuenta_caja_id = ${accountId}::uuid,
          moneda = COALESCE(${currency}, moneda),
          movimiento_caja_id = ${movementId}::uuid,
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
    if (!rows[0]?.exists)
      throw new BadRequestException('Invalid or inactive concept');
  }

  private async assertProviderActive(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS(SELECT 1 FROM proveedores_pago_vehiculo WHERE id = ${id}::uuid AND activo = true) AS "exists"
    `);
    if (!rows[0]?.exists)
      throw new BadRequestException('Invalid or inactive provider');
  }
}

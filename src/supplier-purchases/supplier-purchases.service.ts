import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  direccion_caja_luma,
  Prisma,
  tipo_movimiento_caja_luma,
} from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CashService } from '../cash/cash.service';
import {
  CreateSupplierPurchaseDto,
  RegisterFinancialMovementDto,
  ReverseFinancialMovementDto,
  SupplierPurchaseQueryDto,
  UpdateSupplierPurchaseDto,
} from '../finance/finance.dto';
import {
  financialBadRequest,
  financialConflict,
  financialNotFound,
} from '../finance/finance.errors';
import {
  assertOrganization,
  businessDate,
  databasePaymentStatus,
  nonNegativeDecimal,
  paymentStatus,
  scope,
  targetOrganization,
} from '../finance/finance.utils';
import { PrismaService } from '../prisma/prisma.service';

const purchaseInclude = {
  proveedores: { select: { id: true, razon_social: true } },
  sucursal: { select: { id: true, codigo: true, nombre: true } },
  version: {
    include: { modelos_vehiculos: { include: { marcas_vehiculos: true } } },
  },
  unidades_vehiculos: {
    select: {
      id: true,
      vin_mostrado: true,
      patente: true,
      version_id: true,
    },
  },
  movimientos_caja: {
    where: {
      revierte_a_id: null,
      other_movimientos_caja: null,
      tipo_movimiento: tipo_movimiento_caja_luma.EGRESO,
    },
    select: { importe: true },
  },
} satisfies Prisma.compras_proveedorInclude;

type PurchaseRecord = Prisma.compras_proveedorGetPayload<{
  include: typeof purchaseInclude;
}>;

@Injectable()
export class SupplierPurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
  ) {}

  async findAll(query: SupplierPurchaseQueryDto, actor: AuthenticatedUser) {
    assertOrganization(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const search = query.search?.trim();
    const where: Prisma.compras_proveedorWhereInput = {
      organizacion_id: organizationId,
      sucursal_id: query.branchId,
      proveedor_id: query.supplierId,
      unidad_vehiculo_id: query.unitId,
      version_id: query.versionId,
      fecha_compra:
        query.from || query.to
          ? {
              gte: query.from ? businessDate(query.from) : undefined,
              lte: query.to ? businessDate(query.to) : undefined,
            }
          : undefined,
      OR: search
        ? [
            {
              numero_documento: {
                contains: search,
                mode: 'insensitive',
              },
            },
            {
              proveedores: {
                razon_social: { contains: search, mode: 'insensitive' },
              },
            },
            {
              unidades_vehiculos: {
                vin_mostrado: { contains: search, mode: 'insensitive' },
              },
            },
            {
              version: {
                nombre: { contains: search, mode: 'insensitive' },
              },
            },
          ]
        : undefined,
    };
    const [total, items] = await this.prisma.withTenant(
      scope(actor),
      async (tx) => {
        const orderBy = [
          { fecha_compra: 'desc' as const },
          { id: 'desc' as const },
        ];
        if (!query.status)
          return Promise.all([
            tx.compras_proveedor.count({ where }),
            tx.compras_proveedor.findMany({
              where,
              include: purchaseInclude,
              orderBy,
              skip: (query.page - 1) * query.limit,
              take: query.limit,
            }),
          ]);
        const matching = (
          await tx.compras_proveedor.findMany({
            where,
            include: purchaseInclude,
            orderBy,
          })
        ).filter(
          (item) => this.purchase(item, actor).paymentStatus === query.status,
        );
        const start = (query.page - 1) * query.limit;
        return [
          matching.length,
          matching.slice(start, start + query.limit),
        ] as const;
      },
    );
    return {
      items: items.map((item) => this.purchase(item, actor)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(scope(actor), async (tx) =>
      this.detail(await this.purchaseOr404(tx, id, actor), tx, actor),
    );
  }

  async create(input: CreateSupplierPurchaseDto, actor: AuthenticatedUser) {
    assertOrganization(actor, input.organizationId);
    const organizationId = input.organizationId ?? actor.organization.id;
    const base = nonNegativeDecimal(input.baseAmount);
    const additional = nonNegativeDecimal(input.additionalCosts ?? '0');
    const total = base.plus(additional);
    if (input.unitId && input.versionId)
      financialBadRequest(
        'AMBIGUOUS_VEHICLE_REFERENCE',
        'Provide either unitId or versionId, not both',
      );
    if (!total.isPositive())
      financialBadRequest(
        'INVALID_TOTAL',
        'Purchase total must be greater than zero',
      );
    return this.mutate(
      actor,
      'SUPPLIER_PURCHASE_CREATED',
      async (tx, event) => {
        await this.cash.branchOr400(tx, input.branchId, organizationId);
        await this.supplierOr400(tx, input.supplierId, organizationId);
        const vehicle = await this.vehicleReferences(
          tx,
          input.unitId,
          input.versionId,
          input.branchId,
          organizationId,
        );
        const purchase = await tx.compras_proveedor.create({
          data: {
            proveedor_id: input.supplierId,
            sucursal_id: input.branchId,
            version_id: vehicle.versionId,
            unidad_vehiculo_id: vehicle.unitId,
            fecha_compra: businessDate(input.purchaseDate),
            numero_documento: input.documentNumber?.trim(),
            importe_base: base,
            importe_adicional: additional,
            importe_total: total,
            moneda: input.currency ?? 'ARS',
            estado_pago: 'PENDIENTE',
            notas: input.notes?.trim(),
            organizacion_id: organizationId,
          },
          include: purchaseInclude,
        });
        event.entityId = purchase.id;
        return this.purchase(purchase, actor);
      },
      undefined,
      organizationId,
    );
  }

  async update(
    id: string,
    input: UpdateSupplierPurchaseDto,
    actor: AuthenticatedUser,
  ) {
    if (!Object.keys(input).length)
      throw new BadRequestException('At least one editable field is required');
    return this.mutate(
      actor,
      'SUPPLIER_PURCHASE_UPDATED',
      async (tx, event) => {
        const current = await this.purchaseOr404(tx, id, actor, true);
        event.targetOrganizationId = targetOrganization(
          actor,
          current.organizacion_id,
        );
        const branchId = input.branchId ?? current.sucursal_id;
        if (!branchId)
          financialBadRequest(
            'INVALID_BRANCH',
            'Operational purchase requires a branch',
          );
        await this.cash.branchOr400(tx, branchId, current.organizacion_id);
        if (input.supplierId)
          await this.supplierOr400(
            tx,
            input.supplierId,
            current.organizacion_id,
          );
        const vehicle = await this.vehicleReferences(
          tx,
          input.unitId === undefined
            ? (current.unidad_vehiculo_id ?? undefined)
            : (input.unitId ?? undefined),
          input.versionId ?? current.version_id ?? undefined,
          branchId,
          current.organizacion_id,
        );
        const base =
          input.baseAmount === undefined
            ? current.importe_base
            : nonNegativeDecimal(input.baseAmount);
        const additional =
          input.additionalCosts === undefined
            ? current.importe_adicional
            : nonNegativeDecimal(input.additionalCosts);
        const total = base.plus(additional);
        const paid = await this.cash.settledAmount(
          tx,
          { compra_proveedor_id: id },
          tipo_movimiento_caja_luma.EGRESO,
        );
        if (total.lessThan(paid))
          financialConflict(
            'EDIT_BELOW_SETTLED',
            'Purchase total cannot be lower than active payments',
          );
        const updated = await tx.compras_proveedor.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: current.organizacion_id,
            },
          },
          data: {
            proveedor_id: input.supplierId,
            sucursal_id: input.branchId,
            version_id: vehicle.versionId,
            unidad_vehiculo_id: vehicle.unitId,
            fecha_compra: input.purchaseDate
              ? businessDate(input.purchaseDate)
              : undefined,
            numero_documento:
              input.documentNumber === undefined
                ? undefined
                : input.documentNumber?.trim() || null,
            importe_base: base,
            importe_adicional: additional,
            importe_total: total,
            estado_pago: databasePaymentStatus(paymentStatus(paid, total)),
            notas:
              input.notes === undefined
                ? undefined
                : input.notes?.trim() || null,
          },
          include: purchaseInclude,
        });
        return this.purchase(updated, actor);
      },
      id,
    );
  }

  async pay(
    id: string,
    input: RegisterFinancialMovementDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'SUPPLIER_PURCHASE_PAYMENT_REGISTERED',
      async (tx, event) => {
        const purchase = await this.purchaseOr404(tx, id, actor, true);
        event.targetOrganizationId = targetOrganization(
          actor,
          purchase.organizacion_id,
        );
        await this.cash.registerEntityMovement(
          tx,
          actor,
          purchase.organizacion_id,
          purchase.moneda,
          input,
          { compra_proveedor_id: id },
          tipo_movimiento_caja_luma.EGRESO,
          direccion_caja_luma.DEBITO,
        );
        const paid = await this.cash.settledAmount(
          tx,
          { compra_proveedor_id: id },
          tipo_movimiento_caja_luma.EGRESO,
        );
        if (paid.greaterThan(purchase.importe_total))
          financialConflict('OVERPAYMENT', 'Payment exceeds purchase balance');
        await tx.compras_proveedor.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: purchase.organizacion_id,
            },
          },
          data: {
            estado_pago: databasePaymentStatus(
              paymentStatus(paid, purchase.importe_total),
            ),
          },
        });
        return this.detail(await this.purchaseOr404(tx, id, actor), tx, actor);
      },
      id,
    );
  }

  async reverse(
    id: string,
    movementId: string,
    input: ReverseFinancialMovementDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'SUPPLIER_PURCHASE_PAYMENT_REVERSED',
      async (tx, event) => {
        const purchase = await this.purchaseOr404(tx, id, actor, true);
        event.targetOrganizationId = targetOrganization(
          actor,
          purchase.organizacion_id,
        );
        await this.cash.reverseEntityMovement(
          tx,
          actor,
          purchase.organizacion_id,
          movementId,
          input,
          { compra_proveedor_id: id },
        );
        const paid = await this.cash.settledAmount(
          tx,
          { compra_proveedor_id: id },
          tipo_movimiento_caja_luma.EGRESO,
        );
        await tx.compras_proveedor.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: purchase.organizacion_id,
            },
          },
          data: {
            estado_pago: databasePaymentStatus(
              paymentStatus(paid, purchase.importe_total),
            ),
          },
        });
        return this.detail(await this.purchaseOr404(tx, id, actor), tx, actor);
      },
      id,
    );
  }

  private async detail(
    purchase: PurchaseRecord,
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
  ) {
    return {
      ...this.purchase(purchase, actor),
      notes: purchase.notas,
      movements: await this.cash.entityMovements(
        tx,
        {
          OR: [
            { compra_proveedor_id: purchase.id },
            {
              revierte_a_id: {
                in: (
                  await tx.movimientos_caja.findMany({
                    where: { compra_proveedor_id: purchase.id },
                    select: { id: true },
                  })
                ).map((movement) => movement.id),
              },
            },
          ],
        },
        actor,
      ),
    };
  }

  private purchase(item: PurchaseRecord, actor: AuthenticatedUser) {
    const paid = item.movimientos_caja.reduce(
      (total, movement) => total.plus(movement.importe),
      new Prisma.Decimal(0),
    );
    const canViewCosts = actor.role.permissions.includes(
      'compras.costos.consultar',
    );
    const version = item.version;
    return {
      id: item.id,
      purchaseDate: item.fecha_compra,
      documentNumber: item.numero_documento,
      currency: item.moneda,
      paymentStatus: paymentStatus(paid, item.importe_total),
      organizationId: item.organizacion_id,
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
      supplier: {
        id: item.proveedores.id,
        legalName: item.proveedores.razon_social,
      },
      branch: item.sucursal
        ? {
            id: item.sucursal.id,
            code: item.sucursal.codigo,
            name: item.sucursal.nombre,
          }
        : null,
      vehicle: {
        version: version
          ? {
              id: version.id,
              name: version.nombre,
              model: {
                id: version.modelos_vehiculos.id,
                name: version.modelos_vehiculos.nombre,
                vehicleType: version.modelos_vehiculos.tipo_vehiculo,
                brand: {
                  id: version.modelos_vehiculos.marcas_vehiculos.id,
                  name: version.modelos_vehiculos.marcas_vehiculos.nombre,
                },
              },
            }
          : null,
        unit: item.unidades_vehiculos
          ? {
              id: item.unidades_vehiculos.id,
              vin: item.unidades_vehiculos.vin_mostrado,
              licensePlate: item.unidades_vehiculos.patente,
            }
          : null,
      },
      ...(canViewCosts
        ? {
            baseAmount: item.importe_base.toString(),
            additionalCosts: item.importe_adicional.toString(),
            totalAmount: item.importe_total.toString(),
            paidAmount: paid.toString(),
            balanceAmount: item.importe_total.minus(paid).toString(),
          }
        : {}),
    };
  }

  private async purchaseOr404(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
    lock = false,
  ) {
    if (lock)
      await tx.$queryRaw`
        SELECT "id"
        FROM "public"."compras_proveedor"
        WHERE "id" = CAST(${id} AS uuid)
          AND (${actor.globalAccess} OR "organizacion_id" = CAST(${actor.organization.id} AS uuid))
        FOR UPDATE
      `;
    const purchase = await tx.compras_proveedor.findFirst({
      where: {
        id,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
      },
      include: purchaseInclude,
    });
    if (!purchase) financialNotFound('Supplier purchase');
    return purchase;
  }

  private async supplierOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const supplier = await tx.proveedores.findFirst({
      where: { id, organizacion_id: organizationId, activo: true },
      select: { id: true },
    });
    if (!supplier)
      financialBadRequest(
        'INVALID_SUPPLIER',
        'Supplier is invalid or inactive',
      );
  }

  private async vehicleReferences(
    tx: Prisma.TransactionClient,
    unitId: string | undefined,
    versionId: string | undefined,
    branchId: string,
    organizationId: string,
  ) {
    if (unitId) {
      const unit = await this.cash.unitOr400(tx, unitId, organizationId);
      if (unit.sucursal_id !== branchId)
        financialBadRequest(
          'UNIT_BRANCH_MISMATCH',
          'Inventory unit must belong to the purchase branch',
        );
      if (versionId && versionId !== unit.version_id)
        financialBadRequest(
          'UNIT_VERSION_MISMATCH',
          'Inventory unit does not match the selected version',
        );
      return { unitId, versionId: unit.version_id };
    }
    if (!versionId)
      financialBadRequest(
        'VEHICLE_REFERENCE_REQUIRED',
        'Purchase requires an inventory unit or vehicle version',
      );
    await this.versionOr400(tx, versionId, organizationId);
    return { unitId: null, versionId };
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
      !version.activo ||
      (version.alcance !== 'GLOBAL' &&
        version.organizacion_propietaria_id !== organizationId &&
        !version.catalogo_organizaciones.some(
          (organization) => organization.organizacion_id === organizationId,
        ))
    )
      financialBadRequest(
        'INVALID_VEHICLE_VERSION',
        'Vehicle version is not available to the organization',
      );
  }

  private mutate<T>(
    actor: AuthenticatedUser,
    action: string,
    work: (
      tx: Prisma.TransactionClient,
      event: AuthenticatedAuditEvent,
    ) => Promise<T>,
    entityId?: string,
    organizationId?: string,
  ) {
    const event: AuthenticatedAuditEvent = {
      action,
      entity: 'compras_proveedor',
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
          error.code === 'P2003'
        )
          throw new BadRequestException('A referenced record is invalid');
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' || error.code === 'P2034')
        )
          throw new ConflictException(
            'Supplier purchase conflicts with another request',
          );
        throw error;
      });
  }
}

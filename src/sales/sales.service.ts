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
  plataforma_pago_luma,
  Prisma,
  tipo_componente_pago_luma,
  tipo_vehiculo_luma,
  tipo_movimiento_inventario_luma,
} from '@prisma/client';
import { AuditService, AuthenticatedAuditEvent } from '../audit/audit.service';
import { ROLE_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  activePricePolicyRequired,
  findEffectivePricePolicy,
} from '../catalog/price-policy';
import {
  normalizeClientDocument,
  normalizeClientName,
} from '../clients/client-normalization';
import { normalizeVin } from '../inventory/vin';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApproveSalesOperationDto,
  CreateSalesOperationDto,
  CreateSalesTradeInDto,
  ReasonedSalesActionDto,
  ReplaceSalesPaymentPlanDto,
  ReleaseSalesReservationDto,
  ReserveSalesUnitDto,
  SalesAssignmentRole,
  SalesFinancialInstitutionQueryDto,
  SalesPaymentComponentDto,
  SalesOperationQueryDto,
  SalesPricePolicyQueryDto,
  SalesSellerQueryDto,
  UpdateSalesOperationDto,
  VersionedSalesActionDto,
} from './sales.dto';

const operationInclude = {
  clientes: {
    select: {
      id: true,
      tipo_documento: true,
      numero_documento: true,
      nombre_completo: true,
      telefono: true,
      activo: true,
    },
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
      origen_adquisicion: true,
      proveedores: {
        select: { id: true, razon_social: true },
      },
    },
  },
  asignaciones_personal_operacion: {
    include: {
      personal: {
        select: { id: true, codigo_empleado: true, nombre_completo: true },
      },
    },
  },
  reservas_stock: {
    orderBy: [{ creado_en: 'desc' as const }, { id: 'desc' as const }],
  },
  aprobaciones_operacion: {
    orderBy: [{ solicitado_en: 'desc' as const }, { id: 'desc' as const }],
  },
  componentes_pago_operacion: {
    orderBy: [{ creado_en: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      tipo_componente: true,
      importe_esperado: true,
      fecha_vencimiento: true,
      financiera_id: true,
      consulta_crediticia_id: true,
      vehiculo_tomado_id: true,
      estado_pago: true,
      notas: true,
    },
  },
  obligaciones_operacion: {
    orderBy: [{ creado_en: 'asc' as const }, { id: 'asc' as const }],
  },
  vehiculos_tomados_parte_pago: {
    orderBy: [{ creado_en: 'asc' as const }, { id: 'asc' as const }],
  },
  solicitudes_abastecimiento: {
    include: {
      proveedores: {
        select: { id: true, razon_social: true },
      },
      sucursales: {
        select: { id: true, codigo: true, nombre: true },
      },
    },
    orderBy: [{ solicitado_en: 'desc' as const }, { id: 'desc' as const }],
  },
  personal: {
    select: { id: true, nombre_completo: true },
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
    if (query.mine && query.sellerId)
      throw new BadRequestException(
        'mine and sellerId filters cannot be combined',
      );
    const sellerRestricted = actor.role.code === ROLE_CODES.VENDEDOR;
    if (sellerRestricted && query.sellerId)
      throw new ForbiddenException(
        'Sellers cannot query operations assigned to another seller',
      );
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const sellerId =
      query.mine || sellerRestricted
        ? await this.prisma.withTenant(this.scope(actor), (tx) =>
            this.actorPersonnelId(
              tx,
              actor,
              query.organizationId ?? actor.organization.id,
            ),
          )
        : query.sellerId;
    const search = query.search?.trim();
    const operationNumber =
      search && /^\d+$/.test(search) ? BigInt(search) : undefined;
    const where: Prisma.operacionesWhereInput = {
      organizacion_id: organizationId,
      estado_operacion: query.status,
      sucursal_id: query.branchId,
      cliente_id: query.clientId,
      version_id: query.versionId,
      versiones_vehiculos: {
        modelos_vehiculos: {
          tipo_vehiculo: query.vehicleType,
        },
      },
      fecha_operacion:
        query.from || query.to
          ? {
              gte: query.from ? new Date(query.from) : undefined,
              lte: query.to ? new Date(query.to) : undefined,
            }
          : undefined,
      asignaciones_personal_operacion: sellerId
        ? {
            some: {
              personal_id: sellerId,
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
            relationLoadStrategy: 'join',
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

  pendingApprovals(query: SalesOperationQueryDto, actor: AuthenticatedUser) {
    return this.findAll(
      {
        ...query,
        status: luma_estado_operacion.PENDIENTE_APROBACION,
      },
      actor,
    );
  }

  async createTradeIn(
    id: string,
    input: CreateSalesTradeInDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'SALES_TRADE_IN_CREATED',
      async (tx, event) => {
        const operation = await this.operationOr404(tx, id, actor, true);
        this.setTargetOrganization(event, actor, operation.organizacion_id);
        this.assertVersion(operation.version_fila, input.expectedVersion);
        const preserveApproval =
          operation.estado_operacion === luma_estado_operacion.APROBADA;
        if (
          !preserveApproval &&
          operation.estado_operacion !== luma_estado_operacion.BORRADOR &&
          operation.estado_operacion !== luma_estado_operacion.RECHAZADA
        )
          throw new ConflictException(
            'Trade-ins can only be added to draft or rejected operations',
          );
        if (preserveApproval) {
          const collections = await tx.cobranzas.count({
            where: {
              componentes_pago_operacion: {
                operacion_id: id,
                organizacion_id: operation.organizacion_id,
              },
            },
          });
          if (collections)
            throw new ConflictException(
              'Trade-ins cannot be added after collections exist',
            );
        }
        if (input.versionId)
          await this.versionOr400(
            tx,
            input.versionId,
            operation.organizacion_id,
          );
        await tx.vehiculos_tomados_parte_pago.create({
          data: {
            operacion_id: id,
            version_id: input.versionId,
            descripcion_original: input.description.trim(),
            vin_mostrado: input.vin?.trim(),
            vin_normalizado: input.vin ? normalizeVin(input.vin) : undefined,
            numero_motor: input.engineNumber?.trim(),
            patente: input.licensePlate?.trim().toUpperCase(),
            anio_fabricacion: input.year,
            kilometraje_km: input.kilometers,
            importe_tasado: input.appraisedAmount,
            importe_aceptado: input.acceptedAmount,
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
            estado_operacion: preserveApproval
              ? undefined
              : luma_estado_operacion.BORRADOR,
            version_fila: { increment: 1 },
          },
        });
        return this.operation(await this.operationOr404(tx, id, actor));
      },
      id,
    );
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    return this.prisma.withTenant(this.scope(actor), async (tx) =>
      this.operation(await this.operationOr404(tx, id, actor)),
    );
  }

  async sellers(query: SalesSellerQueryDto, actor: AuthenticatedUser) {
    return this.assignees(query, actor, SalesAssignmentRole.VENDEDOR);
  }

  async contacts(query: SalesSellerQueryDto, actor: AuthenticatedUser) {
    return this.assignees(query, actor, SalesAssignmentRole.CONTACTO);
  }

  async financialInstitutions(
    query: SalesFinancialInstitutionQueryDto,
    actor: AuthenticatedUser,
  ) {
    this.assertOrganizationSelection(actor, query.organizationId);
    const organizationId = query.organizationId ?? actor.organization.id;
    const search = query.search?.trim();
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      const where: Prisma.financierasWhereInput = {
        organizacion_id: organizationId,
        activo: true,
        razon_social: search
          ? { contains: search, mode: 'insensitive' }
          : undefined,
      };
      const [total, items] = await Promise.all([
        tx.financieras.count({ where }),
        tx.financieras.findMany({
          where,
          select: { id: true, razon_social: true },
          orderBy: [{ razon_social: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ]);
      return {
        items: items.map((item) => ({
          id: item.id,
          legalName: item.razon_social,
        })),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  private async assignees(
    query: SalesSellerQueryDto,
    actor: AuthenticatedUser,
    assignmentRole: SalesAssignmentRole,
  ) {
    if (query.organizationId && query.organizationId !== actor.organization.id)
      throw new ForbiddenException(
        'Assignee lookups are restricted to the authenticated organization',
      );
    const organizationId = actor.organization.id;
    const search = query.search?.trim();
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      if (query.branchId)
        await this.branchOr400(tx, query.branchId, organizationId);
      const where: Prisma.personalWhereInput = {
        organizacion_id: organizationId,
        estado: 'ACTIVO',
        roles:
          assignmentRole === SalesAssignmentRole.VENDEDOR
            ? { activo: true, codigo: ROLE_CODES.VENDEDOR }
            : undefined,
        OR: query.branchId
          ? [
              { sucursal_principal_id: query.branchId },
              {
                acceso_personal_sucursal: {
                  some: { sucursal_id: query.branchId },
                },
              },
            ]
          : [
              { sucursal_principal_id: { not: null } },
              { acceso_personal_sucursal: { some: {} } },
            ],
        AND: search
          ? [
              {
                OR: [
                  {
                    nombre_completo: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                  {
                    codigo_empleado: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                ],
              },
            ]
          : undefined,
      };
      const [total, items] = await Promise.all([
        tx.personal.count({ where }),
        tx.personal.findMany({
          relationLoadStrategy: 'join',
          where,
          select: {
            id: true,
            usuario_id: true,
            codigo_empleado: true,
            nombre_completo: true,
            sucursales: {
              select: { id: true, codigo: true, nombre: true },
            },
            acceso_personal_sucursal: {
              select: {
                sucursales: {
                  select: { id: true, codigo: true, nombre: true },
                },
              },
              orderBy: { sucursal_id: 'asc' },
            },
          },
          orderBy: [{ nombre_normalizado: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ]);
      return {
        items: items.map((item) => {
          const branches = [
            item.sucursales,
            ...item.acceso_personal_sucursal.map((access) => access.sucursales),
          ].filter((branch) => branch !== null);
          const uniqueBranches = [
            ...new Map(branches.map((branch) => [branch.id, branch])).values(),
          ];
          return {
            id: item.id,
            employeeCode: item.codigo_empleado,
            fullName: item.nombre_completo,
            isCurrentUser: item.usuario_id === actor.id,
            branch: item.sucursales
              ? {
                  id: item.sucursales.id,
                  code: item.sucursales.codigo,
                  name: item.sucursales.nombre,
                }
              : null,
            branches: uniqueBranches.map((branch) => ({
              id: branch.id,
              code: branch.codigo,
              name: branch.nombre,
            })),
          };
        }),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async pricePolicy(query: SalesPricePolicyQueryDto, actor: AuthenticatedUser) {
    this.assertOrganizationSelection(actor, query.organizationId);
    const organizationId = query.organizationId ?? actor.organization.id;
    return this.prisma.withTenant(this.scope(actor), async (tx) => {
      await this.branchOr400(tx, query.branchId, organizationId);
      await this.versionOr400(
        tx,
        query.versionId,
        organizationId,
        query.vehicleType,
      );
      const policy = await this.pricePolicyOr400(
        tx,
        query.versionId,
        query.branchId,
        organizationId,
        query.operationDate ?? new Date(),
      );
      return {
        id: policy.id,
        versionId: policy.version_id,
        branchId: policy.sucursal_id,
        organizationId: policy.organizacion_id,
        currency: policy.moneda,
        listPrice: policy.precio_lista.toString(),
        minimumPrice: policy.precio_minimo.toString(),
        validFrom: policy.vigente_desde,
        validUntil: policy.vigente_hasta,
        scope: policy.sucursal_id ? 'BRANCH' : 'ORGANIZATION',
      };
    });
  }

  async create(input: CreateSalesOperationDto, actor: AuthenticatedUser) {
    this.assertOrganizationSelection(actor, input.organizationId);
    if (input.deliveryStatus && input.deliveryStatus !== 'NO_PROGRAMADA')
      throw new BadRequestException(
        'New operations must start with delivery status NO_PROGRAMADA',
      );
    this.assertPaymentContract(
      input.paymentPlatform,
      input.creditAmount,
      input.agreedPrice,
    );
    const organizationId = input.organizationId ?? actor.organization.id;
    return this.mutate(
      actor,
      'SALES_OPERATION_CREATED',
      async (tx) => {
        await this.branchOr400(tx, input.branchId, organizationId);
        const clientId = await this.resolveClient(tx, input, organizationId);
        await this.versionOr400(
          tx,
          input.versionId,
          organizationId,
          input.vehicleType,
        );
        if (Boolean(input.unitId) === Boolean(input.supplierAvailabilityId))
          throw new BadRequestException(
            'Exactly one of unitId or supplierAvailabilityId is required',
          );
        if (
          actor.role.code === ROLE_CODES.VENDEDOR &&
          input.sellerId !== undefined
        )
          throw new ForbiddenException(
            'Sellers cannot assign operations to another seller',
          );
        const sellerId =
          (actor.role.code === ROLE_CODES.VENDEDOR
            ? undefined
            : input.sellerId) ??
          (await this.actorPersonnelId(tx, actor, organizationId));
        await this.sellerOr400(tx, sellerId, organizationId);
        if (input.contactId)
          await this.sellerOr400(
            tx,
            input.contactId,
            organizationId,
            SalesAssignmentRole.CONTACTO,
          );
        const policy = await this.pricePolicyOr400(
          tx,
          input.versionId,
          input.branchId,
          organizationId,
          input.operationDate ?? new Date(),
        );
        const operation = await tx.operaciones.create({
          data: {
            sucursal_id: input.branchId,
            cliente_id: clientId,
            version_id: input.versionId,
            condicion: input.condition,
            fecha_operacion: input.operationDate
              ? new Date(input.operationDate)
              : new Date(),
            precio_lista: policy.precio_lista,
            precio_minimo: policy.precio_minimo,
            precio_acordado: input.agreedPrice,
            moneda: policy.moneda,
            plataforma_pago: input.paymentPlatform,
            monto_credito: input.creditAmount,
            respaldo_garante: input.guarantor?.trim(),
            debe: input.debt,
            estado_entrega: input.deliveryStatus,
            estado_documentacion: input.papersDelivered
              ? 'COMPLETA'
              : undefined,
            documentacion_entregada_en: input.papersDelivered
              ? new Date()
              : undefined,
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
        if (input.contactId) {
          await tx.asignaciones_personal_operacion.create({
            data: {
              operacion_id: operation.id,
              personal_id: input.contactId,
              rol_asignacion: 'CONTACTO',
              organizacion_id: organizationId,
            },
          });
        }
        if (input.unitId) {
          await this.reserveUnit(
            tx,
            operation,
            input.unitId,
            input.reservationExpiresAt,
            actor,
          );
        } else if (input.supplierAvailabilityId) {
          await this.createSupplyRequest(
            tx,
            operation,
            input.supplierAvailabilityId,
            actor,
          );
        }
        if (input.submit) {
          await this.submitLockedOperation(
            tx,
            await this.operationOr404(tx, operation.id, actor),
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
    if (actor.role.code === ROLE_CODES.VENDEDOR && input.sellerId !== undefined)
      throw new ForbiddenException(
        'Sellers cannot assign operations to another seller',
      );
    return this.mutate(
      actor,
      'SALES_OPERATION_UPDATED',
      async (tx, event) => {
        const current = await this.operationOr404(tx, id, actor, true);
        this.setTargetOrganization(event, actor, current.organizacion_id);
        this.assertVersion(current.version_fila, input.expectedVersion);
        const approvedUpdate =
          current.estado_operacion === luma_estado_operacion.APROBADA;
        if (
          !approvedUpdate &&
          current.estado_operacion !== luma_estado_operacion.BORRADOR &&
          current.estado_operacion !== luma_estado_operacion.RECHAZADA
        )
          throw new ConflictException(
            'Operation cannot be edited in its current state',
          );
        if (
          approvedUpdate &&
          Object.keys(input).some(
            (key) =>
              ![
                'expectedVersion',
                'deliveryStatus',
                'papersDelivered',
                'debt',
                'notes',
              ].includes(key),
          )
        )
          throw new ConflictException(
            'Approved operations only allow delivery, papers, debt, and notes updates',
          );
        const branchId = input.branchId ?? current.sucursal_id;
        if (
          input.deliveryStatus &&
          input.deliveryStatus !== 'NO_PROGRAMADA' &&
          current.estado_operacion !== luma_estado_operacion.APROBADA
        )
          throw new ConflictException(
            'Delivery can only advance on approved operations',
          );
        if (
          current.plataforma_pago ||
          input.paymentPlatform ||
          input.creditAmount !== undefined
        )
          this.assertPaymentContract(
            input.paymentPlatform ?? current.plataforma_pago,
            input.creditAmount === undefined
              ? current.monto_credito?.toNumber()
              : input.creditAmount,
            input.agreedPrice ?? current.precio_acordado.toNumber(),
          );
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
          await this.sellerOr400(tx, input.sellerId, current.organizacion_id);
        if (input.contactId)
          await this.sellerOr400(
            tx,
            input.contactId,
            current.organizacion_id,
            SalesAssignmentRole.CONTACTO,
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
            plataforma_pago: input.paymentPlatform,
            monto_credito: input.creditAmount,
            respaldo_garante:
              input.guarantor === undefined
                ? undefined
                : input.guarantor === null
                  ? null
                  : input.guarantor.trim(),
            fecha_operacion: input.operationDate
              ? new Date(input.operationDate)
              : undefined,
            estado_entrega: input.deliveryStatus,
            estado_documentacion:
              input.papersDelivered === undefined
                ? undefined
                : input.papersDelivered
                  ? 'COMPLETA'
                  : 'NO_INICIADA',
            documentacion_entregada_en:
              input.papersDelivered === undefined
                ? undefined
                : input.papersDelivered
                  ? new Date()
                  : null,
            debe: input.debt,
            notas:
              input.notes === undefined
                ? undefined
                : input.notes === null
                  ? null
                  : input.notes.trim(),
            estado_operacion: approvedUpdate
              ? undefined
              : luma_estado_operacion.BORRADOR,
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
        if (input.contactId !== undefined) {
          await tx.asignaciones_personal_operacion.deleteMany({
            where: {
              operacion_id: id,
              organizacion_id: current.organizacion_id,
              rol_asignacion: 'CONTACTO',
            },
          });
          if (input.contactId)
            await tx.asignaciones_personal_operacion.create({
              data: {
                operacion_id: id,
                personal_id: input.contactId,
                rol_asignacion: 'CONTACTO',
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
        const approvedAssignment =
          operation.estado_operacion === luma_estado_operacion.APROBADA;
        if (
          !approvedAssignment &&
          operation.estado_operacion !== luma_estado_operacion.BORRADOR &&
          operation.estado_operacion !== luma_estado_operacion.RECHAZADA
        )
          throw new ConflictException(
            'Units can only be reserved for draft or rejected operations',
          );
        await this.materializeProviderReservation(tx, operation, input.unitId);
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
            estado_operacion: approvedAssignment
              ? undefined
              : luma_estado_operacion.BORRADOR,
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
        const preserveApproval =
          operation.estado_operacion === luma_estado_operacion.APROBADA;
        if (
          !preserveApproval &&
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
        await this.releaseOperationReservation(
          tx,
          operation,
          reservation,
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
        await this.submitLockedOperation(tx, operation, actor);
        return this.operation(await this.operationOr404(tx, id, actor));
      },
      id,
    );
  }

  async replacePaymentPlan(
    id: string,
    input: ReplaceSalesPaymentPlanDto,
    actor: AuthenticatedUser,
  ) {
    return this.mutate(
      actor,
      'SALES_PAYMENT_PLAN_REPLACED',
      async (tx, event) => {
        const operation = await this.operationOr404(tx, id, actor, true);
        this.setTargetOrganization(event, actor, operation.organizacion_id);
        this.assertVersion(operation.version_fila, input.expectedVersion);
        const preserveApproval =
          operation.estado_operacion === luma_estado_operacion.APROBADA;
        if (
          !preserveApproval &&
          operation.estado_operacion !== luma_estado_operacion.BORRADOR &&
          operation.estado_operacion !== luma_estado_operacion.RECHAZADA
        )
          throw new ConflictException(
            'Payment plan cannot be replaced in the current operation state',
          );
        const total = input.components.reduce(
          (sum, component) => sum.plus(component.amount),
          new Prisma.Decimal(0),
        );
        if (!total.equals(operation.precio_acordado))
          throw new BadRequestException(
            'Payment plan total must equal the agreed price',
          );
        this.validatePaymentPlanContract(operation, input.components);
        const collections = await tx.cobranzas.count({
          where: {
            componentes_pago_operacion: {
              operacion_id: id,
              organizacion_id: operation.organizacion_id,
            },
          },
        });
        if (collections)
          throw new ConflictException(
            'Payment plan with collections cannot be replaced',
          );
        for (const component of input.components)
          await this.validatePaymentComponent(
            tx,
            component,
            operation.id,
            operation.cliente_id,
            operation.organizacion_id,
          );
        await tx.componentes_pago_operacion.deleteMany({
          where: {
            operacion_id: id,
            organizacion_id: operation.organizacion_id,
          },
        });
        await tx.componentes_pago_operacion.createMany({
          data: input.components.map((component) => ({
            operacion_id: id,
            tipo_componente: component.type,
            importe_esperado: component.amount,
            fecha_vencimiento: component.dueDate
              ? new Date(component.dueDate)
              : undefined,
            financiera_id: component.financialInstitutionId,
            consulta_crediticia_id: component.creditInquiryId,
            vehiculo_tomado_id: component.tradeInVehicleId,
            notas: component.notes?.trim(),
            organizacion_id: operation.organizacion_id,
          })),
        });
        await tx.operaciones.update({
          where: {
            id_organizacion_id: {
              id,
              organizacion_id: operation.organizacion_id,
            },
          },
          data: {
            estado_operacion: preserveApproval
              ? undefined
              : luma_estado_operacion.BORRADOR,
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
          await this.releaseOperationReservation(
            tx,
            operation,
            reservation,
            input.reason,
            actor,
          );
        await tx.solicitudes_abastecimiento.updateMany({
          where: {
            operacion_id: id,
            organizacion_id: operation.organizacion_id,
            estado: { notIn: ['RECIBIDO', 'ASIGNADO', 'CANCELADA'] },
          },
          data: { estado: 'CANCELADA' },
        });
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
        if (approved) await this.assertFulfillableOperation(tx, operation);
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
          if (reservation) {
            if (reservation.unidad_vehiculo_id)
              await this.releaseActiveReservation(
                tx,
                operation,
                reservation.id,
                reason!,
                actor,
              );
            else
              await tx.reservas_stock.update({
                where: { id: reservation.id },
                data: {
                  estado: estado_reserva_luma.LIBERADA,
                  liberado_en: new Date(),
                  motivo_liberacion: reason!,
                },
              });
          }
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
        if (operation.solicitudes_abastecimiento?.length)
          await tx.solicitudes_abastecimiento.updateMany({
            where: {
              operacion_id: id,
              organizacion_id: operation.organizacion_id,
              estado: approved
                ? 'PENDIENTE_APROBACION'
                : { notIn: ['RECIBIDO', 'ASIGNADO', 'CANCELADA'] },
            },
            data: {
              estado: approved ? 'PENDIENTE_CONFIRMACION' : 'CANCELADA',
            },
          });
        return this.operation(await this.operationOr404(tx, id, actor));
      },
      id,
    );
  }

  private async submitLockedOperation(
    tx: Prisma.TransactionClient,
    operation: OperationRecord,
    actor: AuthenticatedUser,
  ) {
    if (operation.estado_operacion !== luma_estado_operacion.BORRADOR)
      throw new ConflictException('Only draft operations can be submitted');
    await this.assertFulfillableOperation(tx, operation);
    await this.clientOr400(tx, operation.cliente_id, operation.organizacion_id);
    this.assertPaymentContract(
      operation.plataforma_pago,
      operation.monto_credito,
      operation.precio_acordado,
    );
    const policy = await this.pricePolicyOr400(
      tx,
      operation.version_id,
      operation.sucursal_id,
      operation.organizacion_id,
      operation.fecha_operacion,
    );
    const requiresApproval = operation.precio_acordado.lessThan(
      policy.precio_lista,
    );
    if (
      operation.estado_entrega === 'ENTREGADO' &&
      (requiresApproval || !operation.unidad_vehiculo_id)
    )
      throw new ConflictException(
        'Delivered status requires an approved operation with a physical unit',
      );
    if (requiresApproval) {
      const personnelId = await this.actorPersonnelId(
        tx,
        actor,
        operation.organizacion_id,
      );
      await tx.aprobaciones_operacion.create({
        data: {
          operacion_id: operation.id,
          solicitado_por_personal_id: personnelId,
          precio_lista_referencia: policy.precio_lista,
          precio_minimo_referencia: policy.precio_minimo,
          precio_acordado_referencia: operation.precio_acordado,
          organizacion_id: operation.organizacion_id,
        },
      });
    }
    await tx.operaciones.update({
      where: {
        id_organizacion_id: {
          id: operation.id,
          organizacion_id: operation.organizacion_id,
        },
      },
      data: {
        estado_operacion: requiresApproval
          ? luma_estado_operacion.PENDIENTE_APROBACION
          : luma_estado_operacion.APROBADA,
        precio_lista: policy.precio_lista,
        precio_minimo: policy.precio_minimo,
        moneda: policy.moneda,
        version_fila: { increment: 1 },
      },
    });
    if (!requiresApproval)
      await tx.solicitudes_abastecimiento.updateMany({
        where: {
          operacion_id: operation.id,
          organizacion_id: operation.organizacion_id,
          estado: 'PENDIENTE_APROBACION',
        },
        data: { estado: 'PENDIENTE_CONFIRMACION' },
      });
  }

  private async createSupplyRequest(
    tx: Prisma.TransactionClient,
    operation: Pick<
      OperationRecord,
      'id' | 'version_id' | 'condicion' | 'sucursal_id' | 'organizacion_id'
    >,
    availabilityId: string,
    actor: AuthenticatedUser,
  ) {
    const now = new Date();
    await tx.$queryRaw`
      SELECT "id"
      FROM "disponibilidad_proveedor"
      WHERE "id" = ${availabilityId}::uuid
        AND "organizacion_id" = ${operation.organizacion_id}::uuid
      FOR UPDATE
    `;
    const availability = await tx.disponibilidad_proveedor.findFirst({
      where: {
        id: availabilityId,
        organizacion_id: operation.organizacion_id,
        version_id: operation.version_id,
        condicion: operation.condicion,
        cantidad_informada: { gt: 0 },
        OR: [{ vence_en: null }, { vence_en: { gt: now } }],
      },
      select: {
        id: true,
        proveedor_id: true,
        vence_en: true,
        cantidad_informada: true,
      },
    });
    if (!availability)
      throw new BadRequestException(
        'Provider availability is invalid, expired, or unavailable',
      );
    const supplier = await tx.proveedores.findFirst({
      where: {
        id: availability.proveedor_id,
        organizacion_id: operation.organizacion_id,
        activo: true,
      },
      select: { id: true },
    });
    if (!supplier)
      throw new BadRequestException('Supplier is invalid or inactive');
    const personnelId = await this.actorPersonnelId(
      tx,
      actor,
      operation.organizacion_id,
    );
    const defaultExpiry = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const expiresAt =
      availability.vence_en && availability.vence_en < defaultExpiry
        ? availability.vence_en
        : defaultExpiry;
    const activeReservations = await tx.reservas_stock.count({
      where: {
        disponibilidad_proveedor_id: availability.id,
        organizacion_id: operation.organizacion_id,
        estado: 'ACTIVO',
        vence_en: { gt: now },
      },
    });
    if (activeReservations >= availability.cantidad_informada)
      throw new ConflictException({
        statusCode: 409,
        code: 'SUPPLIER_AVAILABILITY_ALREADY_RESERVED',
        message: 'Supplier availability has no unreserved quantity',
        supplierAvailabilityId: availability.id,
        error: 'Conflict',
      });
    await tx.reservas_stock.create({
      data: {
        operacion_id: operation.id,
        disponibilidad_proveedor_id: availability.id,
        vence_en: expiresAt,
        creado_por_personal_id: personnelId,
        organizacion_id: operation.organizacion_id,
      },
    });
    await tx.solicitudes_abastecimiento.create({
      data: {
        operacion_id: operation.id,
        proveedor_id: supplier.id,
        disponibilidad_proveedor_id: availability.id,
        version_id: operation.version_id,
        condicion: operation.condicion,
        sucursal_llegada_id: operation.sucursal_id,
        estado: 'PENDIENTE_APROBACION',
        creado_por_personal_id: personnelId,
        organizacion_id: operation.organizacion_id,
      },
    });
  }

  private assertPaymentContract(
    platform: plataforma_pago_luma | null,
    creditAmount: Prisma.Decimal | number | null | undefined,
    agreedPrice: Prisma.Decimal | number,
  ) {
    if (!platform)
      throw new BadRequestException('Payment platform is required');
    const creditPlatforms: plataforma_pago_luma[] = [
      plataforma_pago_luma.CREDITO,
      plataforma_pago_luma.EFECTIVO_CREDITO,
      plataforma_pago_luma.MOTO_CREDITO,
      plataforma_pago_luma.MOTO_EFECTIVO_CREDITO,
    ];
    const requiresCredit = creditPlatforms.includes(platform);
    const amount =
      creditAmount === null || creditAmount === undefined
        ? null
        : new Prisma.Decimal(creditAmount);
    if (requiresCredit && (!amount || amount.lessThanOrEqualTo(0)))
      throw new BadRequestException(
        'Credit amount must be positive for the selected payment platform',
      );
    if (amount && amount.greaterThan(new Prisma.Decimal(agreedPrice)))
      throw new BadRequestException(
        'Credit amount cannot exceed the agreed price',
      );
    if (!requiresCredit && amount && !amount.equals(0))
      throw new BadRequestException(
        'Credit amount is not allowed for the selected payment platform',
      );
  }

  private async validatePaymentComponent(
    tx: Prisma.TransactionClient,
    component: SalesPaymentComponentDto,
    operationId: string,
    clientId: string,
    organizationId: string,
  ) {
    if (
      component.type === tipo_componente_pago_luma.FINANCIACION &&
      !component.financialInstitutionId
    )
      throw new BadRequestException(
        'Financial institution is required for financing components',
      );
    if (
      component.type === tipo_componente_pago_luma.TOMA_PARTE_PAGO &&
      !component.tradeInVehicleId
    )
      throw new BadRequestException(
        'Trade-in vehicle is required for trade-in components',
      );
    if (
      component.type !== tipo_componente_pago_luma.FINANCIACION &&
      (component.financialInstitutionId || component.creditInquiryId)
    )
      throw new BadRequestException(
        'Financial references are only allowed on financing components',
      );
    if (
      component.type !== tipo_componente_pago_luma.TOMA_PARTE_PAGO &&
      component.tradeInVehicleId
    )
      throw new BadRequestException(
        'Trade-in reference is only allowed on trade-in components',
      );
    if (component.financialInstitutionId) {
      const financial = await tx.financieras.findFirst({
        where: {
          id: component.financialInstitutionId,
          organizacion_id: organizationId,
          activo: true,
        },
        select: { id: true },
      });
      if (!financial)
        throw new BadRequestException(
          'Financial institution is invalid or inactive',
        );
    }
    if (component.creditInquiryId) {
      const inquiry = await tx.consultas_crediticias.findFirst({
        where: {
          id: component.creditInquiryId,
          organizacion_id: organizationId,
          cliente_id: clientId,
          financiera_id: component.financialInstitutionId,
          OR: [{ operacion_id: null }, { operacion_id: operationId }],
        },
        select: { id: true },
      });
      if (!inquiry)
        throw new BadRequestException(
          'Credit inquiry is invalid for this financing component',
        );
    }
    if (component.tradeInVehicleId) {
      const tradeIn = await tx.vehiculos_tomados_parte_pago.findFirst({
        where: {
          id: component.tradeInVehicleId,
          operacion_id: operationId,
          organizacion_id: organizationId,
        },
        select: { id: true },
      });
      if (!tradeIn)
        throw new BadRequestException(
          'Trade-in vehicle is invalid for this operation',
        );
    }
  }

  private validatePaymentPlanContract(
    operation: OperationRecord,
    components: SalesPaymentComponentDto[],
  ) {
    if (!operation.plataforma_pago)
      throw new BadRequestException('Payment platform is required');
    const hasFinancing = components.some(
      (component) => component.type === tipo_componente_pago_luma.FINANCIACION,
    );
    const hasTradeIn = components.some(
      (component) =>
        component.type === tipo_componente_pago_luma.TOMA_PARTE_PAGO,
    );
    const hasCashLike = components.some(
      (component) =>
        component.type !== tipo_componente_pago_luma.FINANCIACION &&
        component.type !== tipo_componente_pago_luma.TOMA_PARTE_PAGO,
    );
    const expected = {
      [plataforma_pago_luma.EFECTIVO]: [true, false, false],
      [plataforma_pago_luma.CREDITO]: [false, true, false],
      [plataforma_pago_luma.EFECTIVO_CREDITO]: [true, true, false],
      [plataforma_pago_luma.MOTO_EFECTIVO]: [true, false, true],
      [plataforma_pago_luma.MOTO_CREDITO]: [false, true, true],
      [plataforma_pago_luma.MOTO_EFECTIVO_CREDITO]: [true, true, true],
    }[operation.plataforma_pago];
    if (
      hasCashLike !== expected[0] ||
      hasFinancing !== expected[1] ||
      hasTradeIn !== expected[2]
    )
      throw new BadRequestException(
        'Payment components do not match the selected payment platform',
      );
    if (hasFinancing) {
      const financingTotal = components
        .filter(
          (component) =>
            component.type === tipo_componente_pago_luma.FINANCIACION,
        )
        .reduce(
          (total, component) => total.plus(component.amount),
          new Prisma.Decimal(0),
        );
      if (
        !operation.monto_credito ||
        !financingTotal.equals(operation.monto_credito)
      )
        throw new BadRequestException(
          'Financing components must equal the operation credit amount',
        );
    }
  }

  private async assertFulfillableOperation(
    tx: Prisma.TransactionClient,
    operation: OperationRecord,
  ) {
    if (operation.unidad_vehiculo_id)
      return this.assertUsableReservation(tx, operation);
    const reservation = await this.activeReservation(tx, operation.id, true);
    const supply = await tx.solicitudes_abastecimiento.findFirst({
      where: {
        operacion_id: operation.id,
        organizacion_id: operation.organizacion_id,
        estado: { not: 'CANCELADA' },
      },
      select: { id: true, disponibilidad_proveedor_id: true },
    });
    if (!supply)
      throw new ConflictException(
        'The operation requires an active stock reservation or supply request',
      );
    if (supply.disponibilidad_proveedor_id) {
      if (
        reservation?.disponibilidad_proveedor_id !==
          supply.disponibilidad_proveedor_id ||
        reservation.vence_en <= new Date()
      )
        throw new ConflictException(
          'Provider availability reservation is missing or expired',
        );
    }
    return reservation;
  }

  private async materializeProviderReservation(
    tx: Prisma.TransactionClient,
    operation: OperationRecord,
    unitId: string,
  ) {
    const providerSnapshot = operation.reservas_stock?.find(
      (reservation) =>
        reservation.estado === estado_reserva_luma.ACTIVO &&
        reservation.disponibilidad_proveedor_id !== null,
    );
    if (!providerSnapshot) return;
    const reservation = await this.activeReservation(tx, operation.id, true);
    if (
      !reservation ||
      reservation.id !== providerSnapshot.id ||
      !reservation.disponibilidad_proveedor_id
    )
      throw new ConflictException(
        'Provider reservation changed during unit assignment',
      );
    const supply = await tx.solicitudes_abastecimiento.findFirst({
      where: {
        operacion_id: operation.id,
        disponibilidad_proveedor_id: reservation.disponibilidad_proveedor_id,
        unidad_vehiculo_recibida_id: unitId,
        organizacion_id: operation.organizacion_id,
        estado: 'RECIBIDO',
      },
      select: { id: true },
    });
    if (!supply)
      throw new ConflictException(
        'The unit does not match a received supply request for this operation',
      );
    await tx.reservas_stock.update({
      where: { id: reservation.id },
      data: {
        estado: estado_reserva_luma.CONSUMIDA,
        liberado_en: new Date(),
        motivo_liberacion: 'Disponibilidad materializada en unidad física',
      },
    });
    await tx.solicitudes_abastecimiento.update({
      where: { id: supply.id },
      data: { estado: 'ASIGNADO', asignado_en: new Date() },
    });
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
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'INVENTORY_UNIT_ALREADY_RESERVED',
          message:
            'The inventory unit is already reserved by another operation',
          unitId,
        });
      await this.expireReservation(tx, existingForUnit, unit, actor);
      unit = {
        ...unit,
        estado_inventario: luma_estado_inventario.EN_STOCK,
      };
    }
    if (unit.estado_inventario !== luma_estado_inventario.EN_STOCK)
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code:
          unit.estado_inventario === luma_estado_inventario.RESERVADO
            ? 'INVENTORY_UNIT_ALREADY_RESERVED'
            : 'INVENTORY_UNIT_NOT_AVAILABLE',
        message:
          unit.estado_inventario === luma_estado_inventario.RESERVADO
            ? 'The inventory unit is already reserved by another operation'
            : 'Only EN_STOCK inventory units can be reserved',
        unitId,
        inventoryStatus: unit.estado_inventario,
      });
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
    const lockedOperation = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "public"."operaciones"
      WHERE "id" = CAST(${reservation.operacion_id} AS uuid)
        AND "organizacion_id" = CAST(${reservation.organizacion_id} AS uuid)
        AND "unidad_vehiculo_id" = CAST(${unit.id} AS uuid)
      FOR UPDATE SKIP LOCKED
    `;
    if (!lockedOperation.length)
      throw new ConflictException(
        'Expired reservation operation is being modified; retry the request',
      );
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
    const detachedOperation = await tx.operaciones.updateMany({
      where: {
        id: reservation.operacion_id,
        organizacion_id: reservation.organizacion_id,
        unidad_vehiculo_id: unit.id,
      },
      data: {
        unidad_vehiculo_id: null,
        version_fila: { increment: 1 },
      },
    });
    if (detachedOperation.count !== 1)
      throw new ConflictException(
        'Expired reservation operation assignment is inconsistent',
      );
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

  private async releaseOperationReservation(
    tx: Prisma.TransactionClient,
    operation: OperationRecord,
    reservation: {
      id: string;
      unidad_vehiculo_id: string | null;
      disponibilidad_proveedor_id: string | null;
    },
    reason: string,
    actor: AuthenticatedUser,
  ) {
    if (reservation.unidad_vehiculo_id)
      return this.releaseActiveReservation(
        tx,
        operation,
        reservation.id,
        reason,
        actor,
      );
    await tx.reservas_stock.update({
      where: { id: reservation.id },
      data: {
        estado: estado_reserva_luma.LIBERADA,
        liberado_en: new Date(),
        motivo_liberacion: reason.trim(),
      },
    });
    await tx.solicitudes_abastecimiento.updateMany({
      where: {
        operacion_id: operation.id,
        organizacion_id: operation.organizacion_id,
        estado: { notIn: ['RECIBIDO', 'ASIGNADO', 'CANCELADA'] },
      },
      data: { estado: 'CANCELADA' },
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
          AND (
            ${actor.role.code !== ROLE_CODES.VENDEDOR}
            OR EXISTS (
              SELECT 1
              FROM "public"."asignaciones_personal_operacion" AS assignment
              JOIN "public"."personal" AS staff
                ON staff."id" = assignment."personal_id"
               AND staff."organizacion_id" = assignment."organizacion_id"
              WHERE assignment."operacion_id" = "operaciones"."id"
                AND assignment."rol_asignacion" = 'VENDEDOR'
                AND staff."usuario_id" = CAST(${actor.id} AS uuid)
            )
          )
        FOR UPDATE
      `;
      if (!rows.length)
        throw new NotFoundException('Sales operation not found');
    }
    const operation = await tx.operaciones.findFirst({
      relationLoadStrategy: 'join',
      where: {
        id,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
        asignaciones_personal_operacion:
          actor.role.code === ROLE_CODES.VENDEDOR
            ? {
                some: {
                  rol_asignacion: 'VENDEDOR',
                  personal: { usuario_id: actor.id },
                },
              }
            : undefined,
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
    at: Date | string,
  ) {
    const policy = await findEffectivePricePolicy(tx, {
      versionId,
      branchId,
      organizationId,
      at,
    });
    if (!policy) throw activePricePolicyRequired(versionId, branchId);
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

  private async resolveClient(
    tx: Prisma.TransactionClient,
    input: CreateSalesOperationDto,
    organizationId: string,
  ) {
    if (Boolean(input.clientId) === Boolean(input.client))
      throw new BadRequestException(
        'Exactly one of clientId or client must be provided',
      );
    if (input.clientId) {
      await this.clientOr400(tx, input.clientId, organizationId);
      return input.clientId;
    }
    const inline = input.client!;
    const normalizedDocument = normalizeClientDocument(inline.documentNumber);
    if (!normalizedDocument)
      throw new BadRequestException(
        'Client document must contain letters or digits',
      );
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`${organizationId}:${inline.documentType}:${normalizedDocument}`},
          0
        )
      )
    `;
    const existing = await tx.clientes.findFirst({
      where: {
        organizacion_id: organizationId,
        tipo_documento: inline.documentType,
        documento_normalizado: normalizedDocument,
      },
      select: { id: true, activo: true },
    });
    if (existing && !existing.activo)
      throw new ConflictException('A matching client exists but is inactive');
    if (existing) {
      await tx.clientes.update({
        where: { id: existing.id },
        data: {
          numero_documento: inline.documentNumber,
          nombre_completo: inline.fullName,
          nombre_normalizado: normalizeClientName(inline.fullName),
          telefono: inline.phone,
        },
      });
      return existing.id;
    }
    const created = await tx.clientes.create({
      data: {
        tipo_documento: inline.documentType,
        numero_documento: inline.documentNumber,
        documento_normalizado: normalizedDocument,
        nombre_completo: inline.fullName,
        nombre_normalizado: normalizeClientName(inline.fullName),
        telefono: inline.phone,
        organizacion_id: organizationId,
      },
      select: { id: true },
    });
    return created.id;
  }

  private async versionOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
    vehicleType?: tipo_vehiculo_luma,
  ) {
    const version = await tx.versiones_vehiculos.findUnique({
      where: { id },
      include: {
        catalogo_organizaciones: true,
        modelos_vehiculos: { select: { tipo_vehiculo: true } },
      },
    });
    if (
      !version ||
      (version.alcance !== 'GLOBAL' &&
        version.organizacion_propietaria_id !== organizationId &&
        !version.catalogo_organizaciones.some(
          (item) => item.organizacion_id === organizationId,
        )) ||
      (vehicleType && version.modelos_vehiculos.tipo_vehiculo !== vehicleType)
    )
      throw new BadRequestException(
        'Version is not available to the organization',
      );
  }

  private async sellerOr400(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
    assignmentRole: SalesAssignmentRole = SalesAssignmentRole.VENDEDOR,
  ) {
    const seller = await tx.personal.findFirst({
      where: {
        id,
        organizacion_id: organizationId,
        estado: 'ACTIVO',
        roles:
          assignmentRole === SalesAssignmentRole.VENDEDOR
            ? { activo: true, codigo: ROLE_CODES.VENDEDOR }
            : undefined,
      },
      select: { id: true },
    });
    if (!seller)
      throw new BadRequestException({
        statusCode: 400,
        code:
          assignmentRole === SalesAssignmentRole.VENDEDOR
            ? 'INVALID_OPERATION_SELLER'
            : 'INVALID_OPERATION_CONTACT',
        message:
          assignmentRole === SalesAssignmentRole.VENDEDOR
            ? 'Seller must be active and belong to the operation organization'
            : 'Contact must be active and belong to the operation organization',
        error: 'Bad Request',
      });
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
    const seller = item.asignaciones_personal_operacion.find(
      (assignment) => assignment.rol_asignacion === 'VENDEDOR',
    )?.personal;
    const contact = item.asignaciones_personal_operacion.find(
      (assignment) => assignment.rol_asignacion === 'CONTACTO',
    )?.personal;
    const reservation = item.reservas_stock[0];
    const approval = item.aprobaciones_operacion[0];
    const supplyRequest = item.solicitudes_abastecimiento?.[0];
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
      papersDelivered: item.documentacion_entregada_en !== null,
      papersDeliveredAt: item.documentacion_entregada_en,
      debt: item.debe,
      month: item.fecha_operacion.toISOString().slice(0, 7),
      listPrice: item.precio_lista?.toString() ?? null,
      minimumPrice: item.precio_minimo?.toString() ?? null,
      agreedPrice: item.precio_acordado.toString(),
      currency: item.moneda,
      paymentPlatform: item.plataforma_pago,
      creditAmount: item.monto_credito?.toString() ?? null,
      guarantor: item.respaldo_garante,
      notes: item.notas,
      rowVersion: item.version_fila,
      organizationId: item.organizacion_id,
      createdAt: item.creado_en,
      updatedAt: item.actualizado_en,
      client: {
        id: item.clientes.id,
        documentType: item.clientes.tipo_documento,
        documentNumber: item.clientes.numero_documento,
        fullName: item.clientes.nombre_completo,
        phone: item.clientes.telefono,
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
              acquisitionOrigin: currentUnit.origen_adquisicion,
              supplier: currentUnit.proveedores
                ? {
                    id: currentUnit.proveedores.id,
                    legalName: currentUnit.proveedores.razon_social,
                  }
                : null,
            }
          : null,
        chassis: currentUnit?.vin_mostrado ?? null,
      },
      seller: seller
        ? { id: seller.id, fullName: seller.nombre_completo }
        : null,
      contact: contact
        ? { id: contact.id, fullName: contact.nombre_completo }
        : null,
      createdBy: item.personal
        ? {
            id: item.personal.id,
            fullName: item.personal.nombre_completo,
          }
        : null,
      reservation: reservation
        ? {
            id: reservation.id,
            unitId: reservation.unidad_vehiculo_id,
            supplierAvailabilityId: reservation.disponibilidad_proveedor_id,
            status: reservation.estado,
            quantity: reservation.cantidad,
            expiresAt: reservation.vence_en,
            releasedAt: reservation.liberado_en,
            releaseReason: reservation.motivo_liberacion,
          }
        : null,
      supply: supplyRequest
        ? {
            id: supplyRequest.id,
            status: supplyRequest.estado,
            supplier: {
              id: supplyRequest.proveedores.id,
              legalName: supplyRequest.proveedores.razon_social,
            },
            destinationBranch: {
              id: supplyRequest.sucursales.id,
              code: supplyRequest.sucursales.codigo,
              name: supplyRequest.sucursales.nombre,
            },
            supplierReference: supplyRequest.referencia_proveedor,
            notes: supplyRequest.notas,
          }
        : null,
      paymentComponents: (item.componentes_pago_operacion ?? []).map(
        (component) => ({
          id: component.id,
          type: component.tipo_componente,
          expectedAmount: component.importe_esperado.toString(),
          dueDate: component.fecha_vencimiento,
          financialInstitutionId: component.financiera_id,
          creditInquiryId: component.consulta_crediticia_id,
          tradeInVehicleId: component.vehiculo_tomado_id,
          paymentStatus: component.estado_pago,
          notes: component.notas,
        }),
      ),
      tradeIns: (item.vehiculos_tomados_parte_pago ?? []).map((tradeIn) => ({
        id: tradeIn.id,
        versionId: tradeIn.version_id,
        description: tradeIn.descripcion_original,
        vin: tradeIn.vin_mostrado,
        engineNumber: tradeIn.numero_motor,
        licensePlate: tradeIn.patente,
        year: tradeIn.anio_fabricacion,
        kilometers: tradeIn.kilometraje_km,
        appraisedAmount: tradeIn.importe_tasado.toString(),
        acceptedAmount: tradeIn.importe_aceptado?.toString() ?? null,
        status: tradeIn.estado,
      })),
      obligations: (item.obligaciones_operacion ?? []).map((obligation) => ({
        id: obligation.id,
        type: obligation.tipo_obligacion,
        status: obligation.estado,
        amount: obligation.importe?.toString() ?? null,
        dueDate: obligation.fecha_vencimiento,
        fulfilledAt: obligation.resuelto_en,
        notes: obligation.descripcion,
      })),
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

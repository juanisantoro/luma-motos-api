import {
  BadRequestException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditService,
  type AuthenticatedAuditEvent,
} from '../audit/audit.service';
import { ROLE_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { apiError } from '../common/api-error';
import { PrismaService, type TenantScope } from '../prisma/prisma.service';
import { CloneRoleDto } from './dto/clone-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { RoleListQueryDto } from './dto/role-list-query.dto';
import { UpdateRoleStatusDto } from './dto/update-role-status.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import {
  ADMINISTRATOR_REQUIRED_PERMISSIONS,
  PERMISSION_MODULE_LABELS,
  ROLE_AUDIT_ACTIONS,
  SYSTEM_ROLE_CODES,
} from './roles.constants';

const roleSelect = {
  id: true,
  codigo: true,
  nombre: true,
  descripcion: true,
  activo: true,
  es_sistema: true,
  version: true,
  organizacion_id: true,
  creado_en: true,
  actualizado_en: true,
  organizaciones: {
    select: {
      id: true,
      codigo: true,
      nombre: true,
      tipo: true,
    },
  },
  permisos_rol: {
    orderBy: {
      codigo_permiso: 'asc',
    },
    select: {
      permisos: {
        select: {
          codigo: true,
          modulo: true,
          descripcion: true,
        },
      },
    },
  },
  _count: {
    select: {
      usuarios: true,
    },
  },
} satisfies Prisma.RoleSelect;

type ManagedRole = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: RoleListQueryDto, actor: AuthenticatedUser) {
    this.assertOrganizationAccess(actor, query.organizationId);
    const organizationId = query.organizationId ?? actor.organization.id;
    const where: Prisma.RoleWhereInput = {
      activo: query.active,
      OR: [
        { es_sistema: true, organizacion_id: null },
        { es_sistema: false, organizacion_id: organizationId },
      ],
      AND: query.search
        ? [
            {
              OR: [
                {
                  codigo: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
                {
                  nombre: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              ],
            },
          ]
        : undefined,
    };
    const skip = (query.page - 1) * query.limit;
    const [total, roles] = await this.prisma.withTenant(
      this.scope(actor),
      (transaction) =>
        Promise.all([
          transaction.role.count({ where }),
          transaction.role.findMany({
            where,
            select: roleSelect,
            orderBy: [{ es_sistema: 'desc' }, { nombre: 'asc' }, { id: 'asc' }],
            skip,
            take: query.limit,
          }),
        ]),
    );

    return {
      items: roles.map((role) => this.toResponse(role, actor)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const role = await this.prisma.withTenant(
      this.scope(actor),
      (transaction) => this.findManagedRole(transaction, id, actor),
    );
    return this.toResponse(role, actor);
  }

  async findPermissions(actor: AuthenticatedUser) {
    const permissions = await this.prisma.withTenant(
      this.scope(actor),
      (transaction) =>
        transaction.permisos.findMany({
          orderBy: [{ modulo: 'asc' }, { codigo: 'asc' }],
          select: {
            codigo: true,
            modulo: true,
            descripcion: true,
          },
        }),
    );
    const groups = new Map<
      string,
      Array<{ code: string; description: string }>
    >();
    for (const permission of permissions) {
      const entries = groups.get(permission.modulo) ?? [];
      entries.push({
        code: permission.codigo,
        description: permission.descripcion,
      });
      groups.set(permission.modulo, entries);
    }

    return [...groups].map(([module, entries]) => ({
      module,
      label: PERMISSION_MODULE_LABELS[module] ?? module,
      permissions: entries,
    }));
  }

  async create(input: CreateRoleDto, actor: AuthenticatedUser) {
    const organizationId = input.organizationId ?? actor.organization.id;
    this.assertOrganizationAccess(actor, organizationId);
    const code = input.code ?? this.generateCode(input.name);
    if ((SYSTEM_ROLE_CODES as readonly string[]).includes(code)) {
      throw apiError(
        HttpStatus.CONFLICT,
        'ROLE_CODE_ALREADY_EXISTS',
        'Role code already exists',
      );
    }
    const auditEvent: AuthenticatedAuditEvent = {
      action: ROLE_AUDIT_ACTIONS.CREATED,
      entity: 'roles',
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId: this.targetOrganization(actor, organizationId),
      metadata: {
        code,
        name: input.name,
        permissionCodes: input.permissionCodes,
      },
    };

    try {
      return await this.auditService.execute(
        auditEvent,
        async (transaction) => {
          await this.requireOrganization(transaction, organizationId);
          await this.assertUniqueIdentity(
            transaction,
            organizationId,
            code,
            input.name,
          );
          await this.requirePermissionCodes(transaction, input.permissionCodes);
          const role = await transaction.role.create({
            data: {
              codigo: code,
              nombre: input.name,
              descripcion: input.description,
              organizacion_id: organizationId,
              es_sistema: false,
              permisos_rol: {
                createMany: {
                  data: input.permissionCodes.map((permissionCode) => ({
                    codigo_permiso: permissionCode,
                  })),
                },
              },
            },
            select: roleSelect,
          });
          auditEvent.entityId = role.id;
          return this.toResponse(role, actor);
        },
      );
    } catch (error: unknown) {
      this.mapUniqueError(error);
    }
  }

  async update(id: string, input: UpdateRoleDto, actor: AuthenticatedUser) {
    if (
      input.name === undefined &&
      input.description === undefined &&
      input.permissionCodes === undefined
    ) {
      throw new BadRequestException('At least one role field is required');
    }
    const current = await this.prisma.withTenant(
      this.scope(actor),
      (transaction) => this.findManagedRole(transaction, id, actor),
    );
    this.assertRoleManageable(current, actor);
    const permissionCodes =
      input.permissionCodes ??
      current.permisos_rol.map((entry) => entry.permisos.codigo);
    this.assertSystemRolePermissions(current, permissionCodes);
    const permissionsChanged =
      input.permissionCodes !== undefined &&
      (permissionCodes.length !== current.permisos_rol.length ||
        permissionCodes.some(
          (code) =>
            !current.permisos_rol.some(
              (entry) => entry.permisos.codigo === code,
            ),
        ));
    const auditEvent: AuthenticatedAuditEvent = {
      action: ROLE_AUDIT_ACTIONS.UPDATED,
      entity: 'roles',
      entityId: current.id,
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId: current.organizacion_id
        ? this.targetOrganization(actor, current.organizacion_id)
        : undefined,
      previousData: {
        name: current.nombre,
        description: current.descripcion,
        permissionCodes: current.permisos_rol.map(
          (entry) => entry.permisos.codigo,
        ),
        version: current.version,
      },
      metadata: {
        name: input.name ?? current.nombre,
        description: input.description ?? current.descripcion,
        permissionCodes,
        version: input.version + 1,
      },
    };

    try {
      return await this.auditService.execute(
        auditEvent,
        async (transaction) => {
          if (input.name) {
            await this.assertUniqueIdentity(
              transaction,
              current.organizacion_id,
              current.codigo,
              input.name,
              current.id,
            );
          }
          await this.requirePermissionCodes(transaction, permissionCodes);
          const updated = await transaction.role.updateMany({
            where: {
              id: current.id,
              version: input.version,
            },
            data: {
              nombre: input.name,
              descripcion: input.description,
              version: {
                increment: 1,
              },
            },
          });
          if (updated.count !== 1) {
            throw apiError(
              HttpStatus.CONFLICT,
              'VERSION_CONFLICT',
              'Role was modified by another request',
            );
          }

          let revokedSessions = 0;
          if (permissionsChanged) {
            await transaction.permisos_rol.deleteMany({
              where: { rol_id: current.id },
            });
            if (permissionCodes.length > 0) {
              await transaction.permisos_rol.createMany({
                data: permissionCodes.map((permissionCode) => ({
                  rol_id: current.id,
                  codigo_permiso: permissionCode,
                })),
              });
            }
            revokedSessions = await this.revokeRoleSessions(
              transaction,
              current.id,
            );
          }
          const role = await transaction.role.findUniqueOrThrow({
            where: { id: current.id },
            select: roleSelect,
          });
          return {
            role: this.toResponse(role, actor),
            revokedSessions,
          };
        },
      );
    } catch (error: unknown) {
      this.mapUniqueError(error);
    }
  }

  async updateStatus(
    id: string,
    input: UpdateRoleStatusDto,
    actor: AuthenticatedUser,
  ) {
    const current = await this.prisma.withTenant(
      this.scope(actor),
      (transaction) => this.findManagedRole(transaction, id, actor),
    );
    this.assertRoleManageable(current, actor);
    if (current.es_sistema) {
      throw apiError(
        HttpStatus.CONFLICT,
        'SYSTEM_ROLE_PROTECTED',
        'System roles cannot be deactivated',
      );
    }
    if (current.activo === input.active) {
      throw new BadRequestException('The role already has that status');
    }
    if (!input.active && current._count.usuarios > 0) {
      throw apiError(
        HttpStatus.CONFLICT,
        'ROLE_HAS_ACTIVE_USERS',
        'Reassign every user before deactivating this role',
        { userCount: current._count.usuarios },
      );
    }

    return this.auditService.execute(
      {
        action: ROLE_AUDIT_ACTIONS.STATUS_UPDATED,
        entity: 'roles',
        entityId: current.id,
        actorId: actor.id,
        organizationId: actor.organization.id,
        globalAccess: actor.globalAccess,
        previousData: {
          active: current.activo,
          version: current.version,
        },
        metadata: {
          active: input.active,
          version: input.version + 1,
        },
      },
      async (transaction) => {
        const updated = await transaction.role.updateMany({
          where: {
            id: current.id,
            version: input.version,
          },
          data: {
            activo: input.active,
            version: {
              increment: 1,
            },
          },
        });
        if (updated.count !== 1) {
          throw apiError(
            HttpStatus.CONFLICT,
            'VERSION_CONFLICT',
            'Role was modified by another request',
          );
        }
        const role = await transaction.role.findUniqueOrThrow({
          where: { id: current.id },
          select: roleSelect,
        });
        return this.toResponse(role, actor);
      },
    );
  }

  async clone(id: string, input: CloneRoleDto, actor: AuthenticatedUser) {
    const source = await this.prisma.withTenant(
      this.scope(actor),
      (transaction) => this.findManagedRole(transaction, id, actor),
    );
    const organizationId = input.organizationId ?? actor.organization.id;
    const cloned = await this.create(
      {
        name: input.name,
        code: input.code,
        description: source.descripcion,
        permissionCodes: source.permisos_rol.map(
          (entry) => entry.permisos.codigo,
        ),
        organizationId,
      },
      actor,
    );
    await this.auditService.record({
      action: ROLE_AUDIT_ACTIONS.CLONED,
      entity: 'roles',
      entityId: cloned.id,
      actorId: actor.id,
      organizationId: actor.organization.id,
      targetOrganizationId: this.targetOrganization(actor, organizationId),
      metadata: {
        sourceRoleId: source.id,
      },
    });
    return cloned;
  }

  private scope(actor: AuthenticatedUser): TenantScope {
    return {
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
    };
  }

  private async findManagedRole(
    transaction: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<ManagedRole> {
    const role = await transaction.role.findFirst({
      where: {
        id,
        OR: [
          { es_sistema: true, organizacion_id: null },
          {
            es_sistema: false,
            organizacion_id: actor.globalAccess
              ? undefined
              : actor.organization.id,
          },
        ],
      },
      select: roleSelect,
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }

  private assertRoleManageable(
    role: ManagedRole,
    actor: AuthenticatedUser,
  ): void {
    if (role.es_sistema && !actor.globalAccess) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SYSTEM_ROLE_PROTECTED',
        'Only a global administrator can modify system roles',
      );
    }
    if (
      role.organizacion_id &&
      !actor.globalAccess &&
      role.organizacion_id !== actor.organization.id
    ) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'CROSS_TENANT_ACCESS',
        'Role belongs to another organization',
      );
    }
  }

  private assertSystemRolePermissions(
    role: ManagedRole,
    permissionCodes: string[],
  ): void {
    if (
      role.es_sistema &&
      role.codigo === ROLE_CODES.ADMINISTRADOR &&
      ADMINISTRATOR_REQUIRED_PERMISSIONS.some(
        (required) => !permissionCodes.includes(required),
      )
    ) {
      throw apiError(
        HttpStatus.CONFLICT,
        'SYSTEM_ROLE_PROTECTED',
        'Administrator role must retain user and role administration permissions',
      );
    }
  }

  private async requireOrganization(
    transaction: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<void> {
    const organization = await transaction.organizaciones.findFirst({
      where: {
        id: organizationId,
        activa: true,
      },
      select: { id: true },
    });
    if (!organization) {
      throw new BadRequestException('Organization is invalid or inactive');
    }
  }

  private async requirePermissionCodes(
    transaction: Prisma.TransactionClient,
    permissionCodes: string[],
  ): Promise<void> {
    const existing = await transaction.permisos.findMany({
      where: {
        codigo: {
          in: permissionCodes,
        },
      },
      select: {
        codigo: true,
      },
    });
    const existingCodes = new Set(existing.map((entry) => entry.codigo));
    const invalidCodes = permissionCodes.filter(
      (code) => !existingCodes.has(code),
    );
    if (invalidCodes.length > 0) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_PERMISSION_CODES',
        'One or more permission codes do not exist',
        { invalidCodes },
      );
    }
  }

  private async assertUniqueIdentity(
    transaction: Prisma.TransactionClient,
    organizationId: string | null,
    code: string,
    name: string,
    ignoredId?: string,
  ): Promise<void> {
    const [codeConflict, nameConflict] = await Promise.all([
      transaction.role.findFirst({
        where: {
          id: ignoredId ? { not: ignoredId } : undefined,
          codigo: code,
          OR: [
            { organizacion_id: organizationId },
            { es_sistema: true, organizacion_id: null },
          ],
        },
        select: { id: true },
      }),
      transaction.role.findFirst({
        where: {
          id: ignoredId ? { not: ignoredId } : undefined,
          nombre: {
            equals: name,
            mode: 'insensitive',
          },
          OR: [
            { organizacion_id: organizationId },
            { es_sistema: true, organizacion_id: null },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (codeConflict) {
      throw apiError(
        HttpStatus.CONFLICT,
        'ROLE_CODE_ALREADY_EXISTS',
        'Role code already exists',
      );
    }
    if (nameConflict) {
      throw apiError(
        HttpStatus.CONFLICT,
        'ROLE_NAME_ALREADY_EXISTS',
        'Role name already exists',
      );
    }
  }

  private async revokeRoleSessions(
    transaction: Prisma.TransactionClient,
    roleId: string,
  ): Promise<number> {
    const users = await transaction.usuarios.findMany({
      where: {
        rol_id: roleId,
      },
      select: {
        id: true,
      },
    });
    if (users.length === 0) {
      return 0;
    }
    const result = await transaction.authSession.updateMany({
      where: {
        userId: {
          in: users.map((user) => user.id),
        },
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
    return result.count;
  }

  private assertOrganizationAccess(
    actor: AuthenticatedUser,
    organizationId?: string,
  ): void {
    if (
      organizationId &&
      !actor.globalAccess &&
      organizationId !== actor.organization.id
    ) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'CROSS_TENANT_ACCESS',
        'You cannot manage roles from another organization',
      );
    }
  }

  private targetOrganization(
    actor: AuthenticatedUser,
    organizationId: string,
  ): string | undefined {
    return organizationId === actor.organization.id
      ? undefined
      : organizationId;
  }

  private generateCode(name: string): string {
    const code = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 50);
    if (code.length < 3 || !/^[A-Z]/.test(code)) {
      throw new BadRequestException(
        'Role name cannot produce a valid stable code',
      );
    }
    return code;
  }

  private mapUniqueError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const rawTarget = error.meta?.target;
      const target = Array.isArray(rawTarget)
        ? rawTarget
            .filter((entry): entry is string => typeof entry === 'string')
            .join(',')
        : typeof rawTarget === 'string'
          ? rawTarget
          : '';
      throw apiError(
        HttpStatus.CONFLICT,
        target.includes('nombre')
          ? 'ROLE_NAME_ALREADY_EXISTS'
          : 'ROLE_CODE_ALREADY_EXISTS',
        target.includes('nombre')
          ? 'Role name already exists'
          : 'Role code already exists',
      );
    }
    throw error;
  }

  private toResponse(role: ManagedRole, actor: AuthenticatedUser) {
    const canEdit = !role.es_sistema || actor.globalAccess;
    return {
      id: role.id,
      code: role.codigo,
      name: role.nombre,
      description: role.descripcion,
      active: role.activo,
      system: role.es_sistema,
      version: role.version,
      userCount: role._count.usuarios,
      createdAt: role.creado_en,
      updatedAt: role.actualizado_en,
      organization: role.organizaciones
        ? {
            id: role.organizaciones.id,
            code: role.organizaciones.codigo,
            name: role.organizaciones.nombre,
            type: role.organizaciones.tipo,
          }
        : null,
      permissions: role.permisos_rol.map((entry) => ({
        code: entry.permisos.codigo,
        module: entry.permisos.modulo,
        description: entry.permisos.descripcion,
      })),
      actions: {
        canEdit,
        canChangeStatus: canEdit && !role.es_sistema,
        canClone: true,
      },
    };
  }
}

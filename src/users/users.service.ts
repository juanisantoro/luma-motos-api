import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  AuditService,
  type AuthenticatedAuditEvent,
} from '../audit/audit.service';
import { ROLE_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { hashPassword } from '../auth/password-hashing';
import { createTemporaryPassword } from '../auth/temporary-password';
import { EnvironmentVariables } from '../config/environment';
import { MailService } from '../mail/mail.service';
import { apiError } from '../common/api-error';
import { PrismaService, type TenantScope } from '../prisma/prisma.service';
import { BranchListQueryDto } from './dto/branch-list-query.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserAccessDto } from './dto/update-user-access.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UserListQueryDto } from './dto/user-list-query.dto';
import { USER_AUDIT_ACTIONS } from './users.constants';

const managedUserSelect = {
  id: true,
  correo: true,
  activo: true,
  acceso_global: true,
  creado_en: true,
  actualizado_en: true,
  ultimo_inicio_sesion_en: true,
  contrasena_configurada_en: true,
  contrasena_temporal_vence_en: true,
  estado_invitacion: true,
  invitacion_ultimo_intento_en: true,
  invitacion_enviada_en: true,
  invitacion_aceptada_en: true,
  invitacion_error: true,
  invitacion_version: true,
  organizacion_id: true,
  organizaciones: {
    select: {
      id: true,
      codigo: true,
      nombre: true,
      tipo: true,
      activa: true,
    },
  },
  roles: {
    select: {
      id: true,
      codigo: true,
      nombre: true,
      activo: true,
      es_sistema: true,
      version: true,
      permisos_rol: {
        orderBy: {
          codigo_permiso: 'asc',
        },
        select: {
          codigo_permiso: true,
        },
      },
    },
  },
  sucursales: {
    select: {
      id: true,
      codigo: true,
      nombre: true,
      activa: true,
    },
  },
  personal: {
    select: {
      id: true,
      codigo_empleado: true,
      nombre_completo: true,
      telefono: true,
      puede_iniciar_sesion: true,
      estado: true,
    },
  },
} satisfies Prisma.usuariosSelect;

type ManagedUser = Prisma.usuariosGetPayload<{
  select: typeof managedUserSelect;
}>;

@Injectable()
export class UsersService {
  private readonly temporaryPasswordTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.temporaryPasswordTtlSeconds = config.get(
      'USER_TEMPORARY_PASSWORD_TTL_SECONDS',
      { infer: true },
    );
  }

  async findAll(query: UserListQueryDto, actor: AuthenticatedUser) {
    this.assertOrganizationAccess(actor, query.organizationId);
    const scope = this.scope(actor);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);
    const normalizedSearch = query.search?.toLocaleLowerCase('es-AR');
    const where: Prisma.usuariosWhereInput = {
      activo: query.active,
      organizacion_id: organizationId,
      sucursal_id: query.branchId,
      roles: query.roleCode
        ? {
            codigo: query.roleCode,
          }
        : undefined,
      OR: normalizedSearch
        ? [
            {
              correo_normalizado: {
                contains: normalizedSearch,
                mode: 'insensitive',
              },
            },
            {
              personal: {
                is: {
                  nombre_normalizado: {
                    contains: normalizedSearch,
                    mode: 'insensitive',
                  },
                },
              },
            },
          ]
        : undefined,
      AND:
        query.invitationStatus === 'EXPIRED'
          ? [
              {
                contrasena_configurada_en: null,
                contrasena_temporal_vence_en: {
                  lte: new Date(),
                },
              },
            ]
          : query.invitationStatus
            ? [
                {
                  estado_invitacion: query.invitationStatus,
                },
                ...(query.invitationStatus === 'ACCEPTED'
                  ? []
                  : [
                      {
                        OR: [
                          { contrasena_temporal_vence_en: null },
                          {
                            contrasena_temporal_vence_en: {
                              gt: new Date(),
                            },
                          },
                        ],
                      },
                    ]),
              ]
            : undefined,
    };
    const skip = (query.page - 1) * query.limit;
    const [total, users] = await this.prisma.withTenant(scope, (transaction) =>
      Promise.all([
        transaction.usuarios.count({ where }),
        transaction.usuarios.findMany({
          where,
          select: managedUserSelect,
          orderBy: [{ creado_en: 'desc' }, { id: 'desc' }],
          skip,
          take: query.limit,
        }),
      ]),
    );

    return {
      items: users.map((user) => this.toResponse(user)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const user = await this.prisma.withTenant(
      this.scope(actor),
      (transaction) => this.findManagedUser(transaction, id, actor),
    );
    return this.toResponse(user);
  }

  async create(input: CreateUserDto, actor: AuthenticatedUser) {
    this.assertOrganizationAccess(actor, input.organizationId);
    const temporaryPassword = createTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const expiresAt = new Date(
      Date.now() + this.temporaryPasswordTtlSeconds * 1_000,
    );
    const auditEvent: AuthenticatedAuditEvent = {
      action: USER_AUDIT_ACTIONS.CREATED,
      entity: 'usuarios',
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId: this.targetOrganization(
        actor,
        input.organizationId,
      ),
      metadata: {
        organizationId: input.organizationId,
        roleCode: input.roleCode,
        branchId: input.branchId ?? null,
        globalAccess: input.globalAccess,
      },
    };

    try {
      const user = await this.auditService.execute(
        auditEvent,
        async (transaction) => {
          const organization = await this.requireOrganization(
            transaction,
            input.organizationId,
          );
          const role = await this.requireRole(
            transaction,
            input.roleCode,
            input.organizationId,
          );
          const branch = await this.requireBranch(
            transaction,
            input.branchId,
            input.organizationId,
          );
          this.assertGlobalAccessAssignment(
            actor,
            input.globalAccess,
            organization.tipo,
            role.codigo,
          );

          const created = await transaction.usuarios.create({
            data: {
              correo: input.email,
              correo_normalizado: input.email,
              hash_contrasena: passwordHash,
              activo: true,
              acceso_global: input.globalAccess,
              organizacion_id: input.organizationId,
              rol_id: role.id,
              sucursal_id: branch?.id,
              contrasena_temporal_vence_en: expiresAt,
              estado_invitacion: 'PENDING',
              invitacion_ultimo_intento_en: new Date(),
            },
            select: {
              id: true,
            },
          });
          auditEvent.entityId = created.id;

          const personnel = await transaction.personal.create({
            data: {
              usuario_id: created.id,
              codigo_empleado: input.employeeCode,
              nombre_completo: input.fullName,
              nombre_normalizado: this.normalizeName(input.fullName),
              correo_normalizado: input.email,
              telefono: input.phone,
              sucursal_principal_id: branch?.id,
              rol_id: role.id,
              puede_iniciar_sesion: true,
              estado: 'ACTIVO',
              organizacion_id: input.organizationId,
            },
            select: {
              id: true,
            },
          });

          if (branch) {
            await transaction.acceso_personal_sucursal.create({
              data: {
                personal_id: personnel.id,
                sucursal_id: branch.id,
                organizacion_id: input.organizationId,
              },
            });
          }

          return transaction.usuarios.findUniqueOrThrow({
            where: {
              id_organizacion_id: {
                id: created.id,
                organizacion_id: input.organizationId,
              },
            },
            select: managedUserSelect,
          });
        },
      );

      const deliveredUser = await this.sendTemporaryPassword(
        user,
        actor,
        temporaryPassword,
        expiresAt,
        'creation',
      );
      return {
        user: this.toResponse(deliveredUser),
        delivery: {
          status: 'DELIVERED' as const,
          sent: true,
          expiresAt,
        },
      };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A user with that email already exists');
      }
      throw error;
    }
  }

  async updateAccess(
    id: string,
    input: UpdateUserAccessDto,
    actor: AuthenticatedUser,
  ) {
    if (
      input.roleCode === undefined &&
      input.branchId === undefined &&
      input.globalAccess === undefined
    ) {
      throw new BadRequestException('At least one access field is required');
    }

    const current = await this.prisma.withTenant(
      this.scope(actor),
      (transaction) => this.findManagedUser(transaction, id, actor),
    );
    if (
      current.id === actor.id &&
      (input.roleCode !== undefined || input.globalAccess !== undefined)
    ) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SELF_ADMIN_ACCESS_CHANGE_FORBIDDEN',
        'You cannot change your own role or global access',
      );
    }

    const newRoleCode = input.roleCode ?? current.roles?.codigo;
    if (!newRoleCode) {
      throw new ConflictException('The user does not have a valid role');
    }
    const newBranchId =
      input.branchId === undefined
        ? (current.sucursales?.id ?? null)
        : input.branchId;
    const newGlobalAccess = input.globalAccess ?? current.acceso_global;
    const roleChanged = newRoleCode !== current.roles?.codigo;
    const branchChanged = newBranchId !== (current.sucursales?.id ?? null);
    const globalAccessChanged = newGlobalAccess !== current.acceso_global;

    if (!roleChanged && !branchChanged && !globalAccessChanged) {
      throw new BadRequestException('The request does not change user access');
    }

    const auditEvent: AuthenticatedAuditEvent = {
      action: USER_AUDIT_ACTIONS.ACCESS_UPDATED,
      entity: 'usuarios',
      entityId: current.id,
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId: this.targetOrganization(
        actor,
        current.organizacion_id,
      ),
      previousData: {
        roleCode: current.roles?.codigo ?? null,
        branchId: current.sucursales?.id ?? null,
        globalAccess: current.acceso_global,
      },
      metadata: {
        roleCode: newRoleCode,
        branchId: newBranchId,
        globalAccess: newGlobalAccess,
      },
    };

    return this.auditService.execute(auditEvent, async (transaction) => {
      await this.assertLastGlobalAdministrator(
        transaction,
        current,
        newRoleCode,
        current.activo,
        Boolean(current.contrasena_configurada_en),
        actor,
      );
      const role = await this.requireRole(
        transaction,
        newRoleCode,
        current.organizacion_id,
      );
      const branch = await this.requireBranch(
        transaction,
        newBranchId ?? undefined,
        current.organizacion_id,
      );
      const organization = await this.requireOrganization(
        transaction,
        current.organizacion_id,
      );
      this.assertGlobalAccessAssignment(
        actor,
        newGlobalAccess,
        organization.tipo,
        role.codigo,
      );

      await transaction.usuarios.update({
        where: {
          id_organizacion_id: {
            id: current.id,
            organizacion_id: current.organizacion_id,
          },
        },
        data: {
          rol_id: role.id,
          sucursal_id: branch?.id ?? null,
          acceso_global: newGlobalAccess,
        },
      });
      const personnel = await transaction.personal.update({
        where: {
          usuario_id: current.id,
        },
        data: {
          rol_id: role.id,
          sucursal_principal_id: branch?.id ?? null,
        },
        select: {
          id: true,
        },
      });

      if (branchChanged) {
        await transaction.acceso_personal_sucursal.deleteMany({
          where: {
            personal_id: personnel.id,
          },
        });
        if (branch) {
          await transaction.acceso_personal_sucursal.create({
            data: {
              personal_id: personnel.id,
              sucursal_id: branch.id,
              organizacion_id: current.organizacion_id,
            },
          });
        }
      }

      const revokedSessions = await this.revokeSessions(
        transaction,
        current.id,
      );
      const user = await transaction.usuarios.findUniqueOrThrow({
        where: {
          id_organizacion_id: {
            id: current.id,
            organizacion_id: current.organizacion_id,
          },
        },
        select: managedUserSelect,
      });

      return {
        user: this.toResponse(user),
        revokedSessions,
      };
    });
  }

  async updateStatus(
    id: string,
    input: UpdateUserStatusDto,
    actor: AuthenticatedUser,
  ) {
    const current = await this.prisma.withTenant(
      this.scope(actor),
      (transaction) => this.findManagedUser(transaction, id, actor),
    );
    if (current.activo === input.active) {
      throw new BadRequestException('The user already has that status');
    }
    if (current.id === actor.id && !input.active) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SELF_ADMIN_ACCESS_CHANGE_FORBIDDEN',
        'You cannot deactivate your own account',
      );
    }
    if (input.active && !current.contrasena_configurada_en) {
      throw new ConflictException(
        'The user must change the temporary password first',
      );
    }

    return this.auditService.execute(
      {
        action: USER_AUDIT_ACTIONS.STATUS_UPDATED,
        entity: 'usuarios',
        entityId: current.id,
        actorId: actor.id,
        organizationId: actor.organization.id,
        globalAccess: actor.globalAccess,
        targetOrganizationId: this.targetOrganization(
          actor,
          current.organizacion_id,
        ),
        previousData: {
          active: current.activo,
        },
        metadata: {
          active: input.active,
        },
      },
      async (transaction) => {
        await this.assertLastGlobalAdministrator(
          transaction,
          current,
          current.roles?.codigo ?? '',
          input.active,
          Boolean(current.contrasena_configurada_en),
          actor,
        );
        await transaction.usuarios.update({
          where: {
            id_organizacion_id: {
              id: current.id,
              organizacion_id: current.organizacion_id,
            },
          },
          data: {
            activo: input.active,
          },
        });
        await transaction.personal.update({
          where: {
            usuario_id: current.id,
          },
          data: {
            puede_iniciar_sesion: input.active,
            estado: input.active ? 'ACTIVO' : 'INACTIVO',
          },
        });
        const revokedSessions = await this.revokeSessions(
          transaction,
          current.id,
        );
        const user = await transaction.usuarios.findUniqueOrThrow({
          where: {
            id_organizacion_id: {
              id: current.id,
              organizacion_id: current.organizacion_id,
            },
          },
          select: managedUserSelect,
        });

        return {
          user: this.toResponse(user),
          revokedSessions,
        };
      },
    );
  }

  async resetTemporaryPassword(id: string, actor: AuthenticatedUser) {
    const current = await this.prisma.withTenant(
      this.scope(actor),
      (transaction) => this.findManagedUser(transaction, id, actor),
    );
    const temporaryPassword = createTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const expiresAt = new Date(
      Date.now() + this.temporaryPasswordTtlSeconds * 1_000,
    );

    const user = await this.auditService.execute(
      {
        action: USER_AUDIT_ACTIONS.TEMPORARY_PASSWORD_REISSUED,
        entity: 'usuarios',
        entityId: current.id,
        actorId: actor.id,
        organizationId: actor.organization.id,
        globalAccess: actor.globalAccess,
        targetOrganizationId: this.targetOrganization(
          actor,
          current.organizacion_id,
        ),
        metadata: {
          expiresAt: expiresAt.toISOString(),
        },
      },
      async (transaction) => {
        await this.assertLastGlobalAdministrator(
          transaction,
          current,
          current.roles?.codigo ?? '',
          current.activo,
          false,
          actor,
        );
        await transaction.usuarios.update({
          where: {
            id_organizacion_id: {
              id: current.id,
              organizacion_id: current.organizacion_id,
            },
          },
          data: {
            hash_contrasena: passwordHash,
            contrasena_configurada_en: null,
            contrasena_temporal_vence_en: expiresAt,
            estado_invitacion: 'PENDING',
            invitacion_ultimo_intento_en: new Date(),
            invitacion_enviada_en: null,
            invitacion_aceptada_en: null,
            invitacion_error: null,
            invitacion_version: {
              increment: 1,
            },
          },
        });
        await this.revokeSessions(transaction, current.id);
        return transaction.usuarios.findUniqueOrThrow({
          where: {
            id_organizacion_id: {
              id: current.id,
              organizacion_id: current.organizacion_id,
            },
          },
          select: managedUserSelect,
        });
      },
    );

    const deliveredUser = await this.sendTemporaryPassword(
      user,
      actor,
      temporaryPassword,
      expiresAt,
      'reset',
    );
    return {
      user: this.toResponse(deliveredUser),
      delivery: {
        status: 'DELIVERED' as const,
        sent: true,
        expiresAt,
      },
    };
  }

  async findOrganizations(actor: AuthenticatedUser) {
    return this.prisma
      .withTenant(this.scope(actor), (transaction) =>
        transaction.organizaciones.findMany({
          where: {
            id: actor.globalAccess ? undefined : actor.organization.id,
            activa: true,
          },
          orderBy: {
            nombre: 'asc',
          },
          select: {
            id: true,
            codigo: true,
            nombre: true,
            tipo: true,
          },
        }),
      )
      .then((organizations) =>
        organizations.map((organization) => ({
          id: organization.id,
          code: organization.codigo,
          name: organization.nombre,
          type: organization.tipo,
        })),
      );
  }

  async findBranches(query: BranchListQueryDto, actor: AuthenticatedUser) {
    this.assertOrganizationAccess(actor, query.organizationId);
    const organizationId =
      query.organizationId ??
      (actor.globalAccess ? undefined : actor.organization.id);

    return this.prisma
      .withTenant(this.scope(actor), (transaction) =>
        transaction.sucursales.findMany({
          where: {
            organizacion_id: organizationId,
            activa: true,
          },
          orderBy: {
            nombre: 'asc',
          },
          select: {
            id: true,
            codigo: true,
            nombre: true,
            organizacion_id: true,
          },
        }),
      )
      .then((branches) =>
        branches.map((branch) => ({
          id: branch.id,
          code: branch.codigo,
          name: branch.nombre,
          organizationId: branch.organizacion_id,
        })),
      );
  }

  private scope(actor: AuthenticatedUser): TenantScope {
    return {
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
    };
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
        'You cannot manage users from another organization',
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

  private assertGlobalAccessAssignment(
    actor: AuthenticatedUser,
    globalAccess: boolean,
    organizationType: string,
    roleCode: string,
  ): void {
    if (!globalAccess) {
      return;
    }
    if (!actor.globalAccess) {
      throw new ForbiddenException(
        'Only a global administrator can grant global access',
      );
    }
    if (
      organizationType !== 'CASA_CENTRAL' ||
      roleCode !== ROLE_CODES.ADMINISTRADOR
    ) {
      throw new BadRequestException(
        'Global access requires a Casa Central administrator role',
      );
    }
  }

  private async findManagedUser(
    transaction: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<ManagedUser> {
    const user = await transaction.usuarios.findFirst({
      where: {
        id,
        organizacion_id: actor.globalAccess ? undefined : actor.organization.id,
      },
      select: managedUserSelect,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private async requireOrganization(
    transaction: Prisma.TransactionClient,
    organizationId: string,
  ) {
    const organization = await transaction.organizaciones.findFirst({
      where: {
        id: organizationId,
        activa: true,
      },
      select: {
        id: true,
        tipo: true,
      },
    });
    if (!organization) {
      throw new BadRequestException('Organization is invalid or inactive');
    }
    return organization;
  }

  private async requireRole(
    transaction: Prisma.TransactionClient,
    roleCode: string,
    organizationId: string,
  ) {
    const role = await transaction.role.findFirst({
      where: {
        codigo: roleCode,
        activo: true,
        OR: [
          {
            es_sistema: true,
            organizacion_id: null,
          },
          {
            es_sistema: false,
            organizacion_id: organizationId,
          },
        ],
      },
      select: {
        id: true,
        codigo: true,
      },
    });
    if (!role) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ROLE_INACTIVE',
        'Role is invalid, inactive, or belongs to another organization',
      );
    }
    return role;
  }

  private async requireBranch(
    transaction: Prisma.TransactionClient,
    branchId: string | undefined,
    organizationId: string,
  ) {
    if (!branchId) {
      return null;
    }
    const branch = await transaction.sucursales.findFirst({
      where: {
        id: branchId,
        organizacion_id: organizationId,
        activa: true,
      },
      select: {
        id: true,
      },
    });
    if (!branch) {
      throw new BadRequestException(
        'Branch is invalid, inactive, or belongs to another organization',
      );
    }
    return branch;
  }

  private async revokeSessions(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<number> {
    const result = await transaction.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
    return result.count;
  }

  private async assertLastGlobalAdministrator(
    transaction: Prisma.TransactionClient,
    current: ManagedUser,
    nextRoleCode: string,
    nextActive: boolean,
    nextPasswordConfigured: boolean,
    actor: AuthenticatedUser,
  ): Promise<void> {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${current.organizacion_id}::text, 0)
      )
    `;
    const lockedCurrent = await this.findManagedUser(
      transaction,
      current.id,
      actor,
    );
    const currentlyProtectsAccess =
      lockedCurrent.activo &&
      Boolean(lockedCurrent.contrasena_configurada_en) &&
      lockedCurrent.roles?.activo &&
      lockedCurrent.personal?.puede_iniciar_sesion &&
      lockedCurrent.personal.estado === 'ACTIVO' &&
      lockedCurrent.roles.codigo === ROLE_CODES.ADMINISTRADOR;
    const willProtectAccess =
      nextActive &&
      nextPasswordConfigured &&
      nextRoleCode === ROLE_CODES.ADMINISTRADOR;
    if (!currentlyProtectsAccess || willProtectAccess) {
      return;
    }

    const replacements = await transaction.usuarios.count({
      where: {
        id: {
          not: lockedCurrent.id,
        },
        organizacion_id: lockedCurrent.organizacion_id,
        activo: true,
        contrasena_configurada_en: {
          not: null,
        },
        roles: {
          codigo: ROLE_CODES.ADMINISTRADOR,
          activo: true,
        },
        personal: {
          is: {
            estado: 'ACTIVO',
            puede_iniciar_sesion: true,
          },
        },
      },
    });
    if (replacements === 0) {
      throw apiError(
        HttpStatus.CONFLICT,
        'LAST_ACTIVE_ADMIN',
        'At least one active administrator must remain',
      );
    }
  }

  private async sendTemporaryPassword(
    user: ManagedUser,
    actor: AuthenticatedUser,
    temporaryPassword: string,
    expiresAt: Date,
    reason: 'creation' | 'reset',
  ): Promise<ManagedUser> {
    const auditBase = {
      entity: 'usuarios',
      entityId: user.id,
      actorId: actor.id,
      organizationId: actor.organization.id,
      globalAccess: actor.globalAccess,
      targetOrganizationId: this.targetOrganization(
        actor,
        user.organizacion_id,
      ),
    };

    try {
      await this.mailService.sendTemporaryPassword({
        email: user.correo,
        fullName: user.personal?.nombre_completo ?? user.correo,
        organizationCode: user.organizaciones.codigo,
        temporaryPassword,
        expiresAt,
        reason,
      });
    } catch {
      await this.auditService.execute(
        {
          ...auditBase,
          action: USER_AUDIT_ACTIONS.TEMPORARY_PASSWORD_EMAIL_FAILED,
          metadata: {
            reason,
          },
        },
        async (transaction) => {
          await transaction.usuarios.updateMany({
            where: {
              id: user.id,
              organizacion_id: user.organizacion_id,
              invitacion_version: user.invitacion_version,
            },
            data: {
              estado_invitacion: 'FAILED',
              invitacion_ultimo_intento_en: new Date(),
              invitacion_error: 'SMTP_DELIVERY_FAILED',
            },
          });
        },
      );
      throw apiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'INVITATION_DELIVERY_FAILED',
        'The invitation email could not be delivered',
      );
    }

    return this.auditService.execute(
      {
        ...auditBase,
        action: USER_AUDIT_ACTIONS.TEMPORARY_PASSWORD_EMAIL_SENT,
        metadata: {
          reason,
          expiresAt: expiresAt.toISOString(),
        },
      },
      async (transaction) => {
        const sentAt = new Date();
        const updated = await transaction.usuarios.updateMany({
          where: {
            id: user.id,
            organizacion_id: user.organizacion_id,
            invitacion_version: user.invitacion_version,
          },
          data: {
            estado_invitacion: 'DELIVERED',
            invitacion_ultimo_intento_en: sentAt,
            invitacion_enviada_en: sentAt,
            invitacion_error: null,
          },
        });
        if (updated.count !== 1) {
          throw apiError(
            HttpStatus.CONFLICT,
            'VERSION_CONFLICT',
            'Invitation was superseded by another request',
          );
        }
        return transaction.usuarios.findUniqueOrThrow({
          where: {
            id_organizacion_id: {
              id: user.id,
              organizacion_id: user.organizacion_id,
            },
          },
          select: managedUserSelect,
        });
      },
    );
  }

  private normalizeName(name: string): string {
    return name.trim().toLocaleLowerCase('es-AR');
  }

  private toResponse(user: ManagedUser) {
    return {
      id: user.id,
      email: user.correo,
      active: user.activo,
      globalAccess: user.acceso_global,
      passwordChangeRequired: user.contrasena_configurada_en === null,
      temporaryPasswordExpiresAt: user.contrasena_temporal_vence_en,
      invitation: {
        status: this.invitationStatus(user),
        lastAttemptAt: user.invitacion_ultimo_intento_en,
        sentAt: user.invitacion_enviada_en,
        expiresAt: user.contrasena_temporal_vence_en,
        acceptedAt: user.invitacion_aceptada_en,
      },
      createdAt: user.creado_en,
      updatedAt: user.actualizado_en,
      lastLoginAt: user.ultimo_inicio_sesion_en,
      organization: {
        id: user.organizaciones.id,
        code: user.organizaciones.codigo,
        name: user.organizaciones.nombre,
        type: user.organizaciones.tipo,
        active: user.organizaciones.activa,
      },
      role: user.roles
        ? {
            id: user.roles.id,
            code: user.roles.codigo,
            name: user.roles.nombre,
            active: user.roles.activo,
            system: user.roles.es_sistema,
            version: user.roles.version,
            permissions: user.roles.permisos_rol.map(
              (permission) => permission.codigo_permiso,
            ),
          }
        : null,
      branch: user.sucursales
        ? {
            id: user.sucursales.id,
            code: user.sucursales.codigo,
            name: user.sucursales.nombre,
            active: user.sucursales.activa,
          }
        : null,
      personnel: user.personal
        ? {
            id: user.personal.id,
            employeeCode: user.personal.codigo_empleado,
            fullName: user.personal.nombre_completo,
            phone: user.personal.telefono,
            canSignIn: user.personal.puede_iniciar_sesion,
            status: user.personal.estado,
          }
        : null,
    };
  }

  private invitationStatus(user: ManagedUser) {
    if (
      user.contrasena_configurada_en === null &&
      user.contrasena_temporal_vence_en &&
      user.contrasena_temporal_vence_en <= new Date()
    ) {
      return 'EXPIRED' as const;
    }
    return user.estado_invitacion;
  }
}

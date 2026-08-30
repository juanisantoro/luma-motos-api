import { HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { EnvironmentVariables } from '../config/environment';
import { apiError } from '../common/api-error';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ACTIONS } from './auth.constants';
import { AuthenticatedUser, JwtPayload, LoginResponse } from './auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangeTemporaryPasswordDto } from './dto/change-temporary-password.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from './password-hashing';
import { createTemporaryPassword } from './temporary-password';

const userForAuthenticationSelect = {
  id: true,
  correo: true,
  hash_contrasena: true,
  activo: true,
  acceso_global: true,
  organizacion_id: true,
  contrasena_configurada_en: true,
  contrasena_temporal_vence_en: true,
  estado_invitacion: true,
  organizaciones: {
    select: {
      id: true,
      codigo: true,
      nombre: true,
      tipo: true,
      activa: true,
    },
  },
  personal: {
    select: {
      nombre_completo: true,
      puede_iniciar_sesion: true,
      estado: true,
    },
  },
  roles: {
    select: {
      id: true,
      codigo: true,
      nombre: true,
      activo: true,
      es_sistema: true,
      permisos_rol: {
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
    },
  },
} satisfies Prisma.usuariosSelect;

type UserForAuthentication = Prisma.usuariosGetPayload<{
  select: typeof userForAuthenticationSelect;
}>;

@Injectable()
export class AuthService {
  private readonly idleTimeoutSeconds: number;
  private readonly temporaryPasswordTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.idleTimeoutSeconds = config.get('JWT_SESSION_IDLE_TIMEOUT_SECONDS', {
      infer: true,
    });
    this.temporaryPasswordTtlSeconds = config.get(
      'USER_TEMPORARY_PASSWORD_TTL_SECONDS',
      { infer: true },
    );
  }

  // Publicly reachable: any caller can ask to reset any email's password, so
  // this must resolve identically (same response, similar timing) whether or
  // not the email belongs to an account, and it must never throw for that
  // reason alone. Otherwise the endpoint becomes a user-enumeration oracle.
  async requestPasswordReset(dto: RequestPasswordResetDto): Promise<void> {
    const user = await this.prisma.withTenant(
      { organizationId: '', globalAccess: true },
      (transaction) =>
        transaction.usuarios.findFirst({
          where: { correo_normalizado: dto.email },
          select: {
            id: true,
            correo: true,
            activo: true,
            organizacion_id: true,
            invitacion_version: true,
            organizaciones: {
              select: {
                codigo: true,
                activa: true,
              },
            },
            personal: {
              select: {
                nombre_completo: true,
              },
            },
          },
        }),
    );

    if (!user || !user.activo || !user.organizaciones.activa) {
      return;
    }

    const temporaryPassword = createTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const expiresAt = new Date(
      Date.now() + this.temporaryPasswordTtlSeconds * 1_000,
    );
    const scope = {
      organizationId: user.organizacion_id,
      globalAccess: false,
    };

    const reissued = await this.prisma.withTenant(scope, (transaction) =>
      transaction.usuarios.updateMany({
        where: {
          id: user.id,
          organizacion_id: user.organizacion_id,
          invitacion_version: user.invitacion_version,
        },
        data: {
          hash_contrasena: passwordHash,
          contrasena_configurada_en: null,
          contrasena_temporal_vence_en: expiresAt,
          estado_invitacion: 'PENDING',
          invitacion_ultimo_intento_en: new Date(),
          invitacion_enviada_en: null,
          invitacion_error: null,
          invitacion_version: {
            increment: 1,
          },
        },
      }),
    );
    if (reissued.count !== 1) {
      // Another reset (or an admin action) is already in flight for this
      // user; do not stack a second email on top of it.
      return;
    }

    await this.prisma.withTenant(scope, (transaction) =>
      transaction.authSession.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      }),
    );

    await this.auditService.record({
      action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
      entity: 'usuarios',
      entityId: user.id,
      organizationId: user.organizacion_id,
      metadata: {
        expiresAt: expiresAt.toISOString(),
      },
    });

    try {
      await this.mailService.sendTemporaryPassword({
        email: user.correo,
        fullName: user.personal?.nombre_completo ?? user.correo,
        organizationCode: user.organizaciones.codigo,
        temporaryPassword,
        expiresAt,
        reason: 'reset',
      });
    } catch {
      await this.prisma.withTenant(scope, (transaction) =>
        transaction.usuarios.updateMany({
          where: {
            id: user.id,
            organizacion_id: user.organizacion_id,
          },
          data: {
            estado_invitacion: 'FAILED',
            invitacion_ultimo_intento_en: new Date(),
            invitacion_error: 'SMTP_DELIVERY_FAILED',
          },
        }),
      );
      await this.auditService.record({
        action: AUDIT_ACTIONS.PASSWORD_RESET_EMAIL_FAILED,
        entity: 'usuarios',
        entityId: user.id,
        organizationId: user.organizacion_id,
        metadata: {
          reason: 'reset',
        },
      });
      // Swallow it: a public endpoint must not reveal delivery failures to
      // the caller, since that would leak whether the email exists.
      return;
    }

    await this.prisma.withTenant(scope, (transaction) =>
      transaction.usuarios.updateMany({
        where: {
          id: user.id,
          organizacion_id: user.organizacion_id,
        },
        data: {
          estado_invitacion: 'DELIVERED',
          invitacion_ultimo_intento_en: new Date(),
          invitacion_enviada_en: new Date(),
          invitacion_error: null,
        },
      }),
    );
    await this.auditService.record({
      action: AUDIT_ACTIONS.PASSWORD_RESET_EMAIL_SENT,
      entity: 'usuarios',
      entityId: user.id,
      organizationId: user.organizacion_id,
      metadata: {
        reason: 'reset',
        expiresAt: expiresAt.toISOString(),
      },
    });
  }

  async changeTemporaryPassword(
    credentials: ChangeTemporaryPasswordDto,
  ): Promise<void> {
    if (credentials.temporaryPassword === credentials.newPassword) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'PASSWORD_POLICY_VIOLATION',
        'The new password must differ from the temporary password',
      );
    }
    this.assertPasswordPolicy(credentials.newPassword);

    const invalidCredentialsError = apiError(
      HttpStatus.UNAUTHORIZED,
      'INVALID_TEMPORARY_CREDENTIALS',
      'Invalid temporary credentials',
    );

    // The organization is resolved from the email itself (correo_normalizado
    // is globally unique), not supplied by the user, so this lookup runs with
    // globalAccess to bypass the per-tenant RLS filter.
    const user = await this.prisma.withTenant(
      { organizationId: '', globalAccess: true },
      (transaction) =>
        transaction.usuarios.findFirst({
          where: {
            correo_normalizado: credentials.email,
            contrasena_configurada_en: null,
          },
          select: {
            id: true,
            organizacion_id: true,
            hash_contrasena: true,
            activo: true,
            contrasena_temporal_vence_en: true,
            estado_invitacion: true,
            invitacion_version: true,
            organizaciones: {
              select: {
                activa: true,
              },
            },
            roles: {
              select: {
                activo: true,
              },
            },
            personal: {
              select: {
                puede_iniciar_sesion: true,
                estado: true,
              },
            },
          },
        }),
    );

    if (!user?.organizaciones.activa) {
      await verifyPassword(DUMMY_PASSWORD_HASH, credentials.temporaryPassword);
      throw invalidCredentialsError;
    }

    const scope = {
      organizationId: user.organizacion_id,
      globalAccess: false,
    };

    const temporaryPasswordMatches = await verifyPassword(
      user.hash_contrasena,
      credentials.temporaryPassword,
    );
    if (!temporaryPasswordMatches) {
      await this.auditService.record({
        action: AUDIT_ACTIONS.TEMPORARY_PASSWORD_CHANGE_FAILED,
        entity: 'usuarios',
        entityId: user.id,
        organizationId: user.organizacion_id,
        metadata: {
          reason: 'invalid_or_expired_temporary_credentials',
        },
      });
      throw invalidCredentialsError;
    }
    if (!this.canCompleteFirstAccess(user)) {
      await this.auditService.record({
        action: AUDIT_ACTIONS.TEMPORARY_PASSWORD_CHANGE_FAILED,
        entity: 'usuarios',
        entityId: user.id,
        organizationId: user.organizacion_id,
        metadata: {
          reason: 'account_disabled',
        },
      });
      throw invalidCredentialsError;
    }
    if (
      !user.contrasena_temporal_vence_en ||
      user.contrasena_temporal_vence_en <= new Date() ||
      user.estado_invitacion === 'EXPIRED'
    ) {
      await this.prisma.withTenant(scope, (transaction) =>
        transaction.usuarios.updateMany({
          where: {
            id: user.id,
            organizacion_id: user.organizacion_id,
            hash_contrasena: user.hash_contrasena,
            contrasena_configurada_en: null,
            contrasena_temporal_vence_en:
              user.contrasena_temporal_vence_en ?? undefined,
            estado_invitacion: user.estado_invitacion,
            invitacion_version: user.invitacion_version,
          },
          data: {
            estado_invitacion: 'EXPIRED',
          },
        }),
      );
      await this.auditService.record({
        action: AUDIT_ACTIONS.TEMPORARY_PASSWORD_CHANGE_FAILED,
        entity: 'usuarios',
        entityId: user.id,
        organizationId: user.organizacion_id,
        metadata: {
          reason: 'temporary_password_expired',
        },
      });
      throw apiError(
        HttpStatus.FORBIDDEN,
        'TEMPORARY_PASSWORD_EXPIRED',
        'Temporary password expired',
      );
    }
    if (user.estado_invitacion !== 'DELIVERED') {
      throw invalidCredentialsError;
    }

    const passwordHash = await hashPassword(credentials.newPassword);
    await this.auditService.execute(
      {
        action: AUDIT_ACTIONS.TEMPORARY_PASSWORD_CHANGED,
        entity: 'usuarios',
        entityId: user.id,
        actorId: user.id,
        organizationId: user.organizacion_id,
        globalAccess: false,
      },
      async (transaction) => {
        const changedAt = new Date();
        const changed = await transaction.usuarios.updateMany({
          where: {
            id: user.id,
            organizacion_id: user.organizacion_id,
            hash_contrasena: user.hash_contrasena,
            contrasena_configurada_en: null,
            estado_invitacion: 'DELIVERED',
            contrasena_temporal_vence_en: {
              gt: changedAt,
            },
          },
          data: {
            hash_contrasena: passwordHash,
            contrasena_configurada_en: changedAt,
            contrasena_temporal_vence_en: null,
            estado_invitacion: 'ACCEPTED',
            invitacion_aceptada_en: changedAt,
            invitacion_error: null,
            invitacion_version: {
              increment: 1,
            },
          },
        });
        if (changed.count !== 1) {
          throw apiError(
            HttpStatus.CONFLICT,
            'TEMPORARY_PASSWORD_ALREADY_USED',
            'The temporary password was already changed or expired',
          );
        }

        await transaction.authSession.updateMany({
          where: {
            userId: user.id,
            revokedAt: null,
          },
          data: {
            revokedAt: changedAt,
          },
        });
      },
    );
  }

  async changePassword(
    credentials: ChangePasswordDto,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (credentials.currentPassword === credentials.newPassword) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'PASSWORD_POLICY_VIOLATION',
        'The new password must differ from the current password',
      );
    }
    this.assertPasswordPolicy(credentials.newPassword);

    const current = await this.prisma.withTenant(
      {
        organizationId: user.organization.id,
        globalAccess: user.globalAccess,
      },
      (transaction) =>
        transaction.usuarios.findUnique({
          where: {
            id_organizacion_id: {
              id: user.id,
              organizacion_id: user.organization.id,
            },
          },
          select: {
            hash_contrasena: true,
          },
        }),
    );
    const passwordMatches = await verifyPassword(
      current?.hash_contrasena ?? DUMMY_PASSWORD_HASH,
      credentials.currentPassword,
    );
    if (!current || !passwordMatches) {
      await this.auditService.record({
        action: AUDIT_ACTIONS.PASSWORD_CHANGE_FAILED,
        entity: 'usuarios',
        entityId: user.id,
        actorId: user.id,
        organizationId: user.organization.id,
        metadata: {
          reason: 'invalid_current_password',
        },
      });
      throw new UnauthorizedException('Invalid current password');
    }

    const passwordHash = await hashPassword(credentials.newPassword);
    await this.auditService.execute(
      {
        action: AUDIT_ACTIONS.PASSWORD_CHANGED,
        entity: 'usuarios',
        entityId: user.id,
        actorId: user.id,
        organizationId: user.organization.id,
        globalAccess: user.globalAccess,
      },
      async (transaction) => {
        const changedAt = new Date();
        await transaction.usuarios.update({
          where: {
            id_organizacion_id: {
              id: user.id,
              organizacion_id: user.organization.id,
            },
          },
          data: {
            hash_contrasena: passwordHash,
            contrasena_configurada_en: changedAt,
            contrasena_temporal_vence_en: null,
            estado_invitacion: 'ACCEPTED',
          },
        });
        await transaction.authSession.updateMany({
          where: {
            userId: user.id,
            revokedAt: null,
          },
          data: {
            revokedAt: changedAt,
          },
        });
      },
    );
  }

  async login(credentials: LoginDto): Promise<LoginResponse> {
    // The organization is resolved from the email itself (correo_normalizado
    // is globally unique), not supplied by the user, so this lookup runs with
    // globalAccess to bypass the per-tenant RLS filter.
    const user = await this.prisma.withTenant(
      { organizationId: '', globalAccess: true },
      (transaction) =>
        transaction.usuarios.findFirst({
          where: {
            correo_normalizado: credentials.email,
          },
          select: userForAuthenticationSelect,
        }),
    );

    if (!user?.organizaciones.activa) {
      await verifyPassword(DUMMY_PASSWORD_HASH, credentials.password);
      throw this.invalidCredentialsError();
    }

    const passwordMatches = await verifyPassword(
      user.hash_contrasena,
      credentials.password,
    );
    if (!passwordMatches) {
      await this.auditService.record({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        entity: 'usuarios',
        entityId: user.id,
        organizationId: user.organizacion_id,
        metadata: {
          reason: 'invalid_credentials',
        },
      });
      throw this.invalidCredentialsError();
    }

    if (!user.contrasena_configurada_en) {
      if (!this.canCompleteFirstAccess(user)) {
        await this.auditService.record({
          action: AUDIT_ACTIONS.LOGIN_FAILED,
          entity: 'usuarios',
          entityId: user.id,
          organizationId: user.organizacion_id,
          metadata: {
            reason: 'account_disabled',
          },
        });
        throw this.invalidCredentialsError();
      }
      const expired =
        !user.contrasena_temporal_vence_en ||
        user.contrasena_temporal_vence_en <= new Date() ||
        user.estado_invitacion === 'EXPIRED';
      await this.auditService.record({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        entity: 'usuarios',
        entityId: user.id,
        organizationId: user.organizacion_id,
        metadata: {
          reason: expired
            ? 'temporary_password_expired'
            : 'password_change_required',
        },
      });
      if (expired) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'TEMPORARY_PASSWORD_EXPIRED',
          'Temporary password expired',
        );
      }
      if (user.estado_invitacion !== 'DELIVERED') {
        throw apiError(
          HttpStatus.UNAUTHORIZED,
          'INVALID_CREDENTIALS',
          'Invalid email or password',
        );
      }
      throw apiError(
        HttpStatus.FORBIDDEN,
        'PASSWORD_CHANGE_REQUIRED',
        'Password change required',
        {
          organizationCode: user.organizaciones.codigo,
          email: user.correo,
          expiresAt: user.contrasena_temporal_vence_en?.toISOString(),
        },
      );
    }

    if (!this.canSignIn(user)) {
      await this.auditService.record({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        entity: 'usuarios',
        entityId: user.id,
        organizationId: user.organizacion_id,
        metadata: {
          reason: user.contrasena_configurada_en
            ? 'account_disabled'
            : 'password_change_required',
        },
      });
      throw this.invalidCredentialsError();
    }

    const session = await this.auditService.execute(
      {
        action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
        entity: 'sesiones_autenticacion',
        actorId: user.id,
        organizationId: user.organizacion_id,
        globalAccess: user.acceso_global,
        metadata: {
          idleTimeoutSeconds: this.idleTimeoutSeconds,
        },
      },
      async (transaction) => {
        await transaction.usuarios.update({
          where: { id: user.id },
          data: {
            ultimo_inicio_sesion_en: new Date(),
          },
        });

        return transaction.authSession.create({
          data: {
            userId: user.id,
          },
          select: {
            id: true,
          },
        });
      },
    );
    const payload: JwtPayload = {
      sub: user.id,
      sid: session.id,
      oid: user.organizacion_id,
      type: 'access',
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      tokenType: 'Bearer',
      idleTimeoutSeconds: this.idleTimeoutSeconds,
      user: this.toAuthenticatedUser(user),
    };
  }

  async logout(sessionId: string, user: AuthenticatedUser): Promise<void> {
    await this.auditService.execute(
      {
        action: AUDIT_ACTIONS.LOGOUT,
        entity: 'sesiones_autenticacion',
        entityId: sessionId,
        actorId: user.id,
        organizationId: user.organization.id,
        globalAccess: user.globalAccess,
      },
      async (transaction) => {
        await transaction.authSession.updateMany({
          where: {
            id: sessionId,
            userId: user.id,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });
      },
    );
  }

  private canSignIn(user: UserForAuthentication): boolean {
    return Boolean(
      user.activo &&
      Boolean(user.contrasena_configurada_en) &&
      user.estado_invitacion === 'ACCEPTED' &&
      user.organizaciones.activa &&
      user.roles?.activo &&
      user.personal?.puede_iniciar_sesion &&
      user.personal.estado === 'ACTIVO',
    );
  }

  private canCompleteFirstAccess(user: {
    activo: boolean;
    roles: { activo: boolean } | null;
    personal: {
      puede_iniciar_sesion: boolean;
      estado: string;
    } | null;
  }): boolean {
    return Boolean(
      user.activo &&
      user.roles?.activo &&
      user.personal?.puede_iniciar_sesion &&
      user.personal.estado === 'ACTIVO',
    );
  }

  private toAuthenticatedUser(user: UserForAuthentication): AuthenticatedUser {
    if (!user.roles) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return {
      id: user.id,
      email: user.correo,
      name: user.personal?.nombre_completo ?? null,
      active: user.activo,
      globalAccess: user.acceso_global,
      organization: {
        id: user.organizaciones.id,
        code: user.organizaciones.codigo,
        name: user.organizaciones.nombre,
        type: user.organizaciones.tipo,
      },
      role: {
        id: user.roles.id,
        code: user.roles.codigo,
        name: user.roles.nombre,
        system: user.roles.es_sistema,
        permissions: user.roles.permisos_rol.map(
          (permission) => permission.codigo_permiso,
        ),
      },
      branch: user.sucursales
        ? {
            id: user.sucursales.id,
            code: user.sucursales.codigo,
            name: user.sucursales.nombre,
          }
        : null,
    };
  }

  private assertPasswordPolicy(password: string): void {
    const valid =
      password.length >= 12 &&
      /[a-z]/.test(password) &&
      /[A-Z]/.test(password) &&
      /\d/.test(password) &&
      /[^A-Za-z0-9]/.test(password);
    if (!valid) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'PASSWORD_POLICY_VIOLATION',
        'Password must contain uppercase, lowercase, number and symbol',
      );
    }
  }

  private invalidCredentialsError() {
    return apiError(
      HttpStatus.UNAUTHORIZED,
      'INVALID_CREDENTIALS',
      'Invalid email or password',
    );
  }
}

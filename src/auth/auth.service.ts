import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { EnvironmentVariables } from '../config/environment';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ACTIONS } from './auth.constants';
import { AuthenticatedUser, JwtPayload, LoginResponse } from './auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangeTemporaryPasswordDto } from './dto/change-temporary-password.dto';
import { LoginDto } from './dto/login.dto';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from './password-hashing';

const userForAuthenticationSelect = {
  id: true,
  correo: true,
  hash_contrasena: true,
  activo: true,
  acceso_global: true,
  organizacion_id: true,
  contrasena_configurada_en: true,
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
      codigo: true,
      nombre: true,
      activo: true,
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.idleTimeoutSeconds = config.get('JWT_SESSION_IDLE_TIMEOUT_SECONDS', {
      infer: true,
    });
  }

  async changeTemporaryPassword(
    credentials: ChangeTemporaryPasswordDto,
  ): Promise<void> {
    if (credentials.temporaryPassword === credentials.newPassword) {
      throw new BadRequestException(
        'The new password must differ from the temporary password',
      );
    }

    const organization = await this.prisma.organizaciones.findUnique({
      where: {
        codigo: credentials.organizationCode,
      },
      select: {
        id: true,
        activa: true,
      },
    });
    const invalidCredentialsError = new UnauthorizedException(
      'Invalid or expired temporary credentials',
    );

    if (!organization?.activa) {
      await verifyPassword(DUMMY_PASSWORD_HASH, credentials.temporaryPassword);
      throw invalidCredentialsError;
    }

    const scope = {
      organizationId: organization.id,
      globalAccess: false,
    };
    const user = await this.prisma.withTenant(scope, (transaction) =>
      transaction.usuarios.findFirst({
        where: {
          correo_normalizado: credentials.email,
          organizacion_id: organization.id,
          contrasena_configurada_en: null,
          contrasena_temporal_vence_en: {
            gt: new Date(),
          },
        },
        select: {
          id: true,
          hash_contrasena: true,
        },
      }),
    );

    const temporaryPasswordMatches = await verifyPassword(
      user?.hash_contrasena ?? DUMMY_PASSWORD_HASH,
      credentials.temporaryPassword,
    );
    if (!user || !temporaryPasswordMatches) {
      await this.auditService.record({
        action: AUDIT_ACTIONS.TEMPORARY_PASSWORD_CHANGE_FAILED,
        entity: 'usuarios',
        entityId: user?.id,
        organizationId: organization.id,
        metadata: {
          reason: 'invalid_or_expired_temporary_credentials',
        },
      });
      throw invalidCredentialsError;
    }

    const passwordHash = await hashPassword(credentials.newPassword);
    await this.auditService.execute(
      {
        action: AUDIT_ACTIONS.TEMPORARY_PASSWORD_CHANGED,
        entity: 'usuarios',
        entityId: user.id,
        actorId: user.id,
        organizationId: organization.id,
        globalAccess: false,
      },
      async (transaction) => {
        const changedAt = new Date();
        const changed = await transaction.usuarios.updateMany({
          where: {
            id: user.id,
            organizacion_id: organization.id,
            hash_contrasena: user.hash_contrasena,
            contrasena_configurada_en: null,
            contrasena_temporal_vence_en: {
              gt: changedAt,
            },
          },
          data: {
            hash_contrasena: passwordHash,
            contrasena_configurada_en: changedAt,
            contrasena_temporal_vence_en: null,
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException(
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
      throw new BadRequestException(
        'The new password must differ from the current password',
      );
    }

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
    const organization = await this.prisma.organizaciones.findUnique({
      where: {
        codigo: credentials.organizationCode,
      },
      select: {
        id: true,
        activa: true,
      },
    });

    if (!organization?.activa) {
      await verifyPassword(DUMMY_PASSWORD_HASH, credentials.password);
      throw new UnauthorizedException('Invalid email or password');
    }

    const scope = {
      organizationId: organization.id,
      globalAccess: false,
    };
    const user = await this.prisma.withTenant(scope, (transaction) =>
      transaction.usuarios.findFirst({
        where: {
          correo_normalizado: credentials.email,
          organizacion_id: organization.id,
        },
        select: userForAuthenticationSelect,
      }),
    );

    const passwordMatches = await verifyPassword(
      user?.hash_contrasena ?? DUMMY_PASSWORD_HASH,
      credentials.password,
    );
    if (!user || !passwordMatches) {
      await this.auditService.record({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        entity: 'usuarios',
        entityId: user?.id,
        organizationId: organization.id,
        metadata: {
          reason: 'invalid_credentials',
        },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!this.canSignIn(user)) {
      await this.auditService.record({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        entity: 'usuarios',
        entityId: user.id,
        organizationId: organization.id,
        metadata: {
          reason: user.contrasena_configurada_en
            ? 'account_disabled'
            : 'password_change_required',
        },
      });
      throw new UnauthorizedException('Invalid email or password');
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
      user.organizaciones.activa &&
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
        code: user.roles.codigo,
        name: user.roles.nombre,
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
}

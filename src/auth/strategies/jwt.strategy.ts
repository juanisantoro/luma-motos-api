import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { isUUID } from 'class-validator';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { EnvironmentVariables } from '../../config/environment';
import { PrismaService } from '../../prisma/prisma.service';
import { JWT_AUDIENCE, JWT_ISSUER } from '../auth.constants';
import { AuthenticatedPrincipal, JwtPayload } from '../auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly idleTimeoutMilliseconds: number;
  private readonly activityTouchIntervalSeconds: number;

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    this.idleTimeoutMilliseconds =
      config.get('JWT_SESSION_IDLE_TIMEOUT_SECONDS', { infer: true }) * 1_000;
    this.activityTouchIntervalSeconds = Math.max(
      1,
      Math.min(60, Math.floor(this.idleTimeoutMilliseconds / 10_000)),
    );
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedPrincipal> {
    if (
      payload.type !== 'access' ||
      !isUUID(payload.sub) ||
      !isUUID(payload.sid) ||
      !isUUID(payload.oid)
    ) {
      throw new UnauthorizedException();
    }

    const checkedAt = new Date();
    const idleCutoff = new Date(
      checkedAt.getTime() - this.idleTimeoutMilliseconds,
    );
    const touchCutoff = new Date(
      checkedAt.getTime() - this.activityTouchIntervalSeconds * 1_000,
    );
    const result = await this.prisma.withTenant(
      {
        organizationId: payload.oid,
        globalAccess: false,
      },
      async (transaction) => {
        const user = await transaction.usuarios.findUnique({
          where: {
            id_organizacion_id: {
              id: payload.sub,
              organizacion_id: payload.oid,
            },
            activo: true,
            contrasena_configurada_en: {
              not: null,
            },
            organizaciones: {
              activa: true,
            },
            roles: {
              activo: true,
            },
            personal: {
              puede_iniciar_sesion: true,
              estado: 'ACTIVO',
            },
          },
          select: {
            id: true,
            correo: true,
            activo: true,
            acceso_global: true,
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
            sesiones_autenticacion: {
              where: {
                id: payload.sid,
                revokedAt: null,
                lastActivityAt: {
                  gt: idleCutoff,
                },
              },
              select: {
                lastActivityAt: true,
              },
              take: 1,
            },
          },
        });
        const session = user?.sesiones_autenticacion[0];
        if (!session) {
          return null;
        }

        if (session.lastActivityAt <= touchCutoff) {
          await transaction.$executeRaw`
            WITH session_to_touch AS (
              SELECT session."id"
              FROM "sesiones_autenticacion" AS session
              WHERE session."id" = ${payload.sid}::uuid
                AND session."usuario_id" = ${payload.sub}::uuid
                AND session."revocada_en" IS NULL
                AND session."ultima_actividad_en" > ${idleCutoff}
                AND session."ultima_actividad_en" <= ${touchCutoff}
              FOR UPDATE SKIP LOCKED
            )
            UPDATE "sesiones_autenticacion" AS session
            SET "ultima_actividad_en" = GREATEST(
              session."ultima_actividad_en",
              ${checkedAt}
            )
            FROM session_to_touch
            WHERE session."id" = session_to_touch."id"
          `;
        }

        return user;
      },
    );

    if (
      !result?.activo ||
      !result.contrasena_configurada_en ||
      !result.organizaciones.activa ||
      !result.roles?.activo ||
      !result.personal?.puede_iniciar_sesion ||
      result.personal.estado !== 'ACTIVO'
    ) {
      throw new UnauthorizedException();
    }

    return {
      sessionId: payload.sid,
      user: {
        id: result.id,
        email: result.correo,
        name: result.personal.nombre_completo,
        active: result.activo,
        globalAccess: result.acceso_global,
        organization: {
          id: result.organizaciones.id,
          code: result.organizaciones.codigo,
          name: result.organizaciones.nombre,
          type: result.organizaciones.tipo,
        },
        role: {
          code: result.roles.codigo,
          name: result.roles.nombre,
          permissions: result.roles.permisos_rol.map(
            (permission) => permission.codigo_permiso,
          ),
        },
        branch: result.sucursales
          ? {
              id: result.sucursales.id,
              code: result.sucursales.codigo,
              name: result.sucursales.nombre,
            }
          : null,
      },
    };
  }
}

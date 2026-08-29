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

    const idleTimeoutSeconds = this.idleTimeoutMilliseconds / 1_000;
    const result = await this.prisma.withTenant(
      {
        organizationId: payload.oid,
        globalAccess: false,
      },
      async (transaction) => {
        const touchedSessions = await transaction.$executeRaw`
          UPDATE "sesiones_autenticacion" AS session
          SET "ultima_actividad_en" = GREATEST(
            session."ultima_actividad_en",
            statement_timestamp()
          )
          WHERE session."id" = ${payload.sid}::uuid
            AND session."usuario_id" = ${payload.sub}::uuid
            AND session."revocada_en" IS NULL
            AND session."ultima_actividad_en" >
              statement_timestamp() - (${idleTimeoutSeconds} * INTERVAL '1 second')
            AND EXISTS (
              SELECT 1
              FROM "usuarios" AS app_user
              INNER JOIN "personal" AS employee
                ON employee."usuario_id" = app_user."id"
                AND employee."organizacion_id" = app_user."organizacion_id"
              INNER JOIN "organizaciones" AS organization
                ON organization."id" = app_user."organizacion_id"
              WHERE app_user."id" = session."usuario_id"
                AND app_user."organizacion_id" = ${payload.oid}::uuid
                AND app_user."activo" = true
                AND organization."activa" = true
                AND employee."puede_iniciar_sesion" = true
                AND employee."estado" = 'ACTIVO'
            )
        `;

        if (touchedSessions !== 1) {
          return null;
        }

        return transaction.usuarios.findUnique({
          where: {
            id_organizacion_id: {
              id: payload.sub,
              organizacion_id: payload.oid,
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
          },
        });
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

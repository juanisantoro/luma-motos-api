import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { EnvironmentVariables } from '../../config/environment';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLE_CODES } from '../auth.constants';
import { JwtPayload } from '../auth.types';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const payload: JwtPayload = {
    sub: 'd16c3c21-8d15-4bc9-a282-7ba4c9a0cc31',
    sid: '7f62fcf8-9934-4105-8765-e92b37ce9899',
    oid: '8fa94171-13b3-40b5-8c33-1f7d8ea94c75',
    type: 'access',
  };
  const databaseUser = {
    id: payload.sub,
    correo: 'seller@luma.test',
    activo: true,
    acceso_global: false,
    contrasena_configurada_en: new Date('2026-08-29T00:00:00.000Z'),
    estado_invitacion: 'ACCEPTED',
    organizaciones: {
      id: payload.oid,
      codigo: 'LUMA_CENTRAL',
      nombre: 'Luma Motos Casa Central',
      tipo: 'CASA_CENTRAL' as const,
      activa: true,
    },
    personal: {
      nombre_completo: 'Luma Seller',
      puede_iniciar_sesion: true,
      estado: 'ACTIVO',
    },
    roles: {
      codigo: ROLE_CODES.VENDEDOR,
      nombre: 'Vendedor',
      activo: true,
      permisos_rol: [{ codigo_permiso: 'clientes.consultar' }],
    },
    sucursales: null,
    sesiones_autenticacion: [{ lastActivityAt: new Date() }],
  };
  const config = {
    get: jest.fn((key: keyof EnvironmentVariables) => {
      if (key === 'JWT_SECRET') {
        return 'test-secret-with-at-least-thirty-two-characters';
      }
      if (key === 'JWT_SESSION_IDLE_TIMEOUT_SECONDS') {
        return 3_600;
      }
      return undefined;
    }),
  } as unknown as ConfigService<EnvironmentVariables, true>;

  function createStrategy(options?: {
    sessionValid?: boolean;
    transactionError?: Error;
  }): {
    strategy: JwtStrategy;
    executeRaw: jest.Mock;
    findUnique: jest.Mock;
  } {
    const findUnique = jest
      .fn()
      .mockResolvedValue(
        options?.sessionValid === false
          ? { ...databaseUser, sesiones_autenticacion: [] }
          : databaseUser,
      );
    const executeRaw = jest.fn().mockResolvedValue(1);
    const withTenant = options?.transactionError
      ? jest.fn().mockRejectedValue(options.transactionError)
      : jest.fn(
          (
            _scope: unknown,
            operation: (tx: object) => Promise<unknown>,
          ): Promise<unknown> =>
            operation({
              $executeRaw: executeRaw,
              usuarios: { findUnique },
            }),
        );
    const prisma = { withTenant } as unknown as PrismaService;

    return {
      strategy: new JwtStrategy(config, prisma),
      executeRaw,
      findUnique,
    };
  }

  it('validates and returns the principal when the session is active', async () => {
    const { strategy, executeRaw, findUnique } = createStrategy();

    await expect(strategy.validate(payload)).resolves.toMatchObject({
      sessionId: payload.sid,
      user: {
        id: payload.sub,
        organization: { id: payload.oid },
      },
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('rejects an invalid session without touching activity', async () => {
    const { strategy, executeRaw, findUnique } = createStrategy({
      sessionValid: false,
    });

    await expect(strategy.validate(payload)).rejects.toMatchObject({
      status: 401,
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('renews stale activity without waiting for another concurrent touch', async () => {
    const { strategy, executeRaw, findUnique } = createStrategy();
    findUnique.mockResolvedValue({
      ...databaseUser,
      sesiones_autenticacion: [
        { lastActivityAt: new Date(Date.now() - 120_000) },
      ],
    });

    await expect(strategy.validate(payload)).resolves.toBeDefined();
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('propagates transaction timeouts instead of converting them to 401', async () => {
    const transactionError = new Prisma.PrismaClientKnownRequestError(
      'Transaction already closed',
      {
        code: 'P2028',
        clientVersion: '6.12.0',
      },
    );
    const { strategy } = createStrategy({ transactionError });

    await expect(strategy.validate(payload)).rejects.toBe(transactionError);
  });
});

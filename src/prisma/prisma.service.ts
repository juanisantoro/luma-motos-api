import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { EnvironmentVariables } from '../config/environment';

export interface TenantScope {
  organizationId: string;
  globalAccess: boolean;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnApplicationShutdown, OnModuleInit
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    const [role] = await this.$queryRaw<
      Array<{ rolbypassrls: boolean; rolsuper: boolean }>
    >`
      SELECT role.rolbypassrls, role.rolsuper
      FROM pg_roles AS role
      WHERE role.rolname = current_user
    `;

    if (!role?.rolbypassrls && !role?.rolsuper) {
      return;
    }

    const message =
      'DATABASE_URL must use a non-owner runtime role without SUPERUSER or BYPASSRLS; keep the owner role only in DIRECT_URL for migrations.';
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new Error(message);
    }
    this.logger.warn(message);
  }

  async withTenant<T>(
    scope: TenantScope,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT
          set_config('app.organizacion_id', ${scope.organizationId}, true),
          set_config(
            'app.acceso_global',
            ${scope.globalAccess ? 'true' : 'false'},
            true
          )
      `;

      return operation(tx);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}

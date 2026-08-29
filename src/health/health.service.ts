import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthResponse {
  status: 'ok' | 'error';
  checks: {
    application: 'up';
    database: 'up' | 'down';
  };
  timestamp: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResponse> {
    const timestamp = new Date().toISOString();

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      this.logger.error('Database health check failed');
      throw new ServiceUnavailableException({
        status: 'error',
        checks: {
          application: 'up',
          database: 'down',
        },
        timestamp,
      } satisfies HealthResponse);
    }

    return {
      status: 'ok',
      checks: {
        application: 'up',
        database: 'up',
      },
      timestamp,
    };
  }
}

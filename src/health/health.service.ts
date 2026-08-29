import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

export interface HealthResponse {
  status: 'ok' | 'error';
  checks: {
    application: 'up';
    database: 'up' | 'down';
    smtp: 'configured' | 'not_configured';
  };
  timestamp: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

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
          smtp: this.mailService.isConfigured()
            ? 'configured'
            : 'not_configured',
        },
        timestamp,
      } satisfies HealthResponse);
    }

    return {
      status: 'ok',
      checks: {
        application: 'up',
        database: 'up',
        smtp: this.mailService.isConfigured() ? 'configured' : 'not_configured',
      },
      timestamp,
    };
  }
}

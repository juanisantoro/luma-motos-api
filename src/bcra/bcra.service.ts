import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { computeBcraResumen } from './bcra-situacion';
import {
  BCRA_HISTORICAS_BASE_URL,
  BCRA_REQUEST_TIMEOUT_MS,
} from './bcra.constants';
import type {
  BcraHistoricasResponse,
  BcraSituacionResponse,
} from './bcra.types';

@Injectable()
export class BcraService {
  private readonly logger = new Logger(BcraService.name);

  async getSituacion(
    cuit: string,
    actor: AuthenticatedUser,
  ): Promise<BcraSituacionResponse> {
    const payload = await this.fetchHistoricas(cuit);
    const consultadoEn = new Date().toISOString();

    if ('errorMessages' in payload) {
      if (payload.status === 404) {
        // No history in the financial system - not an error, and not
        // necessarily anything negative about the person.
        const resumen = computeBcraResumen(undefined, cuit, null, consultadoEn);
        return { resumen };
      }
      if (payload.status === 400) {
        // Should not happen - we validate the CUIT before calling BCRA -
        // but surface it clearly instead of a raw 500 if it ever does.
        throw new BadRequestException(
          payload.errorMessages.join(' ') || 'BCRA rejected the identifier.',
        );
      }
      throw new BadGatewayException(
        'BCRA service returned an unexpected error.',
      );
    }

    const { results } = payload;
    const resumen = computeBcraResumen(
      results.periodos,
      cuit,
      results.denominacion ?? null,
      consultadoEn,
    );

    const response: BcraSituacionResponse = { resumen };

    if (this.canSeeDetail(actor)) {
      response.detalle = { periodos: results.periodos ?? [] };
    }

    return response;
  }

  private canSeeDetail(actor: AuthenticatedUser): boolean {
    return actor.role.permissions.includes(
      PERMISSION_CODES.CREDIT_PLANS_BCRA_DETAIL,
    );
  }

  private async fetchHistoricas(
    cuit: string,
  ): Promise<BcraHistoricasResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      BCRA_REQUEST_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetch(`${BCRA_HISTORICAS_BASE_URL}/${cuit}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      // Deliberately do not log the CUIT or any BCRA payload - this branch
      // only ever carries network/timeout failures, never credit data.
      if (controller.signal.aborted) {
        this.logger.warn('BCRA request timed out');
        throw new GatewayTimeoutException(
          'BCRA service did not respond in time. Try again in a moment.',
        );
      }
      this.logger.warn(
        `BCRA request failed: ${error instanceof Error ? error.message : 'unknown network error'}`,
      );
      throw new BadGatewayException(
        'Could not reach the BCRA service. Try again in a moment.',
      );
    } finally {
      clearTimeout(timeout);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new BadGatewayException(
        'BCRA service returned an unreadable response.',
      );
    }

    // The BCRA payload is sensitive credit information about a person - it
    // must only ever live in memory for the lifetime of this request, never
    // touch a log line or a database.
    return body as BcraHistoricasResponse;
  }
}

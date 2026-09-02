import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isValidCuit, normalizeCuit } from '../common/cuit';

/**
 * Validates and normalizes the `:cuit` route param before it ever reaches
 * the BCRA service - length and check digit are checked here so an
 * obviously malformed CUIT/CUIL/CDI never spends a call against the
 * external API (which would just answer its own 400).
 */
@Injectable()
export class CuitParamPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    const normalized = normalizeCuit(value ?? '');
    if (!isValidCuit(normalized)) {
      throw new BadRequestException(
        'Invalid CUIT/CUIL/CDI: it must have 11 digits and a valid check digit.',
      );
    }
    return normalized;
  }
}

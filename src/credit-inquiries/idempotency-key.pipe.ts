import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { IDEMPOTENCY_KEY_PATTERN } from './credit-inquiries.constants';

@Injectable()
export class IdempotencyKeyPipe implements PipeTransform<
  string | undefined,
  string
> {
  transform(value: string | undefined): string {
    if (!value || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
      throw new BadRequestException(
        'Idempotency-Key header must contain 8 to 120 safe characters',
      );
    }
    return value;
  }
}

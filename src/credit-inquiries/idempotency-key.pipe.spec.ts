import { BadRequestException } from '@nestjs/common';
import { IdempotencyKeyPipe } from './idempotency-key.pipe';

describe('IdempotencyKeyPipe', () => {
  const pipe = new IdempotencyKeyPipe();

  it('accepts client-safe idempotency keys', () => {
    expect(pipe.transform('credit-check:request-001')).toBe(
      'credit-check:request-001',
    );
  });

  it('keeps the internal legacy key namespace unreachable to clients', () => {
    expect(() =>
      pipe.transform('_legacy/a1b2c3d4-e5f6-7890-abcd-ef1234567890'),
    ).toThrow(
      new BadRequestException(
        'Idempotency-Key header must contain 8 to 120 safe characters',
      ),
    );
  });
});

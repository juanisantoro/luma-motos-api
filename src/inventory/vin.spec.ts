import { BadRequestException } from '@nestjs/common';
import { normalizeVin, validateVin } from './vin';

describe('VIN helpers', () => {
  it('preserves trimmed display VIN while normalizing its identity', () => {
    expect(validateVin(' ab-c 123456 ')).toEqual({
      vin: 'ab-c 123456',
      normalizedVin: 'ABC123456',
    });
    expect(normalizeVin('SEÑA')).toBe('SENA');
  });

  it.each(['USADA', 'seña', 'sin vin', 'AAAAAA'])(
    'rejects normalized placeholder %s',
    (vin) => expect(() => validateVin(vin)).toThrow(BadRequestException),
  );
});

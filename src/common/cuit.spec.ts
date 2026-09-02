import { isValidCuit, normalizeCuit } from './cuit';

describe('normalizeCuit', () => {
  it('strips hyphens and spaces', () => {
    expect(normalizeCuit('20-38097441-0')).toBe('20380974410');
    expect(normalizeCuit('20 38097441 0')).toBe('20380974410');
  });
});

describe('isValidCuit', () => {
  it('accepts a known-valid CUIT (BCRA docs example)', () => {
    expect(isValidCuit('20380974410')).toBe(true);
    expect(isValidCuit('20-38097441-0')).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(isValidCuit('20380974411')).toBe(false);
  });

  it('rejects anything that is not exactly 11 digits once normalized', () => {
    expect(isValidCuit('2038097441')).toBe(false);
    expect(isValidCuit('203809744100')).toBe(false);
    expect(isValidCuit('')).toBe(false);
    expect(isValidCuit('abcdefghijk')).toBe(false);
  });

  it('rejects a prefix whose algorithm yields the invalid check digit 10, regardless of the last digit', () => {
    expect(isValidCuit('20000000010')).toBe(false);
    expect(isValidCuit('20000000019')).toBe(false);
  });
});

// Shared CUIT/CUIL/CDI validator (AFIP's standard modulo-11 check digit
// algorithm). Introduced for the BCRA "Central de Deudores" lookup (see
// ../bcra) so an obviously malformed identifier never spends a call against
// the external service, but it lives here so any other module that needs to
// validate an Argentine tax id can reuse it instead of re-implementing it.

const CHECK_DIGIT_MULTIPLIERS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/** Strips everything but digits (hyphens, spaces, dots, etc.). */
export function normalizeCuit(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Validates an identifier as a well-formed CUIT/CUIL/CDI: exactly 11 digits
 * once normalized, with a check digit that matches AFIP's standard
 * modulo-11 algorithm. Does not validate the 2-digit type prefix (20, 23,
 * 24, 27, 30, 33, 34, ...) - only length and the check digit are verified,
 * matching what the task asked for.
 */
export function isValidCuit(raw: string): boolean {
  const digits = normalizeCuit(raw);
  if (digits.length !== 11) return false;

  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(digits[i]) * CHECK_DIGIT_MULTIPLIERS[i];
  }

  let checkDigit = 11 - (sum % 11);
  if (checkDigit === 11) checkDigit = 0;
  // AFIP's algorithm has no valid representation for a computed check digit
  // of 10 - no possible last digit makes the number valid in that case.
  if (checkDigit === 10) return false;

  return checkDigit === Number(digits[10]);
}

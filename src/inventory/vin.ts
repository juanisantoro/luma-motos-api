import { BadRequestException } from '@nestjs/common';

const placeholderVins = new Set([
  'USADA',
  'USADO',
  'SENA',
  'SENIA',
  'RESERVA',
  'SINVIN',
  'NOVIN',
  'PENDIENTE',
]);

export function normalizeVin(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function validateVin(value: string): {
  vin: string;
  normalizedVin: string;
} {
  const vin = value.trim();
  const normalizedVin = normalizeVin(vin);
  if (
    normalizedVin.length < 6 ||
    normalizedVin.length > 32 ||
    placeholderVins.has(normalizedVin) ||
    /^([A-Z0-9])\1+$/.test(normalizedVin)
  ) {
    throw new BadRequestException('VIN is invalid');
  }
  return { vin, normalizedVin };
}

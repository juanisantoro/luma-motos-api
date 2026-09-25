import { Prisma } from '@prisma/client';
import {
  addBusinessDays,
  argentinaToday,
  isLicensingOverdue,
  licensingEstimate,
  licensingSummary,
} from './licensing';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('licensing', () => {
  describe('addBusinessDays', () => {
    it('skips weekends', () => {
      // Friday + 1 business day = Monday.
      expect(addBusinessDays(day('2026-09-25'), 1)).toEqual(day('2026-09-28'));
      // Monday + 5 business days = next Monday.
      expect(addBusinessDays(day('2026-09-07'), 5)).toEqual(day('2026-09-14'));
    });

    it('starts counting on Monday when the operation is on a weekend', () => {
      expect(addBusinessDays(day('2026-09-26'), 1)).toEqual(day('2026-09-28'));
      expect(addBusinessDays(day('2026-09-27'), 10)).toEqual(day('2026-10-09'));
    });

    it('ignores the time of day of the start date', () => {
      expect(addBusinessDays(new Date('2026-09-07T22:30:00.000Z'), 1)).toEqual(
        day('2026-09-08'),
      );
    });
  });

  it('estimates the plate window at 10 and 15 business days', () => {
    expect(licensingEstimate(day('2026-08-28'))).toEqual({
      from: day('2026-09-11'),
      to: day('2026-09-18'),
    });
  });

  it('computes today in Argentina, not UTC', () => {
    // 01:30 UTC on the 26th is still the 25th in Buenos Aires (UTC-3).
    expect(argentinaToday(new Date('2026-09-26T01:30:00.000Z'))).toEqual(
      day('2026-09-25'),
    );
  });

  describe('isLicensingOverdue', () => {
    const base = {
      status: 'APROBADA' as const,
      estimatedTo: day('2026-09-18'),
      plateLoaded: false,
      today: day('2026-09-19'),
    };

    it('flags approved operations past the window without plate', () => {
      expect(isLicensingOverdue(base)).toBe(true);
    });

    it('is informative only: not overdue on the last day, with plate, or without window', () => {
      expect(isLicensingOverdue({ ...base, today: day('2026-09-18') })).toBe(
        false,
      );
      expect(isLicensingOverdue({ ...base, plateLoaded: true })).toBe(false);
      expect(isLicensingOverdue({ ...base, estimatedTo: null })).toBe(false);
    });

    it('ignores drafts, rejected and cancelled operations', () => {
      for (const status of ['BORRADOR', 'RECHAZADA', 'CANCELADA'] as const)
        expect(isLicensingOverdue({ ...base, status })).toBe(false);
    });
  });

  describe('licensingSummary', () => {
    const base = {
      mode: 'PAGA_CLIENTE' as const,
      amount: new Prisma.Decimal(85000),
      estimatedFrom: day('2026-09-11'),
      estimatedTo: day('2026-09-18'),
      operationStatus: 'APROBADA' as const,
      plateLoaded: true,
      incomes: [],
      payments: [],
      today: day('2026-09-25'),
    };
    const income = (estado_registro: string, importe = 50000) => ({
      id: `income-${estado_registro}`,
      importe: new Prisma.Decimal(importe),
      estado_registro,
      fecha_ingreso: day('2026-09-15'),
    });

    it('marks historical operations without mode as undefined', () => {
      expect(
        licensingSummary({ ...base, mode: null, amount: null }),
      ).toMatchObject({ mode: null, amount: null, status: 'SIN_DEFINIR' });
    });

    it('tracks the client collection for PAGA_CLIENTE', () => {
      expect(licensingSummary(base)).toMatchObject({
        status: 'COBRO_PENDIENTE',
        collection: { status: 'SIN_REGISTRAR', amount: '0.00' },
      });
      expect(
        licensingSummary({
          ...base,
          incomes: [income('PAGADO'), income('PENDIENTE', 35000)],
        }),
      ).toMatchObject({
        status: 'COBRO_PENDIENTE',
        collection: { status: 'PAGO_PARCIAL', amount: '85000.00' },
      });
      expect(
        licensingSummary({ ...base, incomes: [income('PAGADO', 85000)] }),
      ).toMatchObject({ status: 'COBRADO', collection: { status: 'PAGADO' } });
    });

    it('tracks the gestoría payment for BONIFICADA', () => {
      const payment = (estado: string) => ({
        id: `payment-${estado}`,
        importe: new Prisma.Decimal(60000),
        estado,
        fecha: day('2026-09-12'),
      });
      const bonified = { ...base, mode: 'BONIFICADA' as const, amount: null };
      expect(licensingSummary(bonified).status).toBe('PAGO_PENDIENTE');
      expect(
        licensingSummary({ ...bonified, payments: [payment('PENDIENTE')] }),
      ).toMatchObject({
        status: 'PAGO_PENDIENTE',
        payment: { status: 'PENDIENTE', amount: '60000.00' },
      });
      expect(
        licensingSummary({ ...bonified, payments: [payment('PAGADO')] }),
      ).toMatchObject({ status: 'PAGADO', payment: { status: 'PAGADO' } });
    });

    it('serializes dates and money as strings', () => {
      expect(licensingSummary(base)).toMatchObject({
        amount: '85000',
        estimatedFrom: '2026-09-11',
        estimatedTo: '2026-09-18',
        overdue: false,
      });
    });
  });
});

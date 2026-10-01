import { Prisma } from '@prisma/client';
import {
  addBusinessDays,
  argentinaToday,
  isLicensingOverdue,
  licensingEstimate,
  licensingPlateStatus,
  licensingSummary,
  normalizeLicensePlate,
} from './licensing';
import { AR_NATIONAL_HOLIDAYS, isBusinessDay } from './ar-holidays';

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

    it('skips Argentine national holidays', () => {
      // Friday 2026-10-09 + 1 = Tuesday 13 (Monday 12 is Diversidad Cultural).
      expect(addBusinessDays(day('2026-10-09'), 1)).toEqual(day('2026-10-13'));
      // Holy week 2026: Thursday 2 (Malvinas) and Friday 3 (Viernes Santo).
      expect(addBusinessDays(day('2026-04-01'), 1)).toEqual(day('2026-04-06'));
      // Moved holiday: Soberanía Nacional is observed on Monday 23/11.
      expect(addBusinessDays(day('2026-11-20'), 1)).toEqual(day('2026-11-24'));
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

  it('moves the window when a holiday falls inside it', () => {
    // From Monday 2026-10-05: without holidays it would be 19/10 and 26/10;
    // Monday 12/10 pushes both one business day.
    expect(licensingEstimate(day('2026-10-05'))).toEqual({
      from: day('2026-10-20'),
      to: day('2026-10-27'),
    });
  });

  describe('holiday calendar', () => {
    it('only lists valid dates of its own year', () => {
      for (const [year, dates] of Object.entries(AR_NATIONAL_HOLIDAYS))
        for (const iso of dates) {
          const date = day(iso);
          expect(date.toISOString().slice(0, 10)).toBe(iso);
          expect(iso.startsWith(`${year}-`)).toBe(true);
        }
    });

    it('treats holidays and weekends as non business days', () => {
      expect(isBusinessDay(day('2026-07-09'))).toBe(false);
      expect(isBusinessDay(day('2026-07-11'))).toBe(false);
      expect(isBusinessDay(day('2026-07-08'))).toBe(true);
    });

    it('covers the current year', () => {
      const year = argentinaToday().getUTCFullYear();
      expect(AR_NATIONAL_HOLIDAYS[year]?.length ?? 0).toBeGreaterThan(0);
    });
  });

  it('normalizes license plates like inventory', () => {
    expect(normalizeLicensePlate('  a123 bcd ')).toEqual({
      display: 'A123 BCD',
      normalized: 'A123BCD',
    });
    expect(normalizeLicensePlate('ab-123-cd').normalized).toBe('AB123CD');
  });

  describe('licensingPlateStatus', () => {
    const base = {
      mode: 'BONIFICADA' as const,
      operationStatus: 'APROBADA' as const,
      plateReceived: false,
      overdue: false,
      collectionCovered: false,
    };

    it('is in progress until the plate arrives, and flags the overdue window', () => {
      expect(licensingPlateStatus(base)).toBe('EN_TRAMITE');
      expect(licensingPlateStatus({ ...base, overdue: true })).toBe(
        'EN_TRAMITE_VENCIDA',
      );
    });

    it('is received for BONIFICADA and undefined modes', () => {
      expect(licensingPlateStatus({ ...base, plateReceived: true })).toBe(
        'RECIBIDA',
      );
      expect(
        licensingPlateStatus({ ...base, mode: null, plateReceived: true }),
      ).toBe('RECIBIDA');
    });

    it('separates pending and covered client collections for PAGA_CLIENTE', () => {
      const paid = {
        ...base,
        mode: 'PAGA_CLIENTE' as const,
        plateReceived: true,
      };
      expect(licensingPlateStatus(paid)).toBe('RECIBIDA_COBRO_PENDIENTE');
      expect(licensingPlateStatus({ ...paid, collectionCovered: true })).toBe(
        'RECIBIDA_COBRADA',
      );
    });

    it('does not apply to drafts, rejected or cancelled operations', () => {
      for (const operationStatus of [
        'BORRADOR',
        'RECHAZADA',
        'CANCELADA',
      ] as const)
        expect(licensingPlateStatus({ ...base, operationStatus })).toBe(
          'NO_APLICA',
        );
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
      plateReceived: false,
      today: day('2026-09-19'),
    };

    it('flags approved operations past the window without plate', () => {
      expect(isLicensingOverdue(base)).toBe(true);
    });

    it('is informative only: not overdue on the last day, with plate, or without window', () => {
      expect(isLicensingOverdue({ ...base, today: day('2026-09-18') })).toBe(
        false,
      );
      expect(isLicensingOverdue({ ...base, plateReceived: true })).toBe(false);
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
      plateNumber: 'A123BCD' as string | null,
      plateReceivedAt: day('2026-09-17') as Date | null,
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

    it('summarizes the plate arrival', () => {
      expect(licensingSummary(base).plate).toEqual({
        status: 'RECIBIDA_COBRO_PENDIENTE',
        number: 'A123BCD',
        receivedAt: '2026-09-17',
      });
      expect(
        licensingSummary({
          ...base,
          incomes: [income('PAGADO', 85000)],
        }).plate.status,
      ).toBe('RECIBIDA_COBRADA');
      const pending = licensingSummary({
        ...base,
        plateNumber: null,
        plateReceivedAt: null,
      });
      expect(pending).toMatchObject({
        plateLoaded: false,
        overdue: true,
        plate: { status: 'EN_TRAMITE_VENCIDA', number: null, receivedAt: null },
      });
    });

    it('counts a plate already on the unit as received', () => {
      expect(
        licensingSummary({ ...base, plateReceivedAt: null }).plate.status,
      ).toBe('RECIBIDA_COBRO_PENDIENTE');
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

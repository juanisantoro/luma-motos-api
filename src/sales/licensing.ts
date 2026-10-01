import { luma_estado_operacion, Prisma } from '@prisma/client';
import { isBusinessDay } from './ar-holidays';

// Patentamiento ("licensing") of a sales operation.
//
// The estimated plate arrival window is informative only: it never blocks
// an operation, creates a debt, or moves it to an "expired" state. It exists
// so the administrative grid can show "patente estimada entre X e Y" and
// highlight operations that went past the window without a plate loaded.

export const LICENSING_MODES = ['BONIFICADA', 'PAGA_CLIENTE'] as const;
export type LicensingMode = (typeof LICENSING_MODES)[number];

export const LICENSING_ESTIMATE_BUSINESS_DAYS = { from: 10, to: 15 } as const;

// Normalized catalog names (tipos_ingreso / conceptos_pago_vehiculo) used to
// link a patent collection (income) or payment (vehicle payment) to the
// operation. Both catalogs already ship a "Patente" entry.
export const LICENSING_INCOME_TYPE = 'patente';
export const LICENSING_PAYMENT_CONCEPT = 'patente';

// Operation states in which a missing plate past the window is highlighted.
// Drafts are not a sale yet; rejected/cancelled operations never get a plate.
const OVERDUE_ELIGIBLE_STATES: readonly luma_estado_operacion[] = [
  luma_estado_operacion.PENDIENTE_APROBACION,
  luma_estado_operacion.APROBADA,
  luma_estado_operacion.CERRADA,
];

export function isOverdueEligibleState(status: luma_estado_operacion) {
  return OVERDUE_ELIGIBLE_STATES.includes(status);
}

export const OVERDUE_ELIGIBLE_OPERATION_STATES = OVERDUE_ELIGIBLE_STATES;

// Business days = Monday to Friday except Argentine national holidays
// (./ar-holidays). The window is a reminder, not a legal term.
export function addBusinessDays(start: Date, days: number): Date {
  const result = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (isBusinessDay(result)) remaining -= 1;
  }
  return result;
}

export function licensingEstimate(operationDate: Date) {
  return {
    from: addBusinessDays(operationDate, LICENSING_ESTIMATE_BUSINESS_DAYS.from),
    to: addBusinessDays(operationDate, LICENSING_ESTIMATE_BUSINESS_DAYS.to),
  };
}

// Current business date in Argentina as a UTC-midnight Date, comparable with
// @db.Date columns.
export function argentinaToday(now = new Date()): Date {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${iso}T00:00:00.000Z`);
}

export function isLicensingOverdue(input: {
  status: luma_estado_operacion;
  estimatedTo: Date | null | undefined;
  plateReceived: boolean;
  today: Date;
}) {
  return (
    input.estimatedTo != null &&
    !input.plateReceived &&
    isOverdueEligibleState(input.status) &&
    input.estimatedTo.getTime() < input.today.getTime()
  );
}

export type LicensingIncome = {
  id: string;
  importe: Prisma.Decimal;
  estado_registro: string;
  fecha_ingreso: Date;
};

export type LicensingPayment = {
  id: string;
  importe: Prisma.Decimal;
  estado: string;
  fecha: Date;
};

export type LicensingStatus =
  'SIN_DEFINIR' | 'COBRO_PENDIENTE' | 'COBRADO' | 'PAGO_PENDIENTE' | 'PAGADO';

// Fase 5: where the plate itself stands, independent of the gestoría payment.
// - EN_TRAMITE: not received yet (shown with the estimated window).
// - EN_TRAMITE_VENCIDA: not received and past the estimated window (only a
//   reminder, same rule as `overdue`).
// - RECIBIDA: received; BONIFICADA or mode not defined.
// - RECIBIDA_COBRO_PENDIENTE / RECIBIDA_COBRADA: received with PAGA_CLIENTE,
//   depending on whether the client collection covers the patent.
// - NO_APLICA: drafts, rejected and cancelled operations without a plate.
export const LICENSING_PLATE_STATUSES = [
  'EN_TRAMITE',
  'EN_TRAMITE_VENCIDA',
  'RECIBIDA',
  'RECIBIDA_COBRO_PENDIENTE',
  'RECIBIDA_COBRADA',
  'NO_APLICA',
] as const;
export type LicensingPlateStatus = (typeof LICENSING_PLATE_STATUSES)[number];

export function licensingPlateStatus(input: {
  mode: LicensingMode | null | undefined;
  operationStatus: luma_estado_operacion;
  plateReceived: boolean;
  overdue: boolean;
  collectionCovered: boolean;
}): LicensingPlateStatus {
  if (input.plateReceived) {
    if (input.mode === 'PAGA_CLIENTE')
      return input.collectionCovered
        ? 'RECIBIDA_COBRADA'
        : 'RECIBIDA_COBRO_PENDIENTE';
    return 'RECIBIDA';
  }
  if (!isOverdueEligibleState(input.operationStatus)) return 'NO_APLICA';
  return input.overdue ? 'EN_TRAMITE_VENCIDA' : 'EN_TRAMITE';
}

// A plate counts as received when the administrativa registered its arrival
// (patente_recibida_en) or the unit already carries a plate (used units and
// operations loaded before fase 5).
export function isPlateReceived(input: {
  receivedAt: Date | null | undefined;
  unitPlate: string | null | undefined;
}) {
  return input.receivedAt != null || Boolean(input.unitPlate);
}

// Plate as typed (upper case, single spaces) and its normalized form, same
// rule as inventory (only letters and digits).
export function normalizeLicensePlate(value: string) {
  const display = value.trim().replace(/\s+/g, ' ').toUpperCase();
  return { display, normalized: display.replace(/[^A-Z0-9]/g, '') };
}

function collectionStatus(incomes: LicensingIncome[]) {
  if (!incomes.length) return 'SIN_REGISTRAR' as const;
  if (incomes.every((income) => income.estado_registro === 'PAGADO'))
    return 'PAGADO' as const;
  if (
    incomes.some(
      (income) =>
        income.estado_registro === 'PAGADO' ||
        income.estado_registro === 'PAGO_PARCIAL',
    )
  )
    return 'PAGO_PARCIAL' as const;
  return 'PENDIENTE' as const;
}

function paymentStatus(payments: LicensingPayment[]) {
  if (!payments.length) return 'SIN_REGISTRAR' as const;
  if (payments.some((payment) => payment.estado === 'PAGADO'))
    return 'PAGADO' as const;
  return 'PENDIENTE' as const;
}

function sum(values: Prisma.Decimal[]) {
  return values
    .reduce((total, value) => total.plus(value), new Prisma.Decimal(0))
    .toFixed(2);
}

function dateOnly(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function licensingSummary(input: {
  mode: LicensingMode | null | undefined;
  amount: Prisma.Decimal | null | undefined;
  estimatedFrom: Date | null | undefined;
  estimatedTo: Date | null | undefined;
  operationStatus: luma_estado_operacion;
  plateNumber: string | null | undefined;
  plateReceivedAt: Date | null | undefined;
  incomes: LicensingIncome[];
  payments: LicensingPayment[];
  today: Date;
}) {
  const plateReceived = isPlateReceived({
    receivedAt: input.plateReceivedAt,
    unitPlate: input.plateNumber,
  });
  const collection = collectionStatus(input.incomes);
  const payment = paymentStatus(input.payments);
  // With a known patent amount, the client collection is complete only when
  // the fully collected incomes cover it.
  const collectedTotal = input.incomes
    .filter((income) => income.estado_registro === 'PAGADO')
    .reduce(
      (total, income) => total.plus(income.importe),
      new Prisma.Decimal(0),
    );
  const collectionCovered =
    collection === 'PAGADO' &&
    (!input.amount || collectedTotal.greaterThanOrEqualTo(input.amount));
  const status: LicensingStatus =
    input.mode === 'PAGA_CLIENTE'
      ? collectionCovered
        ? 'COBRADO'
        : 'COBRO_PENDIENTE'
      : input.mode === 'BONIFICADA'
        ? payment === 'PAGADO'
          ? 'PAGADO'
          : 'PAGO_PENDIENTE'
        : 'SIN_DEFINIR';
  const overdue = isLicensingOverdue({
    status: input.operationStatus,
    estimatedTo: input.estimatedTo,
    plateReceived,
    today: input.today,
  });
  return {
    mode: input.mode ?? null,
    amount: input.amount?.toString() ?? null,
    status,
    estimatedFrom: dateOnly(input.estimatedFrom),
    estimatedTo: dateOnly(input.estimatedTo),
    // Kept for compatibility: true when the plate is received.
    plateLoaded: plateReceived,
    overdue,
    plate: {
      status: licensingPlateStatus({
        mode: input.mode,
        operationStatus: input.operationStatus,
        plateReceived,
        overdue,
        collectionCovered,
      }),
      number: input.plateNumber ?? null,
      receivedAt: dateOnly(input.plateReceivedAt),
    },
    collection: {
      status: collection,
      amount: sum(input.incomes.map((income) => income.importe)),
      incomeIds: input.incomes.map((income) => income.id),
    },
    payment: {
      status: payment,
      amount: sum(input.payments.map((item) => item.importe)),
      paymentIds: input.payments.map((item) => item.id),
    },
  };
}

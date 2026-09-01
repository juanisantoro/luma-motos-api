// Motor de cálculo de créditos personales. Función pura, sin acceso a red
// ni a la base de datos, para poder reutilizarla tanto en el backend (para
// persistir el cronograma real al confirmar un crédito) como en el
// frontend (para simular en pantalla mientras el usuario mueve los
// inputs). Si tocás esta lógica, replicá el cambio en el archivo hermano
// del frontend (src/features/credit-plans/creditCalculator.ts).

export type CreditCalculationMethod = 'FRANCES' | 'INTERES_SIMPLE';

export interface CreditInstallmentPreview {
  /** 1-based. */
  number: number;
  amount: number;
}

export interface CreditSimulationResult {
  /** Cuota "estándar" (todas menos, eventualmente, la última). */
  installmentAmount: number;
  totalInterest: number;
  totalAmount: number;
  installments: CreditInstallmentPreview[];
}

function round2(value: number): number {
  // Evita errores de punto flotante del tipo 0.1 + 0.2 al redondear a
  // centavos (los importes siempre se expresan en pesos con 2 decimales).
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Reparte `totalAmount` en `count` cuotas iguales, ajustando la ÚLTIMA
 * cuota para que la suma dé exacto (compensa el resto del redondeo a
 * centavos).
 */
function splitEvenly(totalAmount: number, count: number): number[] {
  const base = round2(totalAmount / count);
  const installments = new Array<number>(count).fill(base);
  const roundedTotal = round2(base * (count - 1));
  installments[count - 1] = round2(totalAmount - roundedTotal);
  return installments;
}

/**
 * Sistema francés: cuota fija, calculada con la fórmula estándar de
 * amortización. `interestRate` es la tasa MENSUAL en porcentaje (ej. 3
 * significa 3% mensual, es decir i = 0.03).
 */
function simulateFrench(
  financedAmount: number,
  installmentCount: number,
  interestRate: number,
): CreditSimulationResult {
  const i = interestRate / 100;
  let rawInstallment: number;
  if (i === 0) {
    rawInstallment = financedAmount / installmentCount;
  } else {
    const factor = Math.pow(1 + i, installmentCount);
    rawInstallment = (financedAmount * (i * factor)) / (factor - 1);
  }
  const installmentAmount = round2(rawInstallment);
  const totalAmount = round2(installmentAmount * installmentCount);
  const amounts = splitEvenly(totalAmount, installmentCount);
  const totalInterest = round2(totalAmount - financedAmount);
  return {
    installmentAmount,
    totalInterest,
    totalAmount,
    installments: amounts.map((amount, index) => ({
      number: index + 1,
      amount,
    })),
  };
}

/**
 * Interés simple prorrateado: el interés se calcula UNA SOLA VEZ sobre el
 * monto financiado (no es una tasa mensual) y se reparte en partes
 * iguales entre las cuotas.
 */
function simulateFlatRate(
  financedAmount: number,
  installmentCount: number,
  interestRate: number,
): CreditSimulationResult {
  const totalInterest = round2(financedAmount * (interestRate / 100));
  const totalAmount = round2(financedAmount + totalInterest);
  const amounts = splitEvenly(totalAmount, installmentCount);
  return {
    installmentAmount: amounts[0] ?? 0,
    totalInterest,
    totalAmount,
    installments: amounts.map((amount, index) => ({
      number: index + 1,
      amount,
    })),
  };
}

export function simulateCredit(
  financedAmount: number,
  installmentCount: number,
  interestRate: number,
  method: CreditCalculationMethod,
): CreditSimulationResult {
  if (!Number.isFinite(financedAmount) || financedAmount <= 0) {
    throw new Error('financedAmount must be a positive number');
  }
  if (!Number.isInteger(installmentCount) || installmentCount < 1) {
    throw new Error('installmentCount must be a positive integer');
  }
  if (!Number.isFinite(interestRate) || interestRate < 0) {
    throw new Error('interestRate must be a non-negative number');
  }
  return method === 'FRANCES'
    ? simulateFrench(financedAmount, installmentCount, interestRate)
    : simulateFlatRate(financedAmount, installmentCount, interestRate);
}

/** Suma `months` meses a `date`, preservando el día cuando el mes destino lo permite. */
function addMonthsUtc(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const result = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return result;
}

export interface CreditInstallmentSchedule extends CreditInstallmentPreview {
  dueDate: Date;
}

/**
 * Arma el cronograma con fechas de vencimiento mensuales a partir de
 * `firstDueDate` (inclusive), una por cuota.
 */
export function buildInstallmentSchedule(
  simulation: CreditSimulationResult,
  firstDueDate: Date,
): CreditInstallmentSchedule[] {
  return simulation.installments.map((installment, index) => ({
    ...installment,
    dueDate: addMonthsUtc(firstDueDate, index),
  }));
}

import {
  plataforma_pago_luma,
  tipo_componente_pago_luma,
} from '@prisma/client';

// Qué lleva cada plataforma de pago de la operación:
// - credit: cuántos créditos de financiera (0, 1 o 2). Con dos, son de
//   financieras distintas y monto_credito es la suma.
// - tradeIn: si entrega una unidad en parte de pago.
// - remainder: cómo se paga lo que no cubren crédito ni parte de pago
//   (null: no queda resto, crédito y parte de pago completan el precio).

type PlatformRule = {
  credit: 0 | 1 | 2;
  tradeIn: boolean;
  remainder: tipo_componente_pago_luma | null;
};

const { EFECTIVO, TRANSFERENCIA_BANCARIA, TARJETA } = tipo_componente_pago_luma;

export const PAYMENT_PLATFORM_RULES: Record<
  plataforma_pago_luma,
  PlatformRule
> = {
  EFECTIVO: { credit: 0, tradeIn: false, remainder: EFECTIVO },
  TRANSFERENCIA: {
    credit: 0,
    tradeIn: false,
    remainder: TRANSFERENCIA_BANCARIA,
  },
  TARJETA: { credit: 0, tradeIn: false, remainder: TARJETA },
  CREDITO: { credit: 1, tradeIn: false, remainder: null },
  CREDITO_CREDITO: { credit: 2, tradeIn: false, remainder: null },
  EFECTIVO_CREDITO: { credit: 1, tradeIn: false, remainder: EFECTIVO },
  TRANSFERENCIA_CREDITO: {
    credit: 1,
    tradeIn: false,
    remainder: TRANSFERENCIA_BANCARIA,
  },
  MOTO_EFECTIVO: { credit: 0, tradeIn: true, remainder: EFECTIVO },
  MOTO_CREDITO: { credit: 1, tradeIn: true, remainder: null },
  MOTO_EFECTIVO_CREDITO: { credit: 1, tradeIn: true, remainder: EFECTIVO },
};

const PLATFORMS = Object.keys(PAYMENT_PLATFORM_RULES) as plataforma_pago_luma[];

export const CREDIT_PAYMENT_PLATFORMS = PLATFORMS.filter(
  (platform) => PAYMENT_PLATFORM_RULES[platform].credit > 0,
);
export const TRADE_IN_PAYMENT_PLATFORMS = PLATFORMS.filter(
  (platform) => PAYMENT_PLATFORM_RULES[platform].tradeIn,
);
/** Plataformas que dejan un resto a pagar (efectivo, transferencia o tarjeta). */
export const REMAINDER_PAYMENT_PLATFORMS = PLATFORMS.filter(
  (platform) => PAYMENT_PLATFORM_RULES[platform].remainder !== null,
);

export function platformHasCredit(
  platform: plataforma_pago_luma | null | undefined,
) {
  return Boolean(platform && PAYMENT_PLATFORM_RULES[platform].credit > 0);
}

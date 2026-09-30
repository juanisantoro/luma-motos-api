import {
  luma_estado_pago,
  Prisma,
  tipo_movimiento_caja_luma,
} from '@prisma/client';
import { databasePaymentStatus, paymentStatus } from '../finance/finance.utils';

/**
 * Collected amount of a payment-plan component: active (non reversed) INGRESO
 * movements of every income linked to it.
 */
export async function componentCollectedAmount(
  tx: Prisma.TransactionClient,
  componentId: string,
  organizationId: string,
): Promise<Prisma.Decimal> {
  const movements = await tx.movimientos_caja.findMany({
    where: {
      organizacion_id: organizationId,
      tipo_movimiento: tipo_movimiento_caja_luma.INGRESO,
      revierte_a_id: null,
      other_movimientos_caja: null,
      ingresos_movimientos_caja_ingreso: {
        is: { componente_pago_id: componentId },
      },
    },
    select: { importe: true },
  });
  return movements.reduce(
    (total, movement) => total.plus(movement.importe),
    new Prisma.Decimal(0),
  );
}

/**
 * Keeps componentes_pago_operacion.estado_pago in line with its collections.
 * Cancelled and non-collectible states are left untouched.
 */
export async function syncComponentPaymentStatus(
  tx: Prisma.TransactionClient,
  componentId: string,
  organizationId: string,
): Promise<Prisma.Decimal> {
  const component = await tx.componentes_pago_operacion.findFirst({
    where: { id: componentId, organizacion_id: organizationId },
    select: {
      importe_esperado: true,
      estado_pago: true,
      financiera_pago_informado_en: true,
    },
  });
  const collected = await componentCollectedAmount(
    tx,
    componentId,
    organizationId,
  );
  if (
    !component ||
    component.estado_pago === luma_estado_pago.CANCELADA ||
    component.estado_pago === luma_estado_pago.NO_EXIGIBLE ||
    component.estado_pago === luma_estado_pago.REINTEGRADO ||
    (component.estado_pago === luma_estado_pago.VENCIDO && collected.isZero())
  )
    return collected;
  // A financing reported as paid by the financiera stays PAGADO whatever net
  // amount came in.
  const next = component.financiera_pago_informado_en
    ? luma_estado_pago.PAGADO
    : (databasePaymentStatus(
        paymentStatus(collected, component.importe_esperado),
      ) as luma_estado_pago);
  if (next !== component.estado_pago)
    await tx.componentes_pago_operacion.update({
      where: {
        id_organizacion_id: {
          id: componentId,
          organizacion_id: organizationId,
        },
      },
      data: { estado_pago: next },
    });
  return collected;
}

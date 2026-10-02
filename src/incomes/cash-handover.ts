import {
  estado_rendicion_luma,
  metodo_cobranza_luma,
  Prisma,
  tipo_componente_pago_luma,
} from '@prisma/client';
import { PERMISSION_CODES } from '../auth/auth.constants';
import {
  financialBadRequest,
  financialConflict,
} from '../finance/finance.errors';

/**
 * Fase 4 - efectivo y rendición.
 *
 * Un ingreso cobrado en EFECTIVO registra quién recibió el dinero
 * (`cobrado_por_personal_id`) y a quién se lo rinde (`rendido_a_personal_id`).
 * Los destinatarios válidos son el personal activo con usuario activo cuyo rol
 * tiene `caja.recibir_rendicion` (asignado por seed a ADMINISTRADOR). Nunca se
 * decide por nombre de rol ni por persona.
 */
export const CASH_HANDOVER_PERMISSION = PERMISSION_CODES.CASH_RECEIVE_HANDOVER;

export interface CashCollectionInput {
  paymentMethod?: metodo_cobranza_luma;
  collectedById?: string;
  handoverToId?: string;
}

export interface CashCollectionColumns {
  medio_pago: metodo_cobranza_luma | null;
  cobrado_por_personal_id: string | null;
  rendido_a_personal_id: string | null;
  estado_rendicion: estado_rendicion_luma | null;
  rendicion_confirmada_en: Date | null;
  rendicion_confirmada_por_personal_id: string | null;
}

/** Medio de cobro por defecto según el tipo de componente del plan. */
export function componentPaymentMethod(
  type: tipo_componente_pago_luma,
): metodo_cobranza_luma | null {
  switch (type) {
    case tipo_componente_pago_luma.EFECTIVO:
      return metodo_cobranza_luma.EFECTIVO;
    case tipo_componente_pago_luma.TRANSFERENCIA_BANCARIA:
      return metodo_cobranza_luma.TRANSFERENCIA_BANCARIA;
    case tipo_componente_pago_luma.TARJETA:
      return metodo_cobranza_luma.TARJETA;
    case tipo_componente_pago_luma.FINANCIACION:
      return metodo_cobranza_luma.DESEMBOLSO_FINANCIERA;
    case tipo_componente_pago_luma.OTRO:
      return metodo_cobranza_luma.OTRO;
    default:
      // TOMA_PARTE_PAGO no entra dinero a caja.
      return null;
  }
}

export function handoverRecipientWhere(
  organizationId: string,
): Prisma.personalWhereInput {
  return {
    organizacion_id: organizationId,
    estado: 'ACTIVO',
    usuarios: {
      is: {
        activo: true,
        roles: {
          is: {
            activo: true,
            permisos_rol: {
              some: { codigo_permiso: CASH_HANDOVER_PERMISSION },
            },
          },
        },
      },
    },
  };
}

export async function assertHandoverRecipient(
  tx: Prisma.TransactionClient,
  personnelId: string,
  organizationId: string,
): Promise<void> {
  const recipient = await tx.personal.findFirst({
    where: { id: personnelId, ...handoverRecipientWhere(organizationId) },
    select: { id: true },
  });
  if (!recipient)
    financialBadRequest(
      'INVALID_HANDOVER_RECIPIENT',
      'Cash must be handed over to active personnel allowed to receive it',
    );
}

async function assertActivePersonnel(
  tx: Prisma.TransactionClient,
  personnelId: string,
  organizationId: string,
): Promise<void> {
  const personnel = await tx.personal.findFirst({
    where: {
      id: personnelId,
      organizacion_id: organizationId,
      estado: 'ACTIVO',
    },
    select: { id: true },
  });
  if (!personnel)
    financialBadRequest(
      'INVALID_COLLECTOR',
      'The personnel who received the payment must be active in the organization',
    );
}

/**
 * Resuelve las columnas de medio/cobrador/rendición de un ingreso.
 * - Sin medio: no toca la rendición (ingresos legacy o sin dato).
 * - EFECTIVO: el cobrador por defecto es quien registra; el destinatario de la
 *   rendición es obligatorio y debe tener `caja.recibir_rendicion`. Si el
 *   cobrador ya es el destinatario, nace RENDIDO (lo recibió él mismo).
 * - Otro medio: no admite destinatario de rendición; el cobrador por defecto
 *   también es quien registra.
 */
export async function resolveCashCollection(
  tx: Prisma.TransactionClient,
  organizationId: string,
  actorPersonnelId: () => Promise<string>,
  input: CashCollectionInput,
  now: Date = new Date(),
): Promise<CashCollectionColumns> {
  const method = input.paymentMethod ?? null;
  if (method !== metodo_cobranza_luma.EFECTIVO) {
    if (input.handoverToId)
      financialBadRequest(
        'HANDOVER_ONLY_FOR_CASH',
        'Only cash collections are handed over',
      );
    if (input.collectedById)
      await assertActivePersonnel(tx, input.collectedById, organizationId);
    // Con medio informado, quien cobró es por defecto quien registra, igual
    // que en efectivo. Sin medio (ingresos legacy) no se inventa un cobrador.
    const nonCashCollector =
      input.collectedById ?? (method ? await actorPersonnelId() : null);
    return {
      medio_pago: method,
      cobrado_por_personal_id: nonCashCollector,
      rendido_a_personal_id: null,
      estado_rendicion: null,
      rendicion_confirmada_en: null,
      rendicion_confirmada_por_personal_id: null,
    };
  }
  const collectorId = input.collectedById ?? (await actorPersonnelId());
  if (input.collectedById)
    await assertActivePersonnel(tx, collectorId, organizationId);
  if (!input.handoverToId)
    financialBadRequest(
      'HANDOVER_RECIPIENT_REQUIRED',
      'Cash collections require the personnel who will receive the cash',
    );
  await assertHandoverRecipient(tx, input.handoverToId, organizationId);
  const selfHandover = input.handoverToId === collectorId;
  return {
    medio_pago: method,
    cobrado_por_personal_id: collectorId,
    rendido_a_personal_id: input.handoverToId,
    estado_rendicion: selfHandover
      ? estado_rendicion_luma.RENDIDO
      : estado_rendicion_luma.PENDIENTE_RENDICION,
    rendicion_confirmada_en: selfHandover ? now : null,
    rendicion_confirmada_por_personal_id: selfHandover ? collectorId : null,
  };
}

export function assertHandoverEditable(income: {
  estado_rendicion: estado_rendicion_luma | null;
}): void {
  if (income.estado_rendicion === estado_rendicion_luma.RENDIDO)
    financialConflict(
      'HANDOVER_ALREADY_CONFIRMED',
      'Cash already handed over: method, collector and recipient are locked',
    );
}

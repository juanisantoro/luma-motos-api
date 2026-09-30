import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  componentPaymentMethod,
  handoverRecipientWhere,
  resolveCashCollection,
} from './cash-handover';

describe('cash handover rules', () => {
  const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
  const actorPersonnelId = 'f4b6ce19-ce56-4125-b058-e1f087c742bc';
  const recipientId = '2c9f6b9a-1c55-4b1d-9d4c-6b4c3c1f0a11';
  const sellerId = '5d6c0f0e-6a0b-4f4c-9f0e-2b1a8c7d6e55';
  const now = new Date('2026-09-29T15:00:00.000Z');

  const tx = (validIds: string[]) => {
    const findFirst = jest.fn(
      ({ where }: { where: Prisma.personalWhereInput }) =>
        Promise.resolve(
          validIds.includes(where.id as string) ? { id: where.id } : null,
        ),
    );
    return {
      client: {
        personal: { findFirst },
      } as unknown as Prisma.TransactionClient,
      findFirst,
    };
  };

  const code = (error: unknown) =>
    (error as BadRequestException).getResponse() as { code: string };

  it('requires the handover recipient for cash collections', async () => {
    const { client } = tx([actorPersonnelId]);
    const error = await resolveCashCollection(
      client,
      organizationId,
      () => Promise.resolve(actorPersonnelId),
      { paymentMethod: 'EFECTIVO' },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(code(error).code).toBe('HANDOVER_RECIPIENT_REQUIRED');
  });

  it('defaults the collector to the actor and leaves the handover pending', async () => {
    const { client, findFirst } = tx([recipientId]);
    const result = await resolveCashCollection(
      client,
      organizationId,
      () => Promise.resolve(actorPersonnelId),
      { paymentMethod: 'EFECTIVO', handoverToId: recipientId },
      now,
    );

    expect(result).toEqual({
      medio_pago: 'EFECTIVO',
      cobrado_por_personal_id: actorPersonnelId,
      rendido_a_personal_id: recipientId,
      estado_rendicion: 'PENDIENTE_RENDICION',
      rendicion_confirmada_en: null,
      rendicion_confirmada_por_personal_id: null,
    });
    // The recipient is validated by permission, never by role name.
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: recipientId, ...handoverRecipientWhere(organizationId) },
      select: { id: true },
    });
  });

  it('rejects recipients without caja.recibir_rendicion', async () => {
    const { client } = tx([sellerId]);
    const error = await resolveCashCollection(
      client,
      organizationId,
      () => Promise.resolve(actorPersonnelId),
      {
        paymentMethod: 'EFECTIVO',
        collectedById: sellerId,
        handoverToId: actorPersonnelId,
      },
    ).catch((caught: unknown) => caught);

    expect(code(error).code).toBe('INVALID_HANDOVER_RECIPIENT');
  });

  it('marks the cash as handed over when the collector is the recipient', async () => {
    const { client } = tx([recipientId]);
    const result = await resolveCashCollection(
      client,
      organizationId,
      () => Promise.resolve(recipientId),
      { paymentMethod: 'EFECTIVO', handoverToId: recipientId },
      now,
    );

    expect(result).toMatchObject({
      estado_rendicion: 'RENDIDO',
      rendicion_confirmada_en: now,
      rendicion_confirmada_por_personal_id: recipientId,
    });
  });

  it('does not accept a handover for non-cash collections', async () => {
    const { client } = tx([recipientId]);
    const error = await resolveCashCollection(
      client,
      organizationId,
      () => Promise.resolve(actorPersonnelId),
      { paymentMethod: 'TRANSFERENCIA_BANCARIA', handoverToId: recipientId },
    ).catch((caught: unknown) => caught);

    expect(code(error).code).toBe('HANDOVER_ONLY_FOR_CASH');
  });

  it('builds the recipient lookup from the permission', () => {
    expect(handoverRecipientWhere(organizationId)).toEqual({
      organizacion_id: organizationId,
      estado: 'ACTIVO',
      usuarios: {
        is: {
          activo: true,
          roles: {
            is: {
              activo: true,
              permisos_rol: {
                some: { codigo_permiso: 'caja.recibir_rendicion' },
              },
            },
          },
        },
      },
    });
  });

  it('maps payment-plan components to collection methods', () => {
    expect(componentPaymentMethod('EFECTIVO')).toBe('EFECTIVO');
    expect(componentPaymentMethod('FINANCIACION')).toBe(
      'DESEMBOLSO_FINANCIERA',
    );
    expect(componentPaymentMethod('TOMA_PARTE_PAGO')).toBeNull();
  });
});

import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CashService } from '../cash/cash.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CREDIT_PAYMENT_PLATFORMS,
  PAYMENT_PLATFORM_RULES,
  REMAINDER_PAYMENT_PLATFORMS,
  platformHasCredit,
} from './payment-platforms';
import type { SalesPaymentComponentDto } from './sales.dto';
import { SalesService } from './sales.service';

describe('Plataformas de pago', () => {
  it('tiene crédito en las combinaciones con crédito', () => {
    expect(CREDIT_PAYMENT_PLATFORMS).toEqual(
      expect.arrayContaining(['TRANSFERENCIA_CREDITO', 'CREDITO_CREDITO']),
    );
    expect(platformHasCredit('TARJETA')).toBe(false);
    expect(platformHasCredit('TRANSFERENCIA')).toBe(false);
    expect(platformHasCredit('CREDITO_CREDITO')).toBe(true);
  });

  it('paga el resto según la plataforma', () => {
    expect(PAYMENT_PLATFORM_RULES.TRANSFERENCIA.remainder).toBe(
      'TRANSFERENCIA_BANCARIA',
    );
    expect(PAYMENT_PLATFORM_RULES.TRANSFERENCIA_CREDITO.remainder).toBe(
      'TRANSFERENCIA_BANCARIA',
    );
    expect(PAYMENT_PLATFORM_RULES.TARJETA.remainder).toBe('TARJETA');
    expect(REMAINDER_PAYMENT_PLATFORMS).not.toContain('CREDITO_CREDITO');
  });

  describe('plan de pagos', () => {
    const service = new SalesService(
      {} as PrismaService,
      {} as AuditService,
      {} as CashService,
    );
    const validate = (
      platform: string,
      credit: number | null,
      components: SalesPaymentComponentDto[],
    ) =>
      (
        service as unknown as {
          validatePaymentPlanContract: (
            operation: unknown,
            components: SalesPaymentComponentDto[],
          ) => void;
        }
      ).validatePaymentPlanContract(
        {
          plataforma_pago: platform,
          monto_credito: credit === null ? null : new Prisma.Decimal(credit),
        },
        components,
      );
    const financing = (amount: number, financialInstitutionId: string) =>
      ({
        type: 'FINANCIACION',
        amount,
        financialInstitutionId,
      }) as SalesPaymentComponentDto;

    it('acepta crédito + crédito de dos financieras', () => {
      expect(() =>
        validate('CREDITO_CREDITO', 100, [
          financing(60, '00000000-0000-4000-8000-000000000001'),
          financing(40, '00000000-0000-4000-8000-000000000002'),
        ]),
      ).not.toThrow();
    });

    it('rechaza crédito + crédito con una sola financiera', () => {
      expect(() =>
        validate('CREDITO_CREDITO', 100, [
          financing(60, '00000000-0000-4000-8000-000000000001'),
          financing(40, '00000000-0000-4000-8000-000000000001'),
        ]),
      ).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'DOUBLE_CREDIT_INSTITUTIONS_REQUIRED',
          }) as unknown,
        }) as Error,
      );
    });

    it('acepta transferencia + crédito', () => {
      expect(() =>
        validate('TRANSFERENCIA_CREDITO', 60, [
          financing(60, '00000000-0000-4000-8000-000000000001'),
          { type: 'TRANSFERENCIA_BANCARIA', amount: 40 },
        ]),
      ).not.toThrow();
    });

    it('pide un resto en tarjeta', () => {
      expect(() =>
        validate('TARJETA', null, [{ type: 'TARJETA', amount: 100 }]),
      ).not.toThrow();
      expect(() =>
        validate('TARJETA', 100, [
          financing(100, '00000000-0000-4000-8000-000000000001'),
        ]),
      ).toThrow(
        'Payment components do not match the selected payment platform',
      );
    });
  });
});

import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CashService } from '../cash/cash.service';
import { PrismaService } from '../prisma/prisma.service';
import { CommissionsService } from './commissions.service';

describe('Escalas de comisiones', () => {
  it('carga las escalas aparte, con la organización y la política', async () => {
    const tx = {
      escalas_comisiones: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      politicas_comisiones: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'p1' }),
      },
    };
    const service = new CommissionsService(
      {} as PrismaService,
      {} as AuditService,
      {} as CashService,
    );

    await (
      service as unknown as {
        replacePolicyTiers: (...args: unknown[]) => Promise<unknown>;
      }
    ).replacePolicyTiers(tx, 'p1', 'org', [
      { minUnits: 1, maxUnits: 4, fixedAmount: '100000.00' },
      { minUnits: 5, maxUnits: null, fixedAmount: '150000.00' },
    ]);

    expect(tx.escalas_comisiones.deleteMany).toHaveBeenCalledWith({
      where: { politica_id: 'p1', organizacion_id: 'org' },
    });
    expect(tx.escalas_comisiones.createMany).toHaveBeenCalledWith({
      data: [
        {
          politica_id: 'p1',
          organizacion_id: 'org',
          minimo_ventas: 1,
          maximo_ventas: 4,
          importe_fijo: new Prisma.Decimal('100000.00'),
        },
        {
          politica_id: 'p1',
          organizacion_id: 'org',
          minimo_ventas: 5,
          maximo_ventas: null,
          importe_fijo: new Prisma.Decimal('150000.00'),
        },
      ],
    });
  });
});

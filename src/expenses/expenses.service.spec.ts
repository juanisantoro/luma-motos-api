import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CashService } from '../cash/cash.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExpensesService } from './expenses.service';

describe('ExpensesService', () => {
  const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
  const actor: AuthenticatedUser = {
    id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
    email: 'administrativa@luma.test',
    name: 'Administrativa',
    active: true,
    globalAccess: false,
    organization: {
      id: organizationId,
      code: 'LUMA',
      name: 'Luma',
      type: 'CASA_CENTRAL',
    },
    role: {
      id: '4bd1189b-2bb1-4258-889b-4500de5eeade',
      code: 'ADMINISTRATIVA',
      name: 'Administrativa',
      system: true,
      permissions: ['gastos.consultar'],
    },
    branch: null,
  };
  const expense = {
    id: '7d5cc401-544e-4651-9bd6-52495887fecd',
    organizacion_id: organizationId,
    sucursal_id: null,
    fecha_generacion: new Date('2026-08-20T00:00:00.000Z'),
    categoria: 'GESTORIA',
    referencia_origen: null,
    unidad_vehiculo_id: null,
    operacion_id: null,
    detalle: 'Informe',
    importe: new Prisma.Decimal('100'),
    moneda: 'ARS',
    recuperable: false,
    estado_pago: 'PAGADO',
    datos_inferidos: {},
    creado_en: new Date('2026-08-20T10:00:00.000Z'),
    actualizado_en: new Date('2026-08-20T10:00:00.000Z'),
    sucursales: null,
    operaciones: null,
    unidades_vehiculos: null,
    personal: {
      id: 'f4b6ce19-ce56-4125-b058-e1f087c742bc',
      nombre_completo: 'Administrativa',
    },
    movimientos_caja: [
      {
        tipo_movimiento: 'EGRESO',
        importe: new Prisma.Decimal('40'),
        contabilizado_en: new Date('2026-08-20T10:00:00.000Z'),
        cuentas_caja: {
          id: 'ed533c59-526d-45e8-aed4-f909aaaf09f4',
          codigo: 'CAJA',
          nombre: 'Caja',
          tipo_cuenta: 'CAJA',
        },
        personal: {
          id: 'f4b6ce19-ce56-4125-b058-e1f087c742bc',
          nombre_completo: 'Administrativa',
        },
      },
    ],
  };
  const findMany = jest
    .fn<Promise<unknown[]>, [Prisma.gastosFindManyArgs]>()
    .mockResolvedValue([
      expense,
      {
        ...expense,
        id: '8346e2ae-490a-4815-b8bc-87a355656d11',
        estado_pago: 'PAGO_PARCIAL',
        movimientos_caja: [],
      },
    ]);
  const count = jest.fn().mockResolvedValue(2);
  const transaction = {
    gastos: { findMany, count },
  } as unknown as Prisma.TransactionClient;
  const withTenant = jest.fn(
    (
      _scope: unknown,
      operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) => operation(transaction),
  );
  const service = new ExpensesService(
    { withTenant } as unknown as PrismaService,
    {} as AuditService,
    {} as CashService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('filters by the payment state derived from active movements', async () => {
    const result = await service.findAll(
      { page: 1, limit: 20, status: 'PARCIAL' },
      actor,
    );

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: expense.id,
      paymentStatus: 'PARCIAL',
    });
    expect(findMany.mock.calls[0]?.[0].where).not.toHaveProperty('estado_pago');
    expect(findMany.mock.calls[0]?.[0]).toHaveProperty('take', 10_001);
    expect(count).not.toHaveBeenCalled();
  });

  it('uses database pagination when no computed filter is requested', async () => {
    findMany.mockResolvedValueOnce([expense]);

    const result = await service.findAll({ page: 2, limit: 1 }, actor);

    expect(result).toMatchObject({ total: 2, page: 2, limit: 1 });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      skip: 1,
      take: 1,
    });
    expect(count).toHaveBeenCalled();
  });
});

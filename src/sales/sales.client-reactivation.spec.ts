import type { Prisma } from '@prisma/client';
import type { AuditService } from '../audit/audit.service';
import type { CashService } from '../cash/cash.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CreateSalesOperationDto } from './sales.dto';
import { SalesService } from './sales.service';

// Un cliente no debería quedar inactivo: si lo está, la venta lo reactiva en
// vez de rechazarse.
describe('SalesService client reactivation', () => {
  const organizationId = '8fa94171-13b3-40b5-8c33-1f7d8ea94c75';
  const clientId = '7d5cc401-544e-4651-9bd6-52495887fecd';
  const service = new SalesService(
    {} as PrismaService,
    {} as AuditService,
    {} as CashService,
  );
  const resolveClient = (
    tx: Prisma.TransactionClient,
    input: Partial<CreateSalesOperationDto>,
  ) =>
    (
      service as unknown as {
        resolveClient(
          tx: Prisma.TransactionClient,
          input: Partial<CreateSalesOperationDto>,
          organizationId: string,
        ): Promise<string>;
      }
    ).resolveClient(tx, input, organizationId);

  function transaction(existing: { id: string; activo: boolean } | null) {
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      clientes: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update,
        create: jest.fn(),
      },
    } as unknown as Prisma.TransactionClient;
    return { tx, update };
  }

  it('reactivates an inactive client matched by document instead of rejecting the sale', async () => {
    const { tx, update } = transaction({ id: clientId, activo: false });

    await expect(
      resolveClient(tx, {
        client: {
          documentType: 'DNI',
          documentNumber: '30111222',
          fullName: 'Ana Pérez',
          phone: '1155550000',
        },
      }),
    ).resolves.toBe(clientId);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: clientId },
        data: expect.objectContaining({ activo: true }) as unknown,
      }),
    );
  });

  it('reactivates an inactive client selected by id', async () => {
    const { tx, update } = transaction({ id: clientId, activo: false });

    await expect(resolveClient(tx, { clientId })).resolves.toBe(clientId);
    expect(update).toHaveBeenCalledWith({
      where: { id: clientId },
      data: { activo: true },
    });
  });

  it('leaves an active client selected by id untouched', async () => {
    const { tx, update } = transaction({ id: clientId, activo: true });

    await expect(resolveClient(tx, { clientId })).resolves.toBe(clientId);
    expect(update).not.toHaveBeenCalled();
  });
});

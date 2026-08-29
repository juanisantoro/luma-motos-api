import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from './inventory.service';
import { InventoryBranchesController } from './inventory.controller';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedAuditEvent } from '../audit/audit.service';

describe('InventoryService', () => {
  const actor: AuthenticatedUser = {
    id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
    email: 'admin@luma.test',
    name: null,
    active: true,
    globalAccess: false,
    organization: {
      id: '8fa94171-13b3-40b5-8c33-1f7d8ea94c75',
      code: 'LUMA',
      name: 'Luma',
      type: 'CASA_CENTRAL',
    },
    role: { code: 'ADMINISTRADOR', name: 'Administrador', permissions: [] },
    branch: null,
  };

  it('limits inventory lists to the actor tenant and requested vehicle type', async () => {
    const count = jest
      .fn<Promise<number>, [Prisma.unidades_vehiculosCountArgs]>()
      .mockResolvedValue(0);
    const findMany = jest
      .fn<Promise<unknown[]>, [Prisma.unidades_vehiculosFindManyArgs]>()
      .mockResolvedValue([]);
    const transaction = {
      unidades_vehiculos: { count, findMany },
    } as unknown as Prisma.TransactionClient;
    const withTenant = jest
      .fn()
      .mockImplementation(
        (_scope, work: (tx: Prisma.TransactionClient) => unknown) =>
          work(transaction),
      );
    const service = new InventoryService(
      { withTenant } as unknown as PrismaService,
      {} as AuditService,
    );

    await service.findAll({ vehicleType: 'MOTO', page: 1, limit: 50 }, actor);

    expect(withTenant).toHaveBeenCalledWith(
      { organizationId: actor.organization.id, globalAccess: false },
      expect.any(Function),
    );
    expect(count.mock.calls[0][0].where).toMatchObject({
      organizacion_id: actor.organization.id,
      versiones_vehiculos: { modelos_vehiculos: { tipo_vehiculo: 'MOTO' } },
    });
  });

  it('reports duplicate VIN persistence failures as conflicts', async () => {
    const execute = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.12.0',
      }),
    );
    const service = new InventoryService(
      {} as PrismaService,
      { execute } as unknown as AuditService,
    );

    await expect(
      service.create(
        {
          versionId: '4de88c4c-3382-4f9b-ae60-98147159c977',
          vin: 'ABC123456',
          condition: 'NUEVO',
          branchId: 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2',
          acquisitionOrigin: 'PROVEEDOR',
        },
        actor,
      ),
    ).rejects.toThrow(
      new ConflictException('An inventory unit with that VIN already exists'),
    );
  });

  it('rejects duplicate normalized VINs inside a bulk request before opening a transaction', async () => {
    const execute = jest.fn();
    const service = new InventoryService(
      {} as PrismaService,
      { execute } as unknown as AuditService,
    );
    const unit = {
      versionId: '4de88c4c-3382-4f9b-ae60-98147159c977',
      condition: 'NUEVO' as const,
      branchId: 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2',
      acquisitionOrigin: 'PROVEEDOR' as const,
    };

    await expect(
      service.createBulk(
        {
          units: [
            { ...unit, vin: 'ABC-123456' },
            { ...unit, vin: 'abc 123456' },
          ],
        },
        actor,
      ),
    ).rejects.toThrow(
      new BadRequestException('Bulk inventory units must have unique VINs'),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('audits a global create against the selected target organization', async () => {
    const otherOrganizationId = '7d5cc401-544e-4651-9bd6-52495887fecd';
    let event: AuthenticatedAuditEvent | undefined;
    const execute = jest
      .fn<
        Promise<unknown>,
        [
          AuthenticatedAuditEvent,
          (transaction: Prisma.TransactionClient) => Promise<unknown>,
        ]
      >()
      .mockImplementation((auditEvent) => {
        event = auditEvent;
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: '6.12.0',
          }),
        );
      });
    const service = new InventoryService(
      {} as PrismaService,
      { execute } as unknown as AuditService,
    );

    await expect(
      service.create(
        {
          versionId: '4de88c4c-3382-4f9b-ae60-98147159c977',
          vin: 'ABC123456',
          condition: 'NUEVO',
          branchId: 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2',
          acquisitionOrigin: 'PROVEEDOR',
          organizationId: otherOrganizationId,
        },
        { ...actor, globalAccess: true },
      ),
    ).rejects.toThrow(ConflictException);

    expect(event).toMatchObject({
      organizationId: actor.organization.id,
      targetOrganizationId: otherOrganizationId,
    });
  });

  it('paginates inventory movements', async () => {
    const count = jest
      .fn<Promise<number>, [Prisma.movimientos_inventarioCountArgs]>()
      .mockResolvedValue(1);
    const findMany = jest
      .fn<Promise<unknown[]>, [Prisma.movimientos_inventarioFindManyArgs]>()
      .mockResolvedValue([]);
    const transaction = {
      unidades_vehiculos: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ organizacion_id: actor.organization.id }),
      },
      movimientos_inventario: { count, findMany },
    } as unknown as Prisma.TransactionClient;
    const service = new InventoryService(
      {
        withTenant: jest
          .fn()
          .mockImplementation(
            (
              _scope: unknown,
              work: (client: Prisma.TransactionClient) => Promise<unknown>,
            ) => work(transaction),
          ),
      } as unknown as PrismaService,
      {} as AuditService,
    );

    await expect(
      service.movements(
        '7d5cc401-544e-4651-9bd6-52495887fecd',
        { page: 2, limit: 25 },
        actor,
      ),
    ).resolves.toEqual({ items: [], total: 1, page: 2, limit: 25 });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ skip: 25, take: 25 });
  });

  it('protects the branch lookup with inventory read permission', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, InventoryBranchesController),
    ).toEqual([PERMISSION_CODES.INVENTORY_READ]);
  });

  it('moves an EN_STOCK unit and appends a transfer movement', async () => {
    const unitId = '7d5cc401-544e-4651-9bd6-52495887fecd';
    const originId = 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2';
    const destinationId = '4de88c4c-3382-4f9b-ae60-98147159c977';
    const unit = {
      id: unitId,
      version_id: '84e778cc-7616-4792-b6db-d89f100bb6f1',
      condicion: 'NUEVO',
      vin_mostrado: 'ABC123456',
      numero_motor: null,
      patente: null,
      anio_fabricacion: null,
      kilometraje_km: 0,
      color: null,
      sucursal_id: originId,
      proveedor_id: null,
      origen_adquisicion: 'PROVEEDOR',
      costo_compra: null,
      estado_inventario: 'EN_STOCK',
      recibido_en: new Date(),
      creado_en: new Date(),
      actualizado_en: new Date(),
      organizacion_id: actor.organization.id,
      versiones_vehiculos: {
        id: '84e778cc-7616-4792-b6db-d89f100bb6f1',
        nombre: 'Version',
        modelos_vehiculos: {
          nombre: 'Model',
          tipo_vehiculo: 'MOTO',
          marcas_vehiculos: { nombre: 'Brand' },
        },
      },
      sucursales: { id: destinationId, nombre: 'Destination' },
      proveedores: null,
    };
    const update = jest
      .fn<Promise<unknown>, [Prisma.unidades_vehiculosUpdateArgs]>()
      .mockResolvedValue({ ...unit, sucursal_id: destinationId });
    const createMovement = jest
      .fn<Promise<unknown>, [Prisma.movimientos_inventarioCreateArgs]>()
      .mockResolvedValue({
        id: 'a5ed870b-c3b0-4dcb-8cc8-905e1a0126b9',
        unidad_vehiculo_id: unitId,
        tipo_movimiento: 'TRASLADO',
        sucursal_origen_id: originId,
        sucursal_destino_id: destinationId,
        solicitud_abastecimiento_id: null,
        ocurrido_en: new Date(),
        notas: null,
      });
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: unitId }]),
      unidades_vehiculos: {
        findFirst: jest.fn().mockResolvedValue(unit),
        update,
      },
      sucursales: {
        findFirst: jest.fn().mockResolvedValue({ id: destinationId }),
      },
      personal: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: '904e2a34-8285-48fa-b64c-24a80d94f9cb' }),
      },
      movimientos_inventario: { create: createMovement },
    } as unknown as Prisma.TransactionClient;
    const execute = jest
      .fn()
      .mockImplementation(
        (_event, work: (tx: Prisma.TransactionClient) => unknown) =>
          work(transaction),
      );
    const service = new InventoryService(
      {} as PrismaService,
      { execute } as unknown as AuditService,
    );

    await service.transfer(
      unitId,
      { destinationBranchId: destinationId },
      actor,
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { sucursal_id: destinationId },
      }),
    );
    expect(createMovement.mock.calls[0][0].data).toMatchObject({
      tipo_movimiento: 'TRASLADO',
      sucursal_origen_id: originId,
      sucursal_destino_id: destinationId,
    });
  });
});

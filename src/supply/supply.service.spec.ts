import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedAuditEvent } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupplyService } from './supply.service';

describe('SupplyService', () => {
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

  it('rejects a non-forward supply transition', async () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ id: '7d5cc401-544e-4651-9bd6-52495887fecd' }]),
      solicitudes_abastecimiento: {
        findFirst: jest.fn().mockResolvedValue({
          estado: 'PENDIENTE_CONFIRMACION',
          organizacion_id: actor.organization.id,
        }),
      },
    } as unknown as Prisma.TransactionClient;
    const execute = jest
      .fn()
      .mockImplementation(
        (_event, work: (tx: Prisma.TransactionClient) => unknown) =>
          work(transaction),
      );
    const service = new SupplyService(
      {} as PrismaService,
      { execute } as unknown as AuditService,
    );

    await expect(
      service.transition(
        '7d5cc401-544e-4651-9bd6-52495887fecd',
        { toStatus: 'PEDIDO' },
        actor,
      ),
    ).rejects.toThrow(
      new BadRequestException('Invalid supply request transition'),
    );
  });

  it('replays the linked unit and movement for an already received request', async () => {
    const requestId = '7d5cc401-544e-4651-9bd6-52495887fecd';
    const unitId = 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2';
    const current = {
      id: requestId,
      proveedor_id: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
      disponibilidad_proveedor_id: null,
      operacion_id: null,
      version_id: '4de88c4c-3382-4f9b-ae60-98147159c977',
      condicion: 'NUEVO',
      sucursal_llegada_id: '84e778cc-7616-4792-b6db-d89f100bb6f1',
      estado: 'RECIBIDO',
      referencia_proveedor: null,
      costo_estimado: null,
      unidad_vehiculo_recibida_id: unitId,
      solicitado_en: new Date(),
      confirmado_en: null,
      pedido_en: null,
      despachado_en: null,
      recibido_en: new Date(),
      asignado_en: null,
      creado_en: new Date(),
      actualizado_en: new Date(),
      notas: null,
      proveedores: {
        id: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
        razon_social: 'Proveedor',
      },
      versiones_vehiculos: {
        id: '4de88c4c-3382-4f9b-ae60-98147159c977',
        nombre: 'Modelo',
        modelos_vehiculos: {
          id: '7d5cc401-544e-4651-9bd6-52495887fecd',
          nombre: 'Modelo base',
          tipo_vehiculo: 'MOTO',
          marcas_vehiculos: {
            id: 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2',
            nombre: 'Marca',
          },
        },
      },
      sucursales: {
        id: '84e778cc-7616-4792-b6db-d89f100bb6f1',
        codigo: 'CASA',
        nombre: 'Sucursal',
      },
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: requestId }]),
      solicitudes_abastecimiento: {
        findFirst: jest.fn().mockResolvedValue(current),
      },
      unidades_vehiculos: {
        findFirst: jest.fn().mockResolvedValue({
          id: unitId,
          version_id: current.version_id,
          vin_mostrado: 'ABC123456',
          vin_normalizado: 'ABC123456',
          condicion: 'NUEVO',
          numero_motor: null,
          patente: null,
          anio_fabricacion: null,
          kilometraje_km: 0,
          color: null,
          sucursal_id: current.sucursal_llegada_id,
          proveedor_id: current.proveedor_id,
          origen_adquisicion: 'PROVEEDOR',
          costo_compra: null,
          estado_inventario: 'EN_STOCK',
          recibido_en: new Date(),
          creado_en: new Date(),
          actualizado_en: new Date(),
          organizacion_id: actor.organization.id,
          versiones_vehiculos: current.versiones_vehiculos,
          sucursales: current.sucursales,
          proveedores: current.proveedores,
        }),
      },
      movimientos_inventario: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'a5ed870b-c3b0-4dcb-8cc8-905e1a0126b9',
          unidad_vehiculo_id: unitId,
          tipo_movimiento: 'RECEPCION',
          sucursal_origen_id: null,
          sucursal_destino_id: current.sucursal_llegada_id,
          solicitud_abastecimiento_id: requestId,
          ocurrido_en: new Date(),
          notas: null,
          organizacion_id: actor.organization.id,
          creado_en: new Date(),
        }),
      },
    } as unknown as Prisma.TransactionClient;
    const execute = jest
      .fn()
      .mockImplementation(
        (_event, work: (tx: Prisma.TransactionClient) => unknown) =>
          work(transaction),
      );
    const service = new SupplyService(
      {} as PrismaService,
      { execute } as unknown as AuditService,
    );

    const result = await service.receive(
      requestId,
      {
        vin: 'ABC123456',
        branchId: current.sucursal_llegada_id,
        idempotencyKey: 'receive-once',
      },
      actor,
    );

    expect(result).toMatchObject({
      replayed: true,
      unit: { id: unitId },
      inventoryMovement: { id: 'a5ed870b-c3b0-4dcb-8cc8-905e1a0126b9' },
    });
    expect(result.supplyRequest).not.toHaveProperty('estimatedCost');
    expect(result.unit).not.toHaveProperty('purchaseCost');
  });

  it('requires reception at the canonical arrival branch', async () => {
    const requestId = '7d5cc401-544e-4651-9bd6-52495887fecd';
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: requestId }]),
      solicitudes_abastecimiento: {
        findFirst: jest.fn().mockResolvedValue({
          organizacion_id: actor.organization.id,
          sucursal_llegada_id: '84e778cc-7616-4792-b6db-d89f100bb6f1',
        }),
      },
    } as unknown as Prisma.TransactionClient;
    const service = new SupplyService(
      {} as PrismaService,
      {
        execute: jest
          .fn<
            Promise<unknown>,
            [
              AuthenticatedAuditEvent,
              (client: Prisma.TransactionClient) => Promise<unknown>,
            ]
          >()
          .mockImplementation((_event, work) => work(transaction)),
      } as unknown as AuditService,
    );

    await expect(
      service.receive(
        requestId,
        {
          vin: 'ABC123456',
          branchId: 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2',
        },
        actor,
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'Reception branch must match the supply request arrival branch',
      ),
    );
  });

  it('receives supplier stock and assigns it atomically to the linked operation', async () => {
    const requestId = '7d5cc401-544e-4651-9bd6-52495887fecd';
    const operationId = '4de88c4c-3382-4f9b-ae60-98147159c977';
    const availabilityId = 'a5ed870b-c3b0-4dcb-8cc8-905e1a0126b9';
    const unitId = 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2';
    const branchId = '84e778cc-7616-4792-b6db-d89f100bb6f1';
    const relations = {
      proveedores: {
        id: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
        razon_social: 'Proveedor',
      },
      versiones_vehiculos: {
        id: '4de88c4c-3382-4f9b-ae60-98147159c977',
        nombre: 'Modelo',
        modelos_vehiculos: {
          id: '7d5cc401-544e-4651-9bd6-52495887fecd',
          nombre: 'Modelo base',
          tipo_vehiculo: 'MOTO',
          marcas_vehiculos: { id: unitId, nombre: 'Marca' },
        },
      },
      sucursales: { id: branchId, codigo: 'CASA', nombre: 'Sucursal' },
    };
    const current = {
      id: requestId,
      proveedor_id: relations.proveedores.id,
      disponibilidad_proveedor_id: availabilityId,
      operacion_id: operationId,
      version_id: relations.versiones_vehiculos.id,
      condicion: 'NUEVO',
      sucursal_llegada_id: branchId,
      estado: 'EN_TRANSITO',
      referencia_proveedor: null,
      costo_estimado: null,
      unidad_vehiculo_recibida_id: null,
      solicitado_en: new Date(),
      confirmado_en: new Date(),
      pedido_en: new Date(),
      despachado_en: new Date(),
      recibido_en: null,
      asignado_en: null,
      creado_en: new Date(),
      actualizado_en: new Date(),
      notas: null,
      unidades_vehiculos: null,
      operaciones: {
        id: operationId,
        numero_operacion: 15n,
        estado_operacion: 'APROBADA',
        clientes: { nombre_completo: 'Cliente', numero_documento: '30111222' },
      },
      ...relations,
    };
    const unit = {
      id: unitId,
      version_id: current.version_id,
      vin_mostrado: 'ABC123456',
      vin_normalizado: 'ABC123456',
      condicion: 'NUEVO',
      numero_motor: null,
      patente: null,
      anio_fabricacion: null,
      kilometraje_km: 0,
      color: null,
      sucursal_id: branchId,
      proveedor_id: current.proveedor_id,
      origen_adquisicion: 'PROVEEDOR',
      costo_compra: null,
      estado_inventario: 'EN_STOCK',
      recibido_en: new Date(),
      creado_en: new Date(),
      actualizado_en: new Date(),
      organizacion_id: actor.organization.id,
      ...relations,
    };
    const finalRequest = {
      ...current,
      estado: 'ASIGNADO',
      unidad_vehiculo_recibida_id: unitId,
      unidades_vehiculos: unit,
      recibido_en: new Date(),
      asignado_en: new Date(),
    };
    const decrementAvailability = jest.fn().mockResolvedValue({ count: 1 });
    const createReservation = jest.fn().mockResolvedValue({});
    const updateOperation = jest.fn().mockResolvedValue({});
    const updateSupplyRequest = jest
      .fn<
        Promise<typeof finalRequest>,
        [Prisma.solicitudes_abastecimientoUpdateArgs]
      >()
      .mockResolvedValue(finalRequest);
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: requestId }]),
      solicitudes_abastecimiento: {
        findFirst: jest.fn().mockResolvedValue(current),
        update: updateSupplyRequest,
      },
      personal: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: '39d0601a-b0b6-4824-8534-237c9dfbed8a' }),
      },
      disponibilidad_proveedor: {
        updateMany: decrementAvailability,
      },
      unidades_vehiculos: {
        create: jest.fn().mockResolvedValue(unit),
        update: jest
          .fn()
          .mockResolvedValue({ ...unit, estado_inventario: 'RESERVADO' }),
      },
      operaciones: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: operationId, unidad_vehiculo_id: null }),
        update: updateOperation,
      },
      reservas_stock: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: createReservation,
      },
      movimientos_inventario: {
        create: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'f614c6be-75f2-43cb-9f70-9a904e13ac6f',
            unidad_vehiculo_id: unitId,
            tipo_movimiento: 'RECEPCION',
            sucursal_origen_id: null,
            sucursal_destino_id: branchId,
            solicitud_abastecimiento_id: requestId,
            ocurrido_en: new Date(),
            notas: null,
            organizacion_id: actor.organization.id,
            creado_en: new Date(),
          })
          .mockResolvedValueOnce({ id: 'reservation-movement' }),
      },
    } as unknown as Prisma.TransactionClient;
    const execute = jest
      .fn<
        Promise<unknown>,
        [
          AuthenticatedAuditEvent,
          (client: Prisma.TransactionClient) => Promise<unknown>,
        ]
      >()
      .mockImplementation((_event, work) => work(transaction));
    const service = new SupplyService(
      {} as PrismaService,
      { execute } as unknown as AuditService,
    );

    const result = await service.receive(
      requestId,
      { vin: 'ABC123456', branchId },
      actor,
    );

    expect(result.supplyRequest).toMatchObject({
      status: 'ASIGNADO',
      chassis: 'ABC123456',
      operation: {
        id: operationId,
        status: 'APROBADA',
        client: { fullName: 'Cliente' },
      },
    });
    expect(decrementAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { cantidad_informada: { decrement: 1 } },
      }),
    );
    expect(createReservation).toHaveBeenCalled();
    expect(updateOperation).toHaveBeenCalled();
    expect(updateSupplyRequest.mock.calls[0][0].data).toMatchObject({
      estado: 'ASIGNADO',
    });
  });

  it('rejects a replay with a different VIN', async () => {
    const requestId = '7d5cc401-544e-4651-9bd6-52495887fecd';
    const branchId = '84e778cc-7616-4792-b6db-d89f100bb6f1';
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: requestId }]),
      solicitudes_abastecimiento: {
        findFirst: jest.fn().mockResolvedValue({
          organizacion_id: actor.organization.id,
          sucursal_llegada_id: branchId,
          unidad_vehiculo_recibida_id: 'edc9ce1d-dbf3-4691-a2d2-79e4e9563dd2',
        }),
      },
      unidades_vehiculos: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ vin_normalizado: 'ABC123456' }),
      },
      movimientos_inventario: {
        findFirst: jest.fn().mockResolvedValue({ id: 'x' }),
      },
    } as unknown as Prisma.TransactionClient;
    const service = new SupplyService(
      {} as PrismaService,
      {
        execute: jest
          .fn<
            Promise<unknown>,
            [
              AuthenticatedAuditEvent,
              (client: Prisma.TransactionClient) => Promise<unknown>,
            ]
          >()
          .mockImplementation((_event, work) => work(transaction)),
      } as unknown as AuditService,
    );

    await expect(
      service.receive(requestId, { vin: 'XYZ123456', branchId }, actor),
    ).rejects.toThrow(
      new ConflictException(
        'VIN conflicts with the completed supply reception',
      ),
    );
  });
});

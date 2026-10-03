import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ClientsService } from '../clients/clients.service';
import type { InventoryService } from '../inventory/inventory.service';
import type { SalesService } from '../sales/sales.service';
import type { VehiclePaymentsService } from '../vehicle-payments/vehicle-payments.service';
import { AssistantToolsService } from './assistant.tools';

// Lumi sólo puede leer lo que el usuario ya ve en sus pantallas. Estos tests
// fijan esa regla: permisos por consulta, sin parámetros que elijan de quién
// son los datos, y sin campos sensibles hacia el modelo.

function actor(roleCode: string, permissions: string[]): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'user@luma.test',
    name: 'Usuario',
    active: true,
    globalAccess: false,
    organization: {
      id: 'org-1',
      code: 'LUMA',
      name: 'Luma',
      type: 'CASA_CENTRAL',
    },
    role: {
      id: 'role-1',
      code: roleCode,
      name: roleCode,
      system: true,
      permissions,
    },
    branch: { id: 'branch-1', code: 'SM', name: 'San Miguel' },
  };
}

const seller = actor('VENDEDOR', ['ventas.consultar', 'inventario.consultar']);
const clientsOnly = actor('X', ['clientes.consultar']);
const administrative = actor('ADMINISTRATIVA', [
  'clientes.consultar',
  'ventas.consultar',
  'ingresos.consultar',
  'pagos_vehiculo.consultar',
  'inventario.consultar',
]);

const operationRow = {
  id: 'operation-uuid',
  number: '1048',
  ticketNumber: 'SM-0417',
  operationDate: new Date('2026-10-01T03:00:00.000Z'),
  status: 'APROBADA',
  listPrice: '5000000',
  minimumPrice: '4500000',
  agreedPrice: '4800000',
  notes: 'nota interna',
  client: {
    id: 'client-uuid',
    fullName: 'Gómez, Luis',
    documentNumber: '28999111',
    phone: '1155550000',
  },
  branch: { id: 'branch-1', code: 'SM', name: 'San Miguel' },
  seller: { id: 'seller-uuid', fullName: 'Pérez, Ana' },
  fulfillment: { status: 'ASIGNADA', supplier: { legalName: 'Proveedor SA' } },
  licensing: {
    mode: 'PAGA_CLIENTE',
    amount: '85000',
    estimatedFrom: '2026-10-08',
    estimatedTo: '2026-10-15',
    overdue: false,
    plate: { status: 'EN_TRAMITE', number: null, receivedAt: null },
    collection: { status: 'PENDIENTE', amount: '0', incomeIds: [] },
    payment: { status: 'PENDIENTE', amount: '0', paymentIds: [] },
  },
  vehicle: {
    versionName: 'XR 150',
    condition: 'NUEVO',
    chassis: '8CH4471',
    model: { name: 'XR', brand: { name: 'Honda' } },
    unit: { licensePlate: null, supplier: { legalName: 'Proveedor SA' } },
  },
};

describe('AssistantToolsService', () => {
  const findAll = jest.fn();
  const tracking = jest.fn();
  const paymentsFindAll = jest.fn();
  const inventoryFindAll = jest.fn();
  const clientsFindAll = jest.fn();
  const tools = new AssistantToolsService(
    { findAll, tracking } as unknown as SalesService,
    { findAll: paymentsFindAll } as unknown as VehiclePaymentsService,
    { findAll: inventoryFindAll } as unknown as InventoryService,
    { findAll: clientsFindAll } as unknown as ClientsService,
  );
  const names = (user: AuthenticatedUser) =>
    tools.definitions(user).map((definition) => definition.function.name);

  beforeEach(() => {
    jest.clearAllMocks();
    findAll.mockResolvedValue({ items: [operationRow], total: 1 });
  });

  it('offers each query only with the permissions of its screen', () => {
    expect(names(seller)).toEqual(['buscar_operaciones', 'consultar_stock']);
    expect(names(administrative)).toEqual([
      'buscar_clientes',
      'buscar_operaciones',
      'seguimiento_cobros',
      'pagos_patentes_seguros',
      'consultar_stock',
    ]);
    expect(names(actor('CALLCENTER', []))).toEqual([]);
    // Collections need both permissions, like GET /sales/operations/tracking.
    expect(names(actor('X', ['ingresos.consultar']))).toEqual([]);
  });

  it('refuses a query the user was not offered, even if the model asks for it', async () => {
    const answer = await tools.run('seguimiento_cobros', '{}', seller);

    expect(JSON.parse(answer)).toEqual({
      error: 'El usuario no tiene acceso a esa información.',
    });
    expect(tracking).not.toHaveBeenCalled();
    expect(
      JSON.parse(await tools.run('borrar_todo', '{}', administrative)),
    ).toHaveProperty('error');
  });

  it('runs the query through the screen service with the session user', async () => {
    await tools.run('buscar_operaciones', '{"busqueda":"1048"}', seller);

    expect(findAll).toHaveBeenCalledTimes(1);
    const [query, user] = findAll.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    // The seller restriction and branch scope live in SalesService and are
    // driven by this actor, never by the model.
    expect(user).toBe(seller);
    expect(query).toMatchObject({
      vehicleType: 'MOTO',
      search: '1048',
      page: 1,
      limit: 8,
    });
  });

  it('never lets the model choose whose data it reads', async () => {
    await tools.run(
      'buscar_operaciones',
      JSON.stringify({
        busqueda: 'Gómez',
        sellerId: 'another-seller',
        vendedor: 'another-seller',
        branchId: 'another-branch',
        sucursal: 'Del Viso',
        organizationId: 'another-org',
        mine: false,
        limit: 100,
        page: 7,
      }),
      seller,
    );

    const [query] = findAll.mock.calls[0] as [Record<string, unknown>];
    expect(query.sellerId).toBeUndefined();
    expect(query.branchId).toBeUndefined();
    expect(query.organizationId).toBeUndefined();
    expect(query.clientId).toBeUndefined();
    expect(query.mine).toBeUndefined();
    expect(query.limit).toBe(8);
    expect(query.page).toBe(1);
    for (const definition of tools.definitions(administrative)) {
      const properties = Object.keys(
        (definition.function.parameters as { properties: object }).properties,
      );
      expect(properties).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/vendedor|seller|sucursal|branch|organi/i),
        ]),
      );
    }
  });

  it('passes on only the listed fields, without totals or internal data', async () => {
    findAll.mockResolvedValue({
      items: Array.from({ length: 8 }, () => operationRow),
      total: 37,
    });

    const answer = await tools.run('buscar_operaciones', '{}', administrative);

    const parsed = JSON.parse(answer) as {
      resultados: Array<Record<string, unknown>>;
      hayMasResultados: boolean;
    };
    expect(parsed.resultados).toHaveLength(8);
    expect(parsed.hayMasResultados).toBe(true);
    expect(parsed.resultados[0]).toMatchObject({
      operacion: '1048',
      boleto: 'SM-0417',
      cliente: 'Gómez, Luis',
      vehiculo: 'Honda XR XR 150',
      estado: 'APROBADA',
    });
    // No count, ids, minimum/list price, document, phone, notes or supplier.
    for (const hidden of [
      '37',
      'uuid',
      '4500000',
      '5000000',
      '28999111',
      '1155550000',
      'nota interna',
      'Proveedor SA',
    ])
      expect(answer).not.toContain(hidden);
  });

  it('tells the model nothing about why a query failed', async () => {
    findAll.mockRejectedValue(
      new ForbiddenException(
        'Sellers cannot query operations assigned to another seller',
      ),
    );

    const answer = await tools.run('buscar_operaciones', '{}', seller);

    expect(JSON.parse(answer)).toEqual({
      error: 'No se pudo consultar esa información.',
    });
  });

  it('searches clients only with clientes.consultar, without address or notes', async () => {
    clientsFindAll.mockResolvedValue({
      items: [
        {
          id: 'client-uuid',
          fullName: 'VAZQUEZ LUCIANA',
          documentType: 'DNI',
          documentNumber: '34365310',
          phone: '1125120415',
          email: null,
          address: 'Calle Falsa 123',
          notes: 'nota interna',
          active: true,
        },
      ],
      total: 1,
    });

    expect(names(clientsOnly)).toEqual(['buscar_clientes']);
    expect(names(seller)).not.toContain('buscar_clientes');
    const answer = await tools.run(
      'buscar_clientes',
      '{"busqueda":"vazquez"}',
      clientsOnly,
    );

    expect(clientsFindAll.mock.calls[0][0]).toMatchObject({
      search: 'vazquez',
      page: 1,
      limit: 8,
    });
    expect(clientsFindAll.mock.calls[0][1]).toBe(clientsOnly);
    expect(JSON.parse(answer)).toEqual({
      resultados: [
        {
          cliente: 'VAZQUEZ LUCIANA',
          documento: 'DNI 34365310',
          telefono: '1125120415',
          correo: null,
          estado: 'Activo',
        },
      ],
      hayMasResultados: false,
    });
    expect(
      JSON.parse(await tools.run('buscar_clientes', '{}', seller)),
    ).toEqual({ error: 'El usuario no tiene acceso a esa información.' });
  });

  it('defaults stock to units in stock and hides costs', async () => {
    inventoryFindAll.mockResolvedValue({
      items: [
        {
          vin: '8CH1',
          condition: 'NUEVO',
          licensePlate: null,
          color: 'Rojo',
          inventoryStatus: 'EN_STOCK',
          purchaseCost: '3900000',
          version: {
            name: 'Wave 110',
            model: { name: 'Wave', brand: { name: 'Honda' } },
          },
          branch: { name: 'San Miguel' },
        },
      ],
      total: 1,
    });

    const answer = await tools.run(
      'consultar_stock',
      '{"busqueda":"wave"}',
      seller,
    );

    expect(inventoryFindAll.mock.calls[0][0]).toMatchObject({
      inventoryStatus: 'EN_STOCK',
      search: 'wave',
    });
    expect(answer).toContain('Honda Wave Wave 110');
    expect(answer).not.toContain('3900000');
  });
});

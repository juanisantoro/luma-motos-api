import { Injectable, Logger } from '@nestjs/common';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ClientsService } from '../clients/clients.service';
import { ClientListQueryDto } from '../clients/dto/client-list-query.dto';
import { RejectedInquiryQueryDto } from '../credit-inquiries/credit-inquiries.dto';
import { CreditInquiriesService } from '../credit-inquiries/credit-inquiries.service';
import { InventoryQueryDto } from '../inventory/inventory.dto';
import { InventoryService } from '../inventory/inventory.service';
import {
  SalesOperationQueryDto,
  SalesOperationTrackingQueryDto,
} from '../sales/sales.dto';
import { SalesService } from '../sales/sales.service';
import { VehiclePaymentQueryDto } from '../vehicle-payments/vehicle-payments.dto';
import { VehiclePaymentsService } from '../vehicle-payments/vehicle-payments.service';

// Consultas de datos de Lumi.
//
// Reglas de seguridad (no negociables al agregar una consulta):
//
// 1. Una consulta sólo llama al MISMO método de servicio que usa la pantalla
//    equivalente, con el usuario de la sesión. Nada de SQL propio: así el
//    alcance por sucursal, la restricción del vendedor a sus propias ventas y
//    el aislamiento por organización son exactamente los de la pantalla.
// 2. Cada consulta exige los mismos permisos que el endpoint HTTP de esa
//    pantalla. Sin el permiso, la consulta ni se le ofrece al modelo, y si
//    el modelo la pide igual, se rechaza.
// 3. El modelo nunca elige de quién son los datos: no hay parámetros de
//    vendedor, sucursal ni organización. Sólo texto de búsqueda y filtros de
//    estado. Buscar ventas por documento resuelve el cliente con la consulta
//    de la pantalla Clientes (y su permiso) y filtra por ese cliente dentro
//    de lo que el usuario ya ve.
// 4. Sólo lectura, pocas filas y sin totales: Lumi no cuenta ventas, no suma
//    importes ni compara vendedores o sucursales.
// 5. Al modelo sólo le llegan los campos listados acá (nunca costos, precio
//    mínimo, comisiones ni datos internos). El teléfono de un cliente sólo
//    sale por buscar_clientes (clientes.consultar) y el documento por esa
//    consulta o por buscar_clientes_en_rojo, cuyas pantallas ya lo muestran.

const MAX_ROWS = 8;
// Clients a document may resolve to when searching sales by document.
const MAX_DOCUMENT_CLIENTS = 3;

const VEHICLE_TYPES = ['MOTO', 'AUTO'] as const;
const OPERATION_STATUSES = [
  'BORRADOR',
  'PENDIENTE_APROBACION',
  'APROBADA',
  'RECHAZADA',
  'CANCELADA',
  'CERRADA',
] as const;
const PAYMENT_STATUSES = ['PENDIENTE', 'PAGADO'] as const;
const INVENTORY_STATUSES = [
  'EN_STOCK',
  'RESERVADO',
  'EN_TRASLADO',
  'EN_ACONDICIONAMIENTO',
  'VENDIDO',
  'ENTREGADO',
  'BLOQUEADO',
  'DADO_DE_BAJA',
] as const;

type Args = Record<string, unknown>;

function enumArg<T extends string>(
  args: Args,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = args[key];
  return typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function textArg(args: Args, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, 80);
  return trimmed || undefined;
}

// The model often sends a whole pasted line ("CARRIZO ALEJANDRO DNI
// 34713296") as the search text. The screen services match that text as a
// single piece, so it finds nothing. This separates the document (7 to 11
// digits, with or without dots) from the rest.
const DOCUMENT_LABELS =
  /\b(dni|cuit|cuil|documento|doc|nro|n°|numero)\b[.:]?/gi;

export function splitSearch(value: string | undefined): {
  text?: string;
  document?: string;
} {
  if (!value) return {};
  const undotted = value.replace(/(\d)[.](?=\d{3}\b)/g, '$1');
  const match = /(?<![\w-])\d{7,11}(?![\w-])/.exec(undotted);
  if (!match) return { text: value };
  const text = (
    undotted.slice(0, match.index) +
    ' ' +
    undotted.slice(match.index + match[0].length)
  )
    .replace(DOCUMENT_LABELS, ' ')
    .replace(/[\s,;:·#-]+/g, ' ')
    .trim();
  return { text: text || undefined, document: match[0] };
}

function documentArg(args: Args, key: string): string | undefined {
  const digits = textArg(args, key)?.replace(/\D/g, '');
  return digits && digits.length >= 5 ? digits : undefined;
}

function trueArg(args: Args, key: string): true | undefined {
  return args[key] === true ? true : undefined;
}

function day(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === 'string' ? value.slice(0, 10) : null;
}

// Shapes read from the service responses. Only these fields are used; the
// rest of each response is dropped before anything reaches the model.
interface LicensingView {
  mode: string | null;
  estimatedFrom: string | null;
  estimatedTo: string | null;
  overdue: boolean;
  plate: { status: string; number: string | null; receivedAt: string | null };
  collection: { status: string };
  payment: { status: string };
}

interface OperationView {
  number: string;
  ticketNumber: string | null;
  operationDate: Date | string;
  status: string;
  agreedPrice: string;
  client: { fullName: string };
  branch: { name: string };
  seller: { fullName: string } | null;
  fulfillment: { status: string };
  licensing: LicensingView;
  vehicle: {
    versionName: string;
    condition: string;
    chassis: string | null;
    model?: { name: string; brand: { name: string } };
    unit?: { licensePlate: string | null } | null;
  };
}

interface TrackingView extends OperationView {
  collectedAmount: string;
  balanceAmount: string;
  pendingHandoverAmount: string;
}

interface VehiclePaymentView {
  date: string;
  status: string;
  amount: number;
  concept: { name: string };
  provider: { name: string };
  unit: { vin: string; licensePlate: string | null };
  vehicle: { brand: string; model: string; version: string };
  operation: { number: string; ticketNumber: string | null } | null;
}

interface UnitView {
  vin: string;
  condition: string;
  licensePlate: string | null;
  color: string | null;
  inventoryStatus: string;
  version: { name: string; model: { name: string; brand: { name: string } } };
  branch: { name: string };
}

interface ClientView {
  id: string;
  fullName: string;
  documentType: string | null;
  documentNumber: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
}

interface RejectedInquiryView {
  client: {
    fullName: string;
    documentType: string | null;
    documentNumber: string | null;
  };
  financialEntity: { name: string };
  reason: string | null;
  consultedAt: Date | string;
  attemptCount: number;
  branch: { name: string };
  registeredBy: { fullName: string };
}

interface Page<T> {
  items: T[];
  total: number;
}

function licensing(view: LicensingView) {
  return {
    modalidad: view.mode,
    situacionPatente: view.plate.status,
    estimadaDesde: view.estimatedFrom,
    estimadaHasta: view.estimatedTo,
    demorada: view.overdue,
    numeroPatente: view.plate.number,
    recibidaEl: view.plate.receivedAt,
    cobroAlCliente: view.collection.status,
    pagoAGestoria: view.payment.status,
  };
}

function operation(view: OperationView) {
  return {
    operacion: view.number,
    boleto: view.ticketNumber,
    fecha: day(view.operationDate),
    estado: view.status,
    cliente: view.client.fullName,
    vehiculo: [
      view.vehicle.model?.brand.name,
      view.vehicle.model?.name,
      view.vehicle.versionName,
    ]
      .filter(Boolean)
      .join(' '),
    condicion: view.vehicle.condition,
    chasis: view.vehicle.chassis,
    sucursal: view.branch.name,
    vendedor: view.seller?.fullName ?? null,
    precioAcordado: view.agreedPrice,
    situacionUnidad: view.fulfillment.status,
    patentamiento: licensing(view.licensing),
  };
}

function page<T, R>(result: Page<T>, map: (item: T) => R) {
  return {
    resultados: result.items.slice(0, MAX_ROWS).map(map),
    // Deliberately a flag and not a count: Lumi does not report totals.
    hayMasResultados: result.total > Math.min(result.items.length, MAX_ROWS),
  };
}

export interface AssistantToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface AssistantTool {
  name: string;
  description: string;
  // Same permissions as the HTTP endpoint of the equivalent screen.
  permissions: string[];
  properties: Record<string, unknown>;
  run(args: Args, actor: AuthenticatedUser): Promise<unknown>;
}

const vehicleTypeProperty = {
  type: 'string',
  enum: VEHICLE_TYPES,
  description: 'Circuito: MOTO (por defecto) o AUTO.',
};

const searchProperty = (what: string) => ({
  type: 'string',
  description: `Texto a buscar, un solo dato por vez: ${what}. Omitilo para listar las más recientes.`,
});

const documentProperty = {
  type: 'string',
  description:
    'Número de documento del cliente, sólo los dígitos. Usalo en lugar de "busqueda" cuando tengas el documento.',
};

const NO_DOCUMENT_SEARCH =
  'Las ventas no se pueden buscar por documento con este perfil. Buscá por nombre y apellido del cliente, número de operación, boleto, chasis o patente.';

@Injectable()
export class AssistantToolsService {
  private readonly logger = new Logger(AssistantToolsService.name);
  private readonly tools: AssistantTool[];

  constructor(
    sales: SalesService,
    vehiclePayments: VehiclePaymentsService,
    inventory: InventoryService,
    clients: ClientsService,
    creditInquiries: CreditInquiriesService,
  ) {
    const findClients = async (
      search: string | undefined,
      actor: AuthenticatedUser,
      limit = MAX_ROWS,
    ) =>
      (await clients.findAll(
        Object.assign(new ClientListQueryDto(), { search, page: 1, limit }),
        actor,
      )) as unknown as Page<ClientView>;

    // Sales by search text. When the text carries a document, or finds
    // nothing and a document was given, the client is resolved through the
    // Clientes screen query and its sales are listed.
    const findOperations = async <T>(
      args: Args,
      actor: AuthenticatedUser,
      list: (filter: {
        search?: string;
        clientId?: string;
      }) => Promise<Page<T>>,
    ): Promise<{ result: Page<T>; note?: string }> => {
      const { text, document: found } = splitSearch(textArg(args, 'busqueda'));
      const document = documentArg(args, 'documentoCliente') ?? found;
      // A bare number can also be an operation or ticket number.
      const result = await list({ search: text ?? document });
      if (!document || result.items.length) return { result };
      if (!actor.role.permissions.includes(PERMISSION_CODES.CLIENTS_READ))
        return { result, note: NO_DOCUMENT_SEARCH };
      const matches = await findClients(document, actor, MAX_DOCUMENT_CLIENTS);
      const pages = await Promise.all(
        matches.items
          .slice(0, MAX_DOCUMENT_CLIENTS)
          .map((client) => list({ clientId: client.id })),
      );
      return {
        result: {
          items: pages.flatMap((item) => item.items),
          total: pages.reduce((sum, item) => sum + item.total, 0),
        },
      };
    };
    const withNote = <R extends object>(body: R, note?: string) =>
      note ? { ...body, nota: note } : body;

    this.tools = [
      {
        name: 'buscar_clientes',
        description:
          'Busca clientes en la cartera que el usuario ve en la pantalla Clientes: nombre, documento, teléfono, correo y si está activo. Usala cuando pregunten por una persona o un documento.',
        permissions: [PERMISSION_CODES.CLIENTS_READ],
        properties: {
          busqueda: searchProperty('nombre o correo del cliente'),
          documento: documentProperty,
        },
        run: async (args, actor) => {
          const { text, document: found } = splitSearch(
            textArg(args, 'busqueda'),
          );
          const document = documentArg(args, 'documento') ?? found;
          let result = await findClients(document ?? text, actor);
          if (!result.items.length && document && text)
            result = await findClients(text, actor);
          return page(result, (client) => ({
            cliente: client.fullName,
            documento: [client.documentType, client.documentNumber]
              .filter(Boolean)
              .join(' '),
            telefono: client.phone,
            correo: client.email,
            estado: client.active ? 'Activo' : 'Inactivo',
          }));
        },
      },
      {
        name: 'buscar_clientes_en_rojo',
        description:
          'Busca en la pantalla Clientes en rojo (consultas crediticias): personas a las que una financiera les rechazó un crédito, con financiera, fecha y motivo. Usala cuando pregunten si alguien está en rojo, tiene rechazos o mal historial crediticio.',
        permissions: [PERMISSION_CODES.CREDIT_INQUIRIES_READ],
        properties: {
          busqueda: searchProperty('nombre de la persona'),
          documento: documentProperty,
        },
        run: async (args, actor) => {
          const { text, document: found } = splitSearch(
            textArg(args, 'busqueda'),
          );
          const document = documentArg(args, 'documento') ?? found;
          const find = async (filter: { search?: string; document?: string }) =>
            (await creditInquiries.findRejected(
              Object.assign(new RejectedInquiryQueryDto(), {
                ...filter,
                page: 1,
                limit: MAX_ROWS,
              }),
              actor,
            )) as unknown as Page<RejectedInquiryView>;
          let result = await find(document ? { document } : { search: text });
          if (!result.items.length && document && text)
            result = await find({ search: text });
          return page(result, (row) => ({
            cliente: row.client.fullName,
            documento: [row.client.documentType, row.client.documentNumber]
              .filter(Boolean)
              .join(' '),
            financiera: row.financialEntity.name,
            fechaRechazo: day(row.consultedAt),
            motivo: row.reason,
            intentosDeLaPersona: row.attemptCount,
            sucursal: row.branch.name,
            registradoPor: row.registeredBy.fullName,
          }));
        },
      },
      {
        name: 'buscar_operaciones',
        description:
          'Busca ventas (operaciones) que el usuario puede ver en la pantalla Operaciones: estado, cliente, vehículo, situación de la unidad y patentamiento. Sirve para "cómo está la operación X", "qué compró / qué operaciones tiene tal cliente", "qué patentes están demoradas" o "qué patentes recibidas tienen cobro pendiente".',
        permissions: [PERMISSION_CODES.SALES_READ],
        properties: {
          tipoVehiculo: vehicleTypeProperty,
          busqueda: searchProperty(
            'número de operación, número de boleto, nombre del cliente, chasis o patente',
          ),
          documentoCliente: documentProperty,
          estado: { type: 'string', enum: OPERATION_STATUSES },
          patenteDemorada: {
            type: 'boolean',
            description:
              'true para ver sólo ventas cuya patente pasó la fecha estimada y no llegó.',
          },
          patenteCobroPendiente: {
            type: 'boolean',
            description:
              'true para ver sólo ventas con la patente recibida y el cobro al cliente pendiente.',
          },
        },
        run: async (args, actor) => {
          const { result, note } = await findOperations(
            args,
            actor,
            async (filter) =>
              (await sales.findAll(
                Object.assign(new SalesOperationQueryDto(), {
                  vehicleType:
                    enumArg(args, 'tipoVehiculo', VEHICLE_TYPES) ?? 'MOTO',
                  ...filter,
                  status: enumArg(args, 'estado', OPERATION_STATUSES),
                  licensingOverdue: trueArg(args, 'patenteDemorada'),
                  licensingCollectionPending: trueArg(
                    args,
                    'patenteCobroPendiente',
                  ),
                  page: 1,
                  limit: MAX_ROWS,
                }),
                actor,
              )) as unknown as Page<OperationView>,
          );
          return withNote(page(result, operation), note);
        },
      },
      {
        name: 'seguimiento_cobros',
        description:
          'Cobros de las ventas que el usuario puede ver en Seguimiento de cobros: precio acordado, cobrado, saldo y efectivo sin rendir de cada operación.',
        permissions: [
          PERMISSION_CODES.SALES_READ,
          PERMISSION_CODES.INCOMES_READ,
        ],
        properties: {
          tipoVehiculo: vehicleTypeProperty,
          busqueda: searchProperty(
            'número de operación, número de boleto, nombre del cliente, chasis o patente',
          ),
          documentoCliente: documentProperty,
        },
        run: async (args, actor) => {
          const { result, note } = await findOperations(
            args,
            actor,
            async (filter) =>
              (await sales.tracking(
                Object.assign(new SalesOperationTrackingQueryDto(), {
                  vehicleType:
                    enumArg(args, 'tipoVehiculo', VEHICLE_TYPES) ?? 'MOTO',
                  ...filter,
                  page: 1,
                  limit: MAX_ROWS,
                }),
                actor,
              )) as unknown as Page<TrackingView>,
          );
          const rows = page(result, (row) => ({
            operacion: row.number,
            boleto: row.ticketNumber,
            fecha: day(row.operationDate),
            estado: row.status,
            cliente: row.client.fullName,
            vehiculo: row.vehicle.versionName,
            sucursal: row.branch.name,
            vendedor: row.seller?.fullName ?? null,
            precioAcordado: row.agreedPrice,
            cobrado: row.collectedAmount,
            saldo: row.balanceAmount,
            efectivoSinRendir: row.pendingHandoverAmount,
          }));
          return withNote(rows, note);
        },
      },
      {
        name: 'pagos_patentes_seguros',
        description:
          'Pagos de documentación de vehículos (patente, seguro, formularios) que el usuario puede ver en la pantalla Patentes/seguros: lo que la agencia le paga a la gestoría o aseguradora, y si está pendiente o pagado.',
        permissions: [PERMISSION_CODES.VEHICLE_PAYMENTS_READ],
        properties: {
          tipoVehiculo: vehicleTypeProperty,
          busqueda: searchProperty(
            'chasis, patente, marca, modelo, número de operación o número de boleto',
          ),
          estado: { type: 'string', enum: PAYMENT_STATUSES },
        },
        run: async (args, actor) => {
          const query = Object.assign(new VehiclePaymentQueryDto(), {
            vehicleType: enumArg(args, 'tipoVehiculo', VEHICLE_TYPES) ?? 'MOTO',
            search: textArg(args, 'busqueda'),
            status: enumArg(args, 'estado', PAYMENT_STATUSES),
            page: 1,
            limit: MAX_ROWS,
          });
          const result = (await vehiclePayments.findAll(
            query,
            actor,
          )) as unknown as Page<VehiclePaymentView>;
          return page(result, (row) => ({
            fecha: row.date,
            concepto: row.concept.name,
            proveedor: row.provider.name,
            importe: row.amount,
            estado: row.status,
            vehiculo: `${row.vehicle.brand} ${row.vehicle.model} ${row.vehicle.version}`,
            chasis: row.unit.vin,
            patente: row.unit.licensePlate,
            operacion: row.operation?.number ?? null,
            boleto: row.operation?.ticketNumber ?? null,
          }));
        },
      },
      {
        name: 'consultar_stock',
        description:
          'Unidades que el usuario puede ver en la pantalla Stock: marca, modelo, versión, color, estado y sucursal. Por defecto sólo las que están en stock.',
        permissions: [PERMISSION_CODES.INVENTORY_READ],
        properties: {
          tipoVehiculo: vehicleTypeProperty,
          busqueda: searchProperty('marca, modelo, versión, chasis o patente'),
          estado: { type: 'string', enum: INVENTORY_STATUSES },
        },
        run: async (args, actor) => {
          const query = Object.assign(new InventoryQueryDto(), {
            vehicleType: enumArg(args, 'tipoVehiculo', VEHICLE_TYPES) ?? 'MOTO',
            search: textArg(args, 'busqueda'),
            inventoryStatus:
              enumArg(args, 'estado', INVENTORY_STATUSES) ?? 'EN_STOCK',
            page: 1,
            limit: MAX_ROWS,
          });
          const result = (await inventory.findAll(
            query,
            actor,
          )) as unknown as Page<UnitView>;
          return page(result, (unit) => ({
            vehiculo: `${unit.version.model.brand.name} ${unit.version.model.name} ${unit.version.name}`,
            condicion: unit.condition,
            color: unit.color,
            estado: unit.inventoryStatus,
            sucursal: unit.branch.name,
            chasis: unit.vin,
            patente: unit.licensePlate,
          }));
        },
      },
    ];
  }

  private allowed(actor: AuthenticatedUser): AssistantTool[] {
    const permissions = new Set(actor.role.permissions);
    return this.tools.filter((tool) =>
      tool.permissions.every((permission) => permissions.has(permission)),
    );
  }

  // What the model is told it can call: only what this user's permissions
  // already let them see on screen.
  definitions(actor: AuthenticatedUser): AssistantToolDefinition[] {
    return this.allowed(actor).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.properties,
          additionalProperties: false,
        },
      },
    }));
  }

  // Runs one query the model asked for and returns the JSON it will read.
  // The permission check is repeated here: the model's request is never
  // trusted, whatever it was offered.
  async run(
    name: string,
    rawArguments: string,
    actor: AuthenticatedUser,
  ): Promise<string> {
    const tool = this.allowed(actor).find((item) => item.name === name);
    if (!tool) {
      this.logger.warn(
        `Rejected data query "${name}" for role=${actor.role.code} user=${actor.id}`,
      );
      return JSON.stringify({
        error: 'El usuario no tiene acceso a esa información.',
      });
    }
    let args: Args = {};
    try {
      const parsed: unknown = JSON.parse(rawArguments || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        args = parsed as Args;
    } catch {
      // Malformed arguments: run the query with its defaults.
    }
    try {
      return JSON.stringify(await tool.run(args, actor));
    } catch (error) {
      // Includes the service's own refusals (403/404 by scope): nothing about
      // the failure is passed on to the model.
      this.logger.warn(
        `Data query "${name}" failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return JSON.stringify({
        error: 'No se pudo consultar esa información.',
      });
    }
  }
}

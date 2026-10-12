# API de Service (taller)

Base URL: `/api/service-orders`. Requiere `Authorization: Bearer <token>`.
Toda la información es de la organización del usuario y de las sucursales
que tiene habilitadas (una orden de otra sucursal responde `404`).

## Circuito

```
RECIBIDA ──(mecánico guarda avance)──> EN_TALLER ──(mecánico firma)──> TERMINADA ──(cobro y entrega)──> ENTREGADA
    │                                     │                              │
    └──────────── cancelar ───────────────┴──────── cancelar ────────────┘   (TERMINADA ──reabrir──> EN_TALLER)
```

1. La administrativa recibe la moto y carga la orden: cliente, moto, km y
   tipo de service. La orden copia el checklist de ese tipo.
2. El mecánico la trabaja: marca Sí/No en cada tarea, carga el cambio de
   aceite, los repuestos y el diagnóstico, y la firma. Para firmar, todas las
   tareas tienen que estar marcadas.
3. La administrativa la cobra y la entrega. El cobro crea un ingreso
   **Service** con su movimiento de caja (mismo circuito que cualquier cobro:
   caja de la sucursal, rendición del efectivo, auditoría y cierres). Con
   importe `0` (garantía) se entrega sin ingreso.

## Permisos

| Permiso | Para | Roles |
| --- | --- | --- |
| `service.consultar` | Ver órdenes y tipos | Mecánico, Administrativa, Gerente, Administrador |
| `service.gestionar` | Recibir, corregir, reabrir y cancelar; buscar la moto | Administrativa, Gerente, Administrador |
| `service.trabajar` | Checklist, aceite, repuestos, diagnóstico y firma | Mecánico, Administrador |
| `service.cobrar` | Cobrar y entregar | Administrativa, Gerente, Administrador |
| `service.tipos.gestionar` | Tipos de service: tareas y precio sugerido | Administrador |

El rol de sistema **MECANICO** (Mecánico) tiene sólo `service.consultar` y
`service.trabajar`. Quien no tiene `service.gestionar` ni `service.cobrar`
(el mecánico) no recibe el importe ni el ingreso de la entrega.

## Endpoints

| Método y ruta | Permiso | Qué hace |
| --- | --- | --- |
| `GET /service-orders` | consultar | Lista paginada. Filtros: `status` (uno o varios separados por coma), `branchId`, `search` (número, cliente, documento, dominio, chasis, modelo), `from`/`to` (fecha de recepción), `page`, `limit` (máx. 100). |
| `GET /service-orders/:id` | consultar | Una orden. |
| `GET /service-orders/vehicle-lookup?q=` | gestionar | Busca por dominio o chasis: la unidad vendida por Luma (con su último comprador) y el último service de esa moto. |
| `POST /service-orders` | gestionar | Recibe una moto. |
| `PATCH /service-orders/:id` | gestionar | Corrige la recepción (`expectedVersion`). El tipo de service sólo se cambia mientras está RECIBIDA. |
| `PUT /service-orders/:id/work` | trabajar | Guarda el avance del mecánico; la orden pasa a EN_TALLER. |
| `POST /service-orders/:id/finish` | trabajar | Guarda y firma: TERMINADA, con el mecánico y la hora. |
| `POST /service-orders/:id/reopen` | gestionar | `{ expectedVersion, reason }`: TERMINADA vuelve a EN_TALLER y se borra la firma. |
| `POST /service-orders/:id/deliver` | cobrar | Cobra y entrega (ver abajo). |
| `POST /service-orders/:id/cancel` | gestionar | `{ expectedVersion, reason }`. No se cancela una entregada. |
| `GET /service-orders/types` | consultar | Tipos activos (`includeInactive=true` para todos). |
| `POST /service-orders/types` | tipos.gestionar | `{ name, order?, tasks[], suggestedPrice?, active? }`. |
| `PUT /service-orders/types/:id` | tipos.gestionar | Mismo cuerpo. Cambiar las tareas no toca las órdenes ya recibidas. |

### Recepción (`POST` y `PATCH`)

```json
{
  "branchId": "uuid (opcional si el usuario tiene una sola sucursal)",
  "receptionDate": "2026-10-12",
  "clientId": "uuid (opcional: completa los datos del cliente registrado)",
  "clientName": "Marta Gómez",
  "clientPhone": "1155550000",
  "clientEmail": null, "clientDocument": null, "clientAddress": null, "clientLocality": null,
  "unitId": "uuid (opcional: la moto vendida por Luma)",
  "plate": "A123BCD", "chassis": null, "engine": null, "model": "Gilera Smash 110", "year": 2025,
  "currentKm": 1050,
  "nextServiceKm": null,
  "serviceTypeId": "uuid",
  "serviceTypeOther": "sólo si no se elige un tipo: queda como \"Otro: …\"",
  "receptionNotes": "Ruido en la cadena"
}
```

Hace falta el nombre del cliente (o `clientId`) y el dominio o el chasis (o
`unitId`). Un service "Otro" lleva las 15 tareas de la planilla en papel.

### Trabajo del mecánico (`PUT …/work` y `POST …/finish`)

```json
{
  "expectedVersion": 3,
  "tasks": [{ "description": "Cambio de aceite de motor", "done": true, "notes": null }],
  "oil": { "type": "Motul 5100", "viscosity": "10W40", "liters": 1, "filter": true },
  "parts": [{ "code": "FA-1", "description": "Filtro de aceite", "quantity": 1, "unitPrice": "8500" }],
  "diagnosis": "Cadena tensada.",
  "nextServiceKm": 4000
}
```

`tasks` reemplaza el checklist entero (el mecánico puede agregar tareas).
`done: null` es "sin revisar": no se puede firmar así (`400 SERVICE_TASKS_PENDING`).

### Cobro y entrega (`POST …/deliver`)

```json
{
  "expectedVersion": 4,
  "idempotencyKey": "uuid",
  "amount": "45000",
  "accountId": "uuid (obligatorio si amount > 0)",
  "paymentMethod": "EFECTIVO | TRANSFERENCIA_BANCARIA | TARJETA | … (obligatorio si amount > 0)",
  "collectedById": "uuid (opcional)",
  "handoverToId": "uuid (obligatorio en efectivo: a quién se rinde)",
  "deliveryDate": "2026-10-12 (opcional, no futura)",
  "vehicleCondition": "OPTIMO | BUENO | REGULAR",
  "notes": "Retiró el cliente",
  "reference": "opcional; por defecto \"Orden de service 000007\""
}
```

Crea el ingreso "Service" (sucursal y cliente de la orden, circuito motos) y
su cobro en la caja elegida, con las mismas validaciones de caja que el resto
(sucursal, moneda, cuentas históricas). Repetir el pedido con la misma
`idempotencyKey` devuelve la orden sin cobrar de nuevo.

## Errores propios

`VEHICLE_REQUIRED`, `CLIENT_REQUIRED`, `SERVICE_TYPE_REQUIRED`,
`SERVICE_TYPE_NOT_FOUND`, `SERVICE_TYPE_LOCKED`, `SERVICE_TASKS_PENDING`,
`SERVICE_TASKS_REQUIRED`, `SERVICE_ORDER_NOT_FOUND`, `SERVICE_ORDER_NOT_OPEN`,
`SERVICE_ORDER_NOT_EDITABLE`, `SERVICE_ORDER_NOT_FINISHED`,
`SERVICE_ORDER_CLOSED`, `SERVICE_TYPE_DUPLICATED`, `FUTURE_DELIVERY_DATE`,
`SERVICE_INCOME_TYPE_MISSING`, `STALE_VERSION` (`409`: otro usuario la
modificó; volver a abrirla).

## Auditoría

Categoría **Service (taller)**: `SERVICE_ORDER_CREATED`, `_UPDATED`,
`_WORK_SAVED`, `_FINISHED`, `_REOPENED`, `_DELIVERED`, `_CANCELLED`,
`SERVICE_TYPE_CREATED`, `SERVICE_TYPE_UPDATED`. El cobro además deja su
movimiento de caja, visible en Movimientos de dinero.

## Inicio y tareas pendientes

- El rol MECANICO tiene su inicio (`GET /dashboard/inicio`, `role: "MECANICO"`):
  motos esperando, en el taller, terminadas hoy y la lista para hacer.
- Quien tiene `service.cobrar` ve en sus tareas pendientes
  `SERVICE_READY_TO_DELIVER` (órdenes terminadas), por sucursal.

## Base de datos

Migración `20261012000000_service_orders` (se aplica a mano antes de
desplegar): tablas `tipos_service` y `ordenes_service` con RLS por
organización, cuatro tipos iniciales por organización (1º a 4º service, con
las 15 tareas de la planilla), el tipo de ingreso "Service", el rol
MECANICO y los permisos. El seed mantiene los mismos permisos.

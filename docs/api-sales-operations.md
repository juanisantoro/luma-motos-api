# API de operaciones de venta y reservas

Todas las rutas usan el prefijo `/api`, requieren JWT y quedan acotadas por RLS al tenant autenticado. Un usuario con acceso global puede usar `organizationId` en listados y altas; las mutaciones sobre registros existentes obtienen la organización objetivo del registro bloqueado y la distinguen de la organización del actor en auditoría.

## Permisos

| Código                     | Roles base                                       |
| -------------------------- | ------------------------------------------------ |
| `ventas.consultar`         | VENDEDOR, ADMINISTRATIVA, GERENTE, ADMINISTRADOR |
| `ventas.gestionar`         | VENDEDOR, ADMINISTRATIVA, GERENTE, ADMINISTRADOR |
| `ventas.aprobar`           | GERENTE, ADMINISTRADOR                           |
| `ventas.cancelar`          | ADMINISTRATIVA, GERENTE, ADMINISTRADOR           |
| `ventas.cerrar`            | ADMINISTRATIVA, GERENTE, ADMINISTRADOR           |
| `ventas.patentamiento.gestionar` | ADMINISTRATIVA, GERENTE, ADMINISTRADOR     |
| `ventas.asignar_unidad`    | ADMINISTRATIVA, GERENTE, ADMINISTRADOR           |
| `ventas.corregir`          | ADMINISTRATIVA, ADMINISTRADOR                    |
| `reservas_stock.gestionar` | VENDEDOR, ADMINISTRATIVA, GERENTE, ADMINISTRADOR |

El seed es idempotente: crea o actualiza el catálogo y agrega asignaciones faltantes sin retirar permisos personalizados.

## Separación MOTO/AUTO y seguridad

`vehicleType=MOTO|AUTO` es obligatorio en `GET /sales/operations`,
`GET /sales/operations/approvals`, `GET /sales/operations/price-policy` y
`POST /sales/operations`. El filtro se aplica en PostgreSQL sobre la versión,
no en frontend. VENDEDOR siempre queda restringido server-side a operaciones
asignadas a su propio `personal.id`, incluso si omite `mine` o intenta acceder
por id; `sellerId` está prohibido para ese rol.

Compras e ingresos aceptan el mismo filtro opcional en
`GET /supplier-purchases?vehicleType=` y `GET /incomes?vehicleType=`. Catálogo,
inventario, disponibilidad de proveedor y abastecimiento ya filtran por
`vehicleType`.

## Alta y edición

`POST /api/sales/operations`:

```json
{
  "vehicleType": "MOTO",
  "branchId": "uuid",
  "client": {
    "documentType": "DNI",
    "documentNumber": "12345678",
    "fullName": "Ana Pérez",
    "phone": "1122334455"
  },
  "versionId": "uuid",
  "condition": "NUEVO",
  "color": "color deseado optional (catálogo de colores)",
  "unitId": "uuid optional (compatibilidad)",
  "supplierAvailabilityId": "uuid optional (compatibilidad)",
  "sellerId": "uuid optional para no VENDEDOR",
  "contactId": "uuid optional",
  "agreedPrice": 2500000,
  "paymentPlatform": "EFECTIVO_CREDITO",
  "creditAmount": 1000000,
  "guarantor": "texto optional",
  "operationDate": "2026-08-29",
  "reservationExpiresAt": "timestamp optional",
  "deliveryStatus": "NO_PROGRAMADA",
  "papersDelivered": false,
  "debt": "NO",
  "submit": false,
  "notes": "observaciones optional",
  "ticketNumber": "número de boleto optional",
  "includesHelmet": false,
  "licensingMode": "BONIFICADA|PAGA_CLIENTE",
  "licensingAmount": 85000,
  "organizationId": "uuid optional; propio o acceso global"
}
```

El contrato principal usa `client`; `clientId` se acepta como alternativa
temporal compatible, nunca junto con `client`. La misma transacción tenant/RLS
normaliza y bloquea la identidad organización+tipo+número, reutiliza el cliente
existente o lo crea y luego crea la operación. No requiere `clientes.gestionar`.
Una coincidencia existente sólo actualiza nombre, teléfono y presentación del
documento. Un cliente no debería quedar inactivo: si la coincidencia (o el
`clientId` indicado) está inactiva, la venta la reactiva en vez de rechazarse.

**Fase 3 (sólo motos) — de dónde sale la unidad:**

| Tipo | Condición | Origen en el alta |
| --- | --- | --- |
| MOTO | NUEVO (0 km) | versión del catálogo, sin unidad ni proveedor; `color` deseado opcional (`requestedColor`). La administrativa asigna stock o pide al proveedor después (ver "Asignación de unidad"). `unitId` se sigue aceptando por compatibilidad. |
| MOTO | USADO | unidad física `EN_STOCK` (`unitId` obligatorio: `400 USED_MOTO_REQUIRES_STOCK_UNIT`). |
| AUTO | ambas | sin cambios: exactamente uno entre `unitId` y `supplierAvailabilityId` (`400 Exactly one of unitId or supplierAvailabilityId is required`). |

Una moto 0 km sin unidad nace con `fulfillment.status = PENDIENTE_ASIGNACION`
y puede enviarse y aprobarse así; cerrar sigue exigiendo unidad física. Los
autos mantienen la regla anterior para enviar/aprobar (reserva activa o pedido
de abastecimiento con su reserva de disponibilidad). `unitId` y
`supplierAvailabilityId` nunca van juntos.

La reserva física bloquea la unidad y la operación se crea en la misma
transacción. Si otro request ganó la unidad, responde HTTP 409 con
`{statusCode:409,code:"INVENTORY_UNIT_ALREADY_RESERVED",message:
"The inventory unit is already reserved by another operation",unitId}`.

`submit=false` (default) guarda `BORRADOR`; `submit=true` equivale a guardar y
enviar. También existe `POST /api/sales/operations/:id/submit` con
`{expectedVersion}`. Si `agreedPrice < listPrice`, el resultado es
`PENDIENTE_APROBACION`; a lista o superior es `APROBADA`. El piso mínimo es una
protección adicional y nunca reemplaza la regla bajo lista.

`PATCH /api/sales/operations/:id` requiere `expectedVersion` y acepta
`branchId`, `clientId`, `sellerId`, `contactId` (nullable), `agreedPrice`,
`paymentPlatform`, `creditAmount` (nullable), `guarantor` (nullable),
`operationDate`, `deliveryStatus`, `papersDelivered`, `debt`, `notes`
(nullable), `ticketNumber` (nullable), `includesHelmet`, `licensingMode` y
`licensingAmount` (nullable). BORRADOR/RECHAZADA vuelven a BORRADOR. APROBADA
sólo admite entrega, papeles, debe, observaciones y número de boleto; la
modalidad de patentamiento de una operación aprobada se gestiona con
`PATCH /:id/licensing`. Cambiar `operationDate` recalcula la ventana estimada de
patente.

### Corrección de una operación ya cargada

`PATCH /api/sales/operations/:id/correction` requiere `ventas.corregir` y
`expectedVersion`. Existe para dejar bien asociadas las operaciones migradas:
funciona en **cualquier estado** (incluidas `CERRADA` y `CANCELADA`), no cambia
el estado y no vuelve a pedir aprobación aunque el precio quede bajo lista.

Acepta `clientId`, `sellerId`, `contactId` (nullable), `agreedPrice`,
`paymentPlatform`, `creditAmount` (nullable), `financialInstitutionId`,
`guarantor` (nullable), `operationDate`, `deliveryStatus`, `papersDelivered`,
`debt`, `notes` (nullable), `ticketNumber` (nullable) e `includesHelmet`. Sólo
se tocan los campos enviados. No modifica unidad, modelo, sucursal, precio de
lista ni patentamiento (siguen por `PATCH /:id/unit` y `PATCH /:id/licensing`).

Si llega `agreedPrice`, `paymentPlatform`, `creditAmount` o
`financialInstitutionId`, el plan de pago se reconcilia en la misma
transacción:

- las tomas en parte de pago se conservan tal cual;
- el componente `FINANCIACION` se crea o actualiza con el monto y la financiera
  (la enviada o la que ya tenía); una plataforma sin crédito deja
  `monto_credito` en `null`;
- el efectivo pasa a ser `precio − crédito − tomas`;
- los componentes que sobran no se borran: quedan en `CANCELADA` y sus ingresos
  se desvinculan (`componente_pago_id = null`), de modo que los cobros siguen en
  la venta pero fuera del plan;
- se recalcula el estado de pago de cada componente vigente.

| Código                                      | Motivo                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `CORRECTION_FINANCIAL_INSTITUTION_REQUIRED` | La forma de pago lleva crédito y no hay financiera enviada ni previa   |
| `CORRECTION_OWN_CREDIT_ACTIVE`              | Hay crédito propio con cuotas vigentes y se intenta cambiar el crédito |
| `CORRECTION_PLAN_MISMATCH`                  | Crédito + tomas superan el precio de cierre                            |
| `CORRECTION_TRADE_IN_REQUIRED`              | Forma de pago "con moto" sin toma cargada                              |
| `CORRECTION_TRADE_IN_PRESENT`               | Forma de pago sin moto en una venta que tiene toma                     |

Auditoría: acción `SALES_OPERATION_CORRECTED`, con los datos anteriores y
`metadata = { correctedFields, detachedIncomes }`.

## Casco de regalo y patentamiento

- `includesHelmet` (default `false`): el cliente recibe casco de regalo.
- `licensingMode` es obligatorio en el alta:
  - `BONIFICADA`: no se le cobra la patente al cliente.
  - `PAGA_CLIENTE`: el cliente paga la patente. `licensingAmount` es opcional
    en el alta; el cobro se registra cuando llega la patente.
- `licensingAmount` sólo se acepta con `PAGA_CLIENTE` (`400
  LICENSING_AMOUNT_NOT_ALLOWED`); la base lo refuerza con un CHECK. Pasar a
  `BONIFICADA` sin importe lo limpia.
- Ventana estimada de llegada: 10 y 15 días hábiles desde `operationDate`.
  Hábil = lunes a viernes que no es feriado nacional argentino (fase 5). Los
  feriados viven en `src/sales/ar-holidays.ts`, una tabla versionada por año
  (inamovibles + trasladables en la fecha en que se gozan; sin días no
  laborables ni feriados provinciales). Un año no cargado se calcula sólo con
  lunes a viernes; un test avisa si falta el año en curso. Las ventanas ya
  guardadas no se recalculan: el feriado aplica a altas nuevas y a cambios de
  fecha. Es informativa: no bloquea ni genera deuda ni estados.
  `licensing.overdue=true` resalta operaciones en PENDIENTE_APROBACION,
  APROBADA o CERRADA que pasaron `estimatedTo` (fecha de Argentina) sin
  patente recibida.
- `GET /api/sales/operations/licensing-calendar` (`ventas.consultar`) devuelve
  `{ businessDays: { from: 10, to: 15 }, holidays: ["2026-01-01", ...] }` para
  que el front previsualice la misma ventana que guarda la API.
- Operaciones anteriores a esta versión quedan con `licensing.mode=null`
  (`SIN_DEFINIR`) y sin ventana hasta que se les asigne modalidad.

`PATCH /api/sales/operations/:id/licensing` (`ventas.patentamiento.gestionar`)
es la gestión administrativa desde la grilla:

```json
{ "expectedVersion": 4, "mode": "PAGA_CLIENTE", "amount": 85000 }
```

Reemplaza modalidad e importe juntos (omitir `amount` lo limpia), funciona en
cualquier estado salvo CANCELADA (`409 LICENSING_OPERATION_CANCELLED`), no
cambia el estado de la operación y, si la operación no tenía ventana estimada,
la calcula desde su fecha. No se puede pasar a `BONIFICADA` si ya hay un cobro
de patente al cliente (`409 LICENSING_COLLECTION_REGISTERED`, con
`details.incomeIds`).

`POST /api/sales/operations/:id/licensing/collections`
(`ventas.patentamiento.gestionar` + `ingresos.cobrar`) registra el cobro de
patente al cliente en un solo paso desde la grilla:

```json
{
  "idempotencyKey": "uuid",
  "accountId": "uuid cuenta de caja",
  "amount": "85000.00",
  "collectionDate": "2026-09-20",
  "reference": "optional; por defecto el número de boleto",
  "notes": "optional"
}
```

En la misma transacción crea el ingreso `type: "Patente"` vinculado a la
operación (sucursal y unidad de la operación) y su movimiento de caja INGRESO
en la cuenta elegida, así que el ingreso queda cobrado (`PAGADO`). Sólo aplica
con `PAGA_CLIENTE` (`409 LICENSING_COLLECTION_NOT_ALLOWED`), no en CANCELADA,
valida cuenta activa, sucursal y moneda como cualquier cobro de caja y es
idempotente: reintentar con la misma `idempotencyKey` devuelve la operación sin
duplicar el ingreso. `collectionDate` es opcional (hoy en Argentina); una fecha
anterior se contabiliza a las 12:00 de ese día.

### Llegada de la patente (fase 5)

`POST /api/sales/operations/:id/licensing/plate`
(`ventas.patentamiento.gestionar`) registra que llegó la patente, desde la
grilla de operaciones de la administrativa o desde pagos de vehículo:

```json
{
  "expectedVersion": 5,
  "licensePlate": "A123BCD",
  "receivedAt": "2026-09-24",
  "collection": {
    "idempotencyKey": "uuid",
    "accountId": "uuid",
    "amount": "85000.00",
    "collectionDate": "2026-09-24",
    "paymentMethod": "EFECTIVO",
    "handoverToId": "uuid"
  }
}
```

- Guarda el número en la unidad de la operación (`unidades_vehiculos.patente`
  en mayúsculas y `patente_normalizada` sólo letras y dígitos, igual que
  inventario) y la fecha en `operaciones.patente_recibida_en`. `receivedAt` es
  opcional (hoy en Argentina); no puede ser futura ni anterior a la operación.
  Volver a llamarlo corrige número o fecha.
- **BONIFICADA**: sólo número y fecha, no se cobra nada.
- **PAGA_CLIENTE**: número y fecha y, opcionalmente en el mismo paso,
  `collection` con el mismo contrato que `POST /:id/licensing/collections`
  (cuenta, importe, medio, quién lo recibió y, si es efectivo, a quién se
  rinde). Crea el ingreso `Patente` vinculado a operación, cliente y boleto
  en la misma transacción. `collection` exige además `ingresos.cobrar` (403) y
  sólo se acepta con PAGA_CLIENTE (`409 LICENSING_COLLECTION_NOT_ALLOWED`). El
  cobro también puede registrarse antes de que llegue la patente o después,
  con `POST /:id/licensing/collections`; si al llegar la patente no hay cobro
  que la cubra, queda "recibida, cobro pendiente".
- El pago de Luma a la gestoría **no** se registra acá: sigue en pagos de
  vehículo (ver abajo).

Errores: `400 INVALID_LICENSE_PLATE` (menos de 5 o más de 10 letras/dígitos),
`400 LICENSE_PLATE_RECEIVED_IN_FUTURE`, `400
LICENSE_PLATE_RECEIVED_BEFORE_OPERATION`, `409 LICENSE_PLATE_NOT_ALLOWED`
(sólo PENDIENTE_APROBACION, APROBADA o CERRADA), `409 LICENSING_MODE_REQUIRED`
(operación histórica sin modalidad: definirla primero), `409
OPERATION_UNIT_REQUIRED` (todavía sin unidad física), `409
LICENSE_PLATE_IN_USE` (otra unidad de la organización tiene esa patente;
`details.unitId`, `details.vin`) y `409` por `expectedVersion`.

### Pago de patente a la gestoría

Se registra siempre en pagos de vehículo (`/motos/pagos-vehiculo`), con
`POST /api/vehicle-payments`, concepto `Patente`, la unidad y `operationId`.
Desde la operación, la acción "Registrar pago de patente" abre ese mismo
formulario precargado (operación, unidad y concepto); no hay un segundo
formulario en la grilla de operaciones. En pagos de vehículo:

- `GET /api/vehicle-payments?search=` busca además por número de boleto
  (`operaciones.numero_boleto`).
- El formulario busca la operación por boleto (con
  `GET /api/sales/operations?search=`) y precarga operación y unidad. Si la
  operación todavía no tiene unidad (pendiente de asignar, pedida o pendiente
  de ingreso del proveedor), lo informa y no permite cargar el pago.
- Cada fila con operación devuelve `operation.ticketNumber` y
  `operation.licensing` (`mode`, `estimatedFrom`, `estimatedTo`, `overdue` y
  `plate`), con las mismas reglas que la operación.

### Resumen `licensing`

La respuesta de la operación resume modalidad, cobro, pago y patente en
`licensing`:

```json
{
  "includesHelmet": true,
  "licensing": {
    "mode": "PAGA_CLIENTE",
    "amount": "85000",
    "status": "COBRO_PENDIENTE",
    "estimatedFrom": "2026-09-11",
    "estimatedTo": "2026-09-18",
    "plateLoaded": false,
    "overdue": true,
    "plate": { "status": "EN_TRAMITE_VENCIDA", "number": null, "receivedAt": null },
    "collection": { "status": "PENDIENTE", "amount": "85000.00", "incomeIds": ["uuid"] },
    "payment": { "status": "SIN_REGISTRAR", "amount": "0.00", "paymentIds": [] }
  }
}
```

`status`: `SIN_DEFINIR`, `COBRO_PENDIENTE`/`COBRADO` (PAGA_CLIENTE: COBRADO
cuando los ingresos de patente están cobrados y, si hay `amount`, su total lo
cubre) o `PAGO_PENDIENTE`/`PAGADO`
(BONIFICADA, según exista un pago de patente PAGADO). `collection.status`:
`SIN_REGISTRAR|PENDIENTE|PAGO_PARCIAL|PAGADO`; `payment.status`:
`SIN_REGISTRAR|PENDIENTE|PAGADO`. Los ingresos de patente `ANULADO` no cuentan
como cobro (fase 5).

`plate.status` (fase 5) es la situación de la patente en sí:

| `plate.status` | Texto en pantalla | Cuándo |
| --- | --- | --- |
| `EN_TRAMITE` | Patente en trámite (estimada entre X e Y) | sin patente recibida |
| `EN_TRAMITE_VENCIDA` | En trámite, pasó la fecha estimada | igual que `overdue`; sólo recordatorio |
| `RECIBIDA` | Patente recibida | BONIFICADA o modalidad sin definir |
| `RECIBIDA_COBRO_PENDIENTE` | Recibida, pago pendiente | PAGA_CLIENTE sin cobro que cubra la patente |
| `RECIBIDA_COBRADA` | Recibida y paga | PAGA_CLIENTE con `status = COBRADO` |
| `NO_APLICA` | — | BORRADOR, RECHAZADA o CANCELADA sin patente |

La patente cuenta como recibida si se registró su llegada
(`patente_recibida_en`) o si la unidad ya tenía patente (usados y cargas
anteriores a la fase 5, sin fecha). `plateLoaded` se mantiene por
compatibilidad y equivale a "recibida".

`GET /api/sales/operations` acepta además
`licensingMode=BONIFICADA|PAGA_CLIENTE|SIN_DEFINIR`, `licensingOverdue=true|false`
y `licensingCollectionPending=true` (fase 5: PAGA_CLIENTE con la patente
recibida y el cobro al cliente pendiente).

Plataformas: `EFECTIVO`, `CREDITO`, `EFECTIVO_CREDITO`, `MOTO_EFECTIVO`,
`MOTO_CREDITO`, `MOTO_EFECTIVO_CREDITO`. `creditAmount` es obligatorio y
positivo exactamente cuando la plataforma contiene crédito, y no puede superar
el cierre. `debt`: `NO|RESERVA|CUOTA_INICIAL|PAPELES|ACCESORIOS|OTRO`.

## Asignación de unidad (fase 3)

Sólo para motos: `assign-unit` y `supply-request` sobre un auto responden
`400 ASSIGNMENT_ONLY_FOR_MOTOS`.

Se gestiona desde la grilla de operaciones de motos (no hay pantalla aparte):
la columna "Unidad" muestra la situación y, con `ventas.asignar_unidad`, las
acciones "Asignar de stock", "Pedir a proveedor" (además
`abastecimiento.gestionar`) y "Registrar llegada" (`abastecimiento.recibir`).
El atajo "A asignar" del menú abre esa grilla con `?unidad=SIN_ASIGNAR`, que
el front traduce a `GET /api/sales/operations?vehicleType=MOTO&
fulfillmentStatus=SIN_ASIGNAR` (acotada por sucursal como todo el listado).
`fulfillmentStatus` acepta `PENDIENTE_ASIGNACION|PEDIDA|PENDIENTE_INGRESO|
RECIBIDA|ASIGNADA|SIN_ASIGNAR`. `SIN_ASIGNAR` es la bandeja: operaciones sin
unidad ya enviadas por el vendedor (PENDIENTE_APROBACION o APROBADA).

Lista y detalle devuelven:

```json
{
  "requestedColor": "Rojo",
  "fulfillment": {
    "status": "PEDIDA",
    "supplyRequestId": "uuid",
    "supplyStatus": "PEDIDO",
    "supplier": { "id": "uuid", "legalName": "Proveedor A" },
    "requestedAt": "…", "orderedAt": "…", "dispatchedAt": null, "receivedAt": null
  }
}
```

| `status` | Texto en pantalla | Cuándo |
| --- | --- | --- |
| `PENDIENTE_ASIGNACION` | Pendiente de asignar unidad | sin unidad y sin pedido vigente |
| `PEDIDA` | Pedida a proveedor X (fecha) | pedido en PENDIENTE_*, CONFIRMADO o PEDIDO |
| `PENDIENTE_INGRESO` | Pendiente de ingreso del proveedor | pedido EN_TRANSITO |
| `RECIBIDA` | Recibida, falta asignar | pedido recibido sin unidad en la operación (flujo anterior) |
| `ASIGNADA` | Recibida / asignada | la operación tiene unidad física |

Se toma el último pedido no cancelado.

`POST /api/sales/operations/:id/assign-unit` (`ventas.asignar_unidad`):
`{expectedVersion, unitId, vin?, engineNumber?}`. La unidad debe estar
`EN_STOCK` en la sucursal de la operación, con la misma versión y condición.
Reserva la unidad por 30 días, la marca RESERVADO y la vincula; no cambia el
estado de la operación. `vin`/`engineNumber` confirman o corrigen chasis y motor
y requieren además `inventario.gestionar` (403). Errores: `409
OPERATION_NOT_ASSIGNABLE` (sólo BORRADOR, PENDIENTE_APROBACION o APROBADA),
`409 OPERATION_ALREADY_HAS_UNIT`, `409 SUPPLY_REQUEST_IN_PROGRESS` (hay un
pedido sin recibir: recibirlo o cancelarlo), `409
INVENTORY_UNIT_ALREADY_RESERVED`, `400 VIN is invalid`.

`POST /api/sales/operations/:id/supply-request` (`ventas.asignar_unidad` +
`abastecimiento.gestionar`): `{expectedVersion, supplierId, color?,
supplierReference?, estimatedCost?, notes?}`. Crea el pedido al proveedor
elegido en ese momento, en estado `PEDIDO`, con llegada a la sucursal de la
operación y el color deseado por defecto. La misma versión puede pedirse a
proveedores distintos; la disponibilidad de proveedores es sólo una sugerencia.
Un pedido vigente por operación (`409 SUPPLY_REQUEST_IN_PROGRESS`). La
recepción (`POST /supply-requests/:id/receive`, ver api-stock-supply.md) da de
alta la unidad con chasis y motor, la reserva y la asigna a la operación.

Operaciones anteriores con reserva sobre disponibilidad: siguen funcionando.
Su pedido se recibe igual que antes; asignar desde stock o pedir a otro
proveedor libera esa reserva ("Reemplazada por…"). Una reserva de
disponibilidad vencida ya no bloquea enviar ni aprobar.

## Componentes, toma y aprobación

`POST /api/sales/operations/:id/trade-ins` crea la moto tomada con
`expectedVersion`, `description`, `appraisedAmount` y opcionales `versionId`,
`vin`, `engineNumber`, `licensePlate`, `year`, `kilometers`, `acceptedAmount`.

`POST /api/sales/operations/:id/payment-plan` reemplaza el plan completo:

```json
{
  "expectedVersion": 3,
  "components": [
    { "type": "EFECTIVO", "amount": 1500000 },
    {
      "type": "FINANCIACION",
      "amount": 1000000,
      "financialInstitutionId": "uuid",
      "creditInquiryId": "uuid optional"
    }
  ]
}
```

Tipos: `EFECTIVO|TRANSFERENCIA_BANCARIA|TARJETA|FINANCIACION|TOMA_PARTE_PAGO|OTRO`.
El total debe igualar `agreedPrice`, la suma FINANCIACION debe igualar
`creditAmount`, la combinación debe coincidir con `paymentPlatform` y
TOMA_PARTE_PAGO requiere `tradeInVehicleId`. No se reemplaza un plan con
cobranzas existentes (cobranzas legacy o ingresos generados por un componente).

Cobro de un componente (fase 4):
`POST /api/sales/operations/:id/payment-components/:componentId/collections`
crea el ingreso ya vinculado a operación, cliente, número de boleto y
componente, con su movimiento de caja y el circuito de rendición si es
efectivo. La grilla de seguimiento es `GET /api/sales/operations/tracking`.
Contrato completo en
[`financial-administration-api.md`](financial-administration-api.md).

La bandeja es
`GET /api/sales/operations/approvals?vehicleType=MOTO|AUTO` y fuerza estado
`PENDIENTE_APROBACION`. Decisiones:
`POST /:id/approve {expectedVersion,notes?}` y
`POST /:id/reject {expectedVersion,reason}`. Rechazar libera reserva y cancela
abastecimiento pendiente.

## Respuesta y resto de rutas

Lista y detalle devuelven documento/nombre/teléfono del cliente, mes derivado,
tipo/versión/unidad/chasis, origen de adquisición, sucursal destino,
abastecimiento y observación, vendedor, contacto, usuario creador,
`paymentPlatform`, `creditAmount`, garante, entrega, debe, papeles,
componentes, tomas, obligaciones, reserva, aprobación, `ticketNumber`
(número de boleto), `includesHelmet` y `licensing`. Dinero se serializa como
string decimal. `search` busca por número de operación, cliente, chasis,
patente y número de boleto.

Rutas adicionales: `GET /sellers`, `GET /price-policy`, `GET /:id`,
`POST /:id/reservation`, `POST /:id/reservation/release`,
`POST /:id/cancel`, `POST /:id/close`. Los DTO rechazan campos desconocidos y
`expectedVersion` debe coincidir con `rowVersion` o responde `409`. Cerrar exige
APROBADA, unidad física asignada (`409 OPERATION_UNIT_REQUIRED` si todavía está
pendiente de asignar o pedida al proveedor), reserva vigente y plan total
exacto; consume la reserva y marca la unidad VENDIDO. Cancelar cancela los
pedidos al proveedor no recibidos.

Lookups de formulario:

- `GET /api/sales/operations/sellers?organizationId=&branchId?=&search=&page=&limit=`
  devuelve por defecto los vendedores activos de toda la organización; `branchId`
  es un filtro opcional para otros consumidores. Cada item es
  `{id,employeeCode,fullName,isCurrentUser,branch:{id,code,name}|null,
branches:[{id,code,name}]}`; `branch` es la sucursal principal y `branches`
  incluye además sus accesos habilitados, sin duplicados.
  VENDEDOR puede ver la lista pero el backend sólo le permite asignarse a sí
  mismo.
- `GET /api/sales/operations/contacts?organizationId=&branchId?=&search=&page=&limit=`
  devuelve el personal activo elegible de toda la organización con el mismo
  shape; `branchId` también es opcional.
- `GET /api/sales/operations/financial-institutions?search=&page=&limit=`
  devuelve `{id,legalName}` para financieras activas.
- `GET /api/sales/operations/price-policy` requiere `branchId`, `versionId` y
  `vehicleType`; acepta `condition`, `operationDate` y `organizationId`.

## Alcance por sucursal

Listados, detalle, aprobaciones, altas, ediciones y lookups de vendedores/contactos quedan acotados a las sucursales del usuario (`sucursales.todas` o `acceso_global` ven todas). `branchId` fuera del alcance responde `403 BRANCH_OUT_OF_SCOPE`; una operación de otra sucursal responde `404`. En `POST /sales/operations` `branchId` es opcional cuando el usuario tiene una sola sucursal: el backend la asume. Ver [`api-branch-scope.md`](api-branch-scope.md).

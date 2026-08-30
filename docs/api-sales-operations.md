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
  "unitId": "uuid optional",
  "supplierAvailabilityId": "uuid optional",
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
  "organizationId": "uuid optional; propio o acceso global"
}
```

El contrato principal usa `client`; `clientId` se acepta como alternativa
temporal compatible, nunca junto con `client`. La misma transacción tenant/RLS
normaliza y bloquea la identidad organización+tipo+número, reutiliza el cliente
activo o lo crea y luego crea la operación. No requiere `clientes.gestionar`.
Una coincidencia existente sólo actualiza nombre, teléfono y presentación del
documento; una coincidencia inactiva devuelve `409`.

Se exige exactamente uno entre `unitId` y `supplierAvailabilityId`. La unidad
física debe estar `EN_STOCK`. La disponibilidad debe pertenecer al mismo tenant,
versión y condición, estar vigente y conservar cantidad informada no reservada
mayor a cero. La operación, reserva y solicitud de abastecimiento se crean en la
misma transacción; `supplierId` se resuelve desde la disponibilidad y no se acepta
como atajo independiente. La cantidad informada se descuenta al recibir.

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
`operationDate`, `deliveryStatus`, `papersDelivered`, `debt` y `notes`
(nullable). BORRADOR/RECHAZADA vuelven a BORRADOR. APROBADA sólo admite
entrega, papeles, debe y observaciones.

Plataformas: `EFECTIVO`, `CREDITO`, `EFECTIVO_CREDITO`, `MOTO_EFECTIVO`,
`MOTO_CREDITO`, `MOTO_EFECTIVO_CREDITO`. `creditAmount` es obligatorio y
positivo exactamente cuando la plataforma contiene crédito, y no puede superar
el cierre. `debt`: `NO|RESERVA|CUOTA_INICIAL|PAPELES|ACCESORIOS|OTRO`.

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
cobranzas existentes.

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
componentes, tomas, obligaciones, reserva y aprobación. Dinero se serializa
como string decimal.

Rutas adicionales: `GET /sellers`, `GET /price-policy`, `GET /:id`,
`POST /:id/reservation`, `POST /:id/reservation/release`,
`POST /:id/cancel`, `POST /:id/close`. Los DTO rechazan campos desconocidos y
`expectedVersion` debe coincidir con `rowVersion` o responde `409`. Cerrar exige
APROBADA, unidad física/reserva válida y plan total exacto; consume la reserva y
marca la unidad VENDIDO.

Lookups de formulario:

- `GET /api/sales/operations/sellers?branchId=&search=&page=&limit=` devuelve
  personal activo con usuario VENDEDOR activo; cada item es
  `{id,employeeCode,fullName,isCurrentUser}`. VENDEDOR puede ver la lista pero
  el backend sólo le permite asignarse a sí mismo.
- `GET /api/sales/operations/contacts?branchId=&search=&page=&limit=` devuelve
  personal activo elegible de la sucursal con el mismo shape.
- `GET /api/sales/operations/financial-institutions?search=&page=&limit=`
  devuelve `{id,legalName}` para financieras activas.
- `GET /api/sales/operations/price-policy` requiere `branchId`, `versionId` y
  `vehicleType`; acepta `condition`, `operationDate` y `organizationId`.

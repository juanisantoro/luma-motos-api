# API de comisiones

Todas las rutas usan el prefijo `/api/commissions`, requieren JWT y aplican
aislamiento por organización mediante RLS forzado. Los importes se serializan
como `string` decimal, las fechas comerciales como `YYYY-MM-DD` y los períodos
como `YYYY-MM`.

`vehicleType` es obligatorio en las consultas y sólo admite `MOTO` o `AUTO`.
Los tipos nunca comparten operaciones, políticas, escalas ni liquidaciones.

## Regla de cálculo

La escala define un **monto fijo total del período**. No se multiplica por la
cantidad de vehículos. Por ejemplo, 13 motos en la escala 11–15 generan
`45000.00`, no `585000.00`.

Sólo computan operaciones `APROBADA` o `CERRADA` cuya `fecha_operacion`
pertenezca al período y cuyo vendedor principal tenga asignación `VENDEDOR`.
Una asignación `CONTACTO` no comisiona. Las operaciones bajo lista computan al
estar aprobadas/cerradas y exponen precio de lista, cierre, diferencia y
`belowList`.

## Permisos

| Permiso | Roles iniciales | Uso |
| --- | --- | --- |
| `comisiones.consultar` | Administrador, Gerente | Sugeridos, detalle y pendientes |
| `comisiones.configurar` | Administrador | Políticas y escalas |
| `comisiones.acordar` | Administrador, Gerente | Acuerdos |
| `comisiones.pagar` | Administrador, Gerente | Pago completo |
| `comisiones.historial` | Administrador, Gerente | Historial pagado |
| `comisiones.propias` | Vendedor | Progreso e historial propios |

## Sugeridos y reunión

### `GET /suggestions`

Query requerida: `period`, `vehicleType`. Filtros opcionales: `branchId`,
`sellerId`, `minComputableSales`, `maxComputableSales`, `organizationId`,
`page` y `limit`.

```json
{
  "items": [
    {
      "id": "snapshot-id",
      "seller": { "id": "uuid", "name": "Vendedor" },
      "branch": { "id": "uuid", "name": "San Miguel" },
      "period": "2026-08",
      "vehicleType": "MOTO",
      "configurationStatus": "CONFIGURED",
      "computableSales": 13,
      "scale": {
        "id": "uuid",
        "minUnits": 11,
        "maxUnits": 15,
        "fixedAmount": "45000.00",
        "validFrom": "2000-01-01",
        "validTo": null
      },
      "suggestedAmount": "45000.00",
      "status": "CALCULATED",
      "nextScale": {
        "id": "uuid",
        "minUnits": 16,
        "maxUnits": null,
        "fixedAmount": "50000.00",
        "validFrom": "2000-01-01",
        "validTo": null
      },
      "unitsToNextScale": 3,
      "version": 0
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50
}
```

Sin política activa, la respuesta usa `configurationStatus: "NOT_CONFIGURED"`
y `scale`, `nextScale`, `suggestedAmount` y `unitsToNextScale` en `null`.

### `GET /suggestions/:id`

Agrega `operations` y `settlement`. Cada operación contiene `id`, `date`,
`operationNumber`, `customerName`, `vehicleLabel`, `listPrice`,
`closingPrice`, `difference`, `belowList`, `computable`,
`nonComputableReason`, `eligibilityReason` y `status`.

### `PUT /suggestions/:id/agreement`

```json
{
  "agreedAmount": "46000.00",
  "meetingDate": "2026-08-29",
  "notes": "Monto acordado en reunión",
  "expectedVersion": 0
}
```

`expectedVersion` es opcional al crear y obligatorio para modificar un acuerdo
existente. Repetir exactamente el mismo acuerdo es idempotente. La liquidación
guarda snapshots inmutables de política, escala y operaciones. Un importe
distinto del sugerido queda registrado en auditoría.

## Liquidaciones y pago

### `GET /settlements`

Requiere `vehicleType`. Acepta `status`, `period`, `branchId`, `sellerId`,
`organizationId`, `page` y `limit`. Sin `status` lista `AGREED` y
`PENDING_PAYMENT`.

### `POST /settlements/:id/payments`

```json
{
  "idempotencyKey": "uuid",
  "expectedVersion": 0,
  "accountId": "uuid",
  "paidAt": "2026-08-29T15:00:00.000Z",
  "reference": "TRX-123",
  "receipt": "COMPROBANTE-123",
  "notes": "Pago completo"
}
```

El endpoint no acepta `amount`: siempre paga el total acordado. En una única
transacción crea un gasto `COMISIONES`, registra el egreso en la cuenta y marca
la liquidación `PAID`. Si caja falla, todo se revierte. La misma clave y payload
devuelven el resultado existente; una clave reutilizada con otro payload falla.

### `GET /history`

Requiere `vehicleType`. Filtros: `sellerId`, `branchId`, `paidFrom`, `paidTo`,
`year` junto con `month`, `organizationId`, `page` y `limit`. Sólo devuelve
liquidaciones `PAID`, con `paidAmount`, cuenta, referencia y `auditTrail`.

## Vista propia

### `GET /me`

Requiere `period` y `vehicleType`; acepta `historyYear`, `historyMonth`, `page`
y `limit`. No acepta `sellerId`. El backend resuelve el perfil desde el JWT y
devuelve:

```json
{
  "progress": {},
  "paidHistory": { "items": [], "total": 0, "page": 1, "limit": 50 }
}
```

## Políticas y escalas

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/policies` | Lista por `vehicleType`, estado y organización |
| `GET` | `/policies/:id` | Detalle |
| `POST` | `/policies` | Crea un set atómico |
| `PUT` | `/policies/:id` | Edita sólo un borrador con `expectedVersion` |
| `POST` | `/policies/:id/activate` | Activa una versión |
| `POST` | `/policies/:id/deactivate` | Desactiva una versión |
| `DELETE` | `/policies/:id` | Elimina sólo un borrador |

El cuerpo de creación contiene `vehicleType`, `currency`, `validFrom`,
`validTo`, `status` (`DRAFT` o `ACTIVE`) y:

```json
{
  "tiers": [
    { "minUnits": 1, "maxUnits": 5, "fixedAmount": "35000.00" },
    { "minUnits": 6, "maxUnits": null, "fixedAmount": "40000.00" }
  ]
}
```

Los rangos comienzan en 1, son inclusivos y continuos, no tienen huecos ni
solapamientos y el último queda abierto. Los importes son no negativos. El seed
idempotente crea únicamente la política MOTO: 1–5 `35000`, 6–10 `40000`,
11–15 `45000`, 16+ `50000`. AUTO queda sin configurar.

## Errores de dominio

Los errores tipados usan `{ "statusCode", "error", "code", "message" }`.
Los códigos principales son `COMMISSION_POLICY_NOT_CONFIGURED`,
`INVALID_COMMISSION_TIERS`, `POLICY_PERIOD_OVERLAP`, `POLICY_IMMUTABLE`,
`COMMISSION_SETTLEMENT_NOT_FOUND`, `COMMISSION_ALREADY_PAID`,
`COMMISSION_NOT_AGREED`, `COMMISSION_STALE_VERSION`,
`IDEMPOTENCY_CONFLICT`, `SELLER_PROFILE_NOT_FOUND` y `CURRENCY_MISMATCH`.

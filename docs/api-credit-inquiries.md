# API de consultas crediticias

Base URL: `/api`. Todos los endpoints requieren `Authorization: Bearer <token>`.
La organización se toma de la sesión autenticada y no se acepta por parámetro.

## Permisos

| Código | Alcance MVP |
| --- | --- |
| `consultas_crediticias.consultar` | Consolidado de rechazos, historial y registrantes. Administrativa, Gerente y Administrador. |
| `consultas_crediticias.verificar` | Verificación previa por documento. Todos los roles del MVP. |
| `consultas_crediticias.registrar` | Alta de consultas y lectura del catálogo de financieras. Todos los roles del MVP. |
| `financieras.gestionar` | Alta de financieras. Administrativa, Gerente y Administrador. |

`GET /financial-institutions` acepta `consultas_crediticias.consultar` **o**
`consultas_crediticias.registrar`. `GET /credit-inquiries/branches` acepta cualquiera
de los tres permisos de consultas crediticias.

## Consolidado de rechazos

`GET /credit-inquiries/rejected`

Query params:

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `search` | string opcional | Coincidencia parcial por nombre o documento. |
| `document` | string opcional | Coincidencia parcial por documento normalizado. |
| `financialEntityId` | UUID opcional | Financiera. |
| `dateFrom` / `dateTo` | ISO-8601 opcional | Rango inclusivo de fecha/hora. Una `dateTo` `YYYY-MM-DD` incluye todo ese día UTC. |
| `branchId` | UUID opcional | Sucursal donde se registró. |
| `registeredById` | UUID opcional | Personal que registró. |
| `page` | entero, default `1` | Página desde 1. |
| `limit` | entero 1-100, default `50` | Tamaño de página. |

Cada fila representa **un rechazo real**. Un cliente con varios rechazos aparece en
varias filas; `attemptCount` se deriva de todo su historial, incluidos estados
`APROBADA`, `RECHAZADA` y `PENDIENTE`.

```json
{
  "items": [
    {
      "id": "uuid-consulta",
      "client": {
        "id": "uuid-cliente",
        "documentType": "DNI",
        "documentNumber": "12.345.678",
        "fullName": "Ana Cliente"
      },
      "financialEntity": {
        "id": "uuid-financiera",
        "name": "Banco Demo"
      },
      "outcome": "RECHAZADA",
      "reason": "Scoring insuficiente",
      "consultedAt": "2026-08-29T15:00:00.000Z",
      "attemptCount": 3,
      "branch": {
        "id": "uuid-sucursal",
        "code": "SAN_MIGUEL",
        "name": "San Miguel"
      },
      "registeredBy": {
        "id": "uuid-personal",
        "fullName": "Vendedor Demo"
      },
      "operation": {
        "id": "uuid-operacion",
        "number": "1048"
      },
      "externalReference": null,
      "createdAt": "2026-08-29T15:00:01.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50
}
```

## Registrar una consulta

`POST /credit-inquiries`

Header obligatorio:

```http
Idempotency-Key: credit-form-8f9166ab
```

La clave admite 8-120 caracteres `A-Z`, `a-z`, `0-9`, `.`, `_`, `:` o `-`.
Repetir clave y payload devuelve la misma consulta con `idempotentReplay: true`.
Reutilizar la clave con otro payload devuelve `409`.

```json
{
  "documentType": "DNI",
  "documentNumber": "12.345.678",
  "fullName": "Ana Cliente",
  "financialEntityId": "uuid-financiera",
  "outcome": "RECHAZADA",
  "reason": "Scoring insuficiente",
  "consultedAt": "2026-08-29T15:00:00.000Z",
  "registeredById": "uuid-personal-opcional",
  "branchId": "uuid-sucursal-opcional",
  "operationId": "uuid-operacion-opcional",
  "externalReference": "referencia-opcional"
}
```

- `documentType`: `DNI | CUIT | CI | PASAPORTE | OTRO`.
- `outcome`: `PENDIENTE | APROBADA | RECHAZADA`.
- `reason` es obligatorio y no vacío para `RECHAZADA`.
- `consultedAt` no puede estar más de cinco minutos en el futuro.
- Si el documento ya existe se reutiliza el cliente del tenant; si no, se crea
  atómicamente.
- `registeredById` se omite normalmente y se deriva del usuario autenticado. Puede
  enviarse el ID propio; elegir otro registrante exige
  `consultas_crediticias.consultar`. El registrante debe estar activo, poder iniciar
  sesión y conservar `consultas_crediticias.registrar`.
- `branchId` se deriva de la sucursal de sesión o principal si se omite.
- Registrante, sucursal, financiera, cliente y operación deben pertenecer al tenant.
  La operación, si existe, debe corresponder al mismo cliente.

La respuesta `201` tiene la misma forma de una fila del consolidado, más:

```json
{ "idempotentReplay": false }
```

## Verificación rápida por documento

`GET /credit-inquiries/verify?documentType=DNI&documentNumber=12.345.678`

Siempre devuelve `200`, incluso si el cliente no existe. No devuelve ni repite el
documento o el nombre.

```json
{
  "found": true,
  "clientId": "uuid-cliente",
  "isFlagged": true,
  "blocksSale": false,
  "lastRejection": {
    "inquiryId": "uuid-consulta",
    "financialEntity": {
      "id": "uuid-financiera",
      "name": "Banco Demo"
    },
    "rejectedAt": "2026-08-29T15:00:00.000Z",
    "reason": "Scoring insuficiente"
  },
  "summary": {
    "totalAttempts": 3,
    "rejectedAttempts": 2,
    "approvedAttempts": 1,
    "pendingAttempts": 0,
    "firstConsultedAt": "2026-07-15T10:00:00.000Z",
    "lastConsultedAt": "2026-08-29T15:00:00.000Z"
  },
  "checkedAt": "2026-08-29T15:01:00.000Z"
}
```

Sin coincidencia: `found: false`, `clientId: null`, `isFlagged: false`,
`lastRejection: null` y contadores en cero.

`isFlagged` sólo deriva de rechazos reales. `blocksSale` es siempre `false`: la
alerta es informativa y `POST /sales/operations` no se bloquea ni cambia.

## Historial por cliente

`GET /credit-inquiries/clients/:clientId/history`

Query: `outcome` opcional y `page`/`limit`. Devuelve `client`, `items`,
`summary`, `total`, `page` y `limit`. Los items tienen la forma del consolidado y
conservan todos los outcomes. Un cliente inexistente o de otro tenant devuelve `404`.

## Catálogos

### Financieras

`GET /financial-institutions?search=&active=true&page=1&limit=50`

```json
{
  "items": [
    {
      "id": "uuid-financiera",
      "name": "Banco Demo",
      "taxId": "30-12345678-9",
      "active": true,
      "createdAt": "2026-08-29T15:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50
}
```

`POST /financial-institutions`

```json
{ "name": "Banco Demo", "taxId": "30-12345678-9" }
```

Nombre y CUIT/identificación fiscal se normalizan. Un duplicado dentro de la
organización devuelve `409`; otra organización mantiene su propio catálogo.

### Sucursales

`GET /credit-inquiries/branches?search=&page=1&limit=50`

Items: `{ "id": "uuid", "code": "SAN_MIGUEL", "name": "San Miguel" }`.

### Registrantes

`GET /credit-inquiries/registrants?search=&branchId=&page=1&limit=50`

Requiere `consultas_crediticias.consultar`. Sólo lista personal activo habilitado
para registrar consultas. Items:

```json
{
  "id": "uuid-personal",
  "fullName": "Vendedor Demo",
  "primaryBranch": {
    "id": "uuid-sucursal",
    "code": "SAN_MIGUEL",
    "name": "San Miguel"
  }
}
```

## Errores

- `400`: DTO inválido, documento inválido, rechazo sin motivo, fecha futura,
  cabecera de idempotencia inválida, referencias fuera del dominio permitido.
- `401`: sesión ausente o inválida.
- `403`: falta el permiso granular.
- `404`: historial solicitado para cliente inexistente/no visible.
- `409`: clave de idempotencia reutilizada con otro payload o financiera
  duplicada.

Los errores usan el formato estándar de NestJS (`statusCode`, `message`, `error`).
RLS y filtros explícitos limitan toda lectura/escritura al tenant autenticado. La
auditoría de altas se escribe en la misma transacción y no copia documento, nombre
de cliente ni motivo a metadata.

# Financial administration API

Definitive MVP contract for supplier purchases, incomes, expenses, cash
accounts, movements, and internal transfers.

## Conventions

- Global prefix: `/api`.
- JSON field names use `camelCase`.
- Monetary values are decimal strings with at most two decimals. Responses
  never serialize money as a JSON number.
- Business dates use `YYYY-MM-DD`. Timestamps use ISO 8601.
- List responses use `{ "items": [], "total": 0, "page": 1, "limit": 50 }`.
- `organizationId` may only be supplied by users with global access. All reads
  and writes also run under PostgreSQL RLS.
- A missing or cross-tenant entity returns `404`.
- There are no delete endpoints. Financial corrections append reversal
  movements.

## Payment state

Purchases, incomes, and expenses expose:

- `PENDIENTE`: active settled amount is zero.
- `PARCIAL`: active settled amount is greater than zero and below the total.
- `PAGADO`: active settled amount equals the total.

The API derives these values from non-reversed cash movements. The persisted
legacy state is synchronized transactionally but is not trusted for response
serialization.

Legacy incomes flagged for reconciliation cannot receive collections until
that reconciliation is resolved outside this MVP API.

## Idempotency and reversals

Payment, collection, recovery, transfer, and reversal requests require an
`idempotencyKey` UUID in the body.

- Repeating the same key and payload returns the existing result.
- Reusing a key with a different payload returns `409 IDEMPOTENCY_CONFLICT`.
- A movement may be reversed once. A second key returns
  `409 ALREADY_REVERSED`.
- Reversals append an equal movement in the opposite direction. Existing cash
  movements are database-enforced append-only.
- Internal transfers append one debit and one credit in the same transaction.
  They never create an income record.

## Permissions

| Permission | Capability | Default roles |
| --- | --- | --- |
| `compras.consultar` | List and view purchases without sensitive costs | Administrativa, Gerente, Administrador |
| `compras.gestionar` | Create and edit purchases | Administrativa, Gerente, Administrador |
| `compras.pagar` | Register purchase payments | Administrativa, Gerente, Administrador |
| `compras.costos.consultar` | View purchase amounts and linked movement amounts | Gerente, Administrador |
| `ingresos.consultar` | List and view incomes | Administrativa, Gerente, Administrador |
| `ingresos.gestionar` | Create and edit incomes | Administrativa, Gerente, Administrador |
| `ingresos.cobrar` | Register income collections | Administrativa, Gerente, Administrador |
| `gastos.consultar` | List and view expenses | Administrativa, Gerente, Administrador |
| `gastos.gestionar` | Create and edit expenses | Administrativa, Gerente, Administrador |
| `gastos.pagar` | Register expense payments | Administrativa, Gerente, Administrador |
| `gastos.recuperar` | Register recoveries | Administrativa, Gerente, Administrador |
| `caja.consultar` | View accounts, balances, movements, and transfers | Administrativa, Gerente, Administrador |
| `caja.gestionar` | Create and edit cash accounts | Gerente, Administrador |
| `caja.transferir` | Create internal transfers | Administrativa, Gerente, Administrador |
| `caja.reversar` | Reverse entity movements and transfers | Gerente, Administrador |

### Sensitive purchase policy

Without `compras.costos.consultar`, purchase list and detail responses omit all
of these keys:

`baseAmount`, `additionalCosts`, `totalAmount`, `paidAmount`, `balanceAmount`.

The same user also receives purchase-linked cash movements without `amount`,
including reversal movements. Fields are omitted rather than returned as
`null`, zero, or masked text. This applies independently of the user's role
name; the permission is the sole policy input.

The same policy omits `estimatedCost` and `purchaseCost` from supply request
and reception responses.

## Supplier purchases

### Routes

- `GET /supplier-purchases`
- `GET /supplier-purchases/:id`
- `POST /supplier-purchases`
- `PATCH /supplier-purchases/:id`
- `POST /supplier-purchases/:id/payments`
- `POST /supplier-purchases/:id/movements/:movementId/reverse`

### Filters

`page`, `limit`, `organizationId`, `branchId`, `from`, `to`, `status`,
`search`, `supplierId`, `unitId`, `versionId`.

### Create request

```json
{
  "organizationId": "uuid optional",
  "branchId": "uuid",
  "purchaseDate": "2026-08-29",
  "supplierId": "uuid",
  "unitId": "uuid optional",
  "versionId": "uuid optional",
  "documentNumber": "FC-A-123",
  "baseAmount": "1000000.00",
  "additionalCosts": "50000.00",
  "currency": "ARS",
  "notes": "optional"
}
```

Exactly one of `unitId` or `versionId` is required. When `unitId` is used, its
version is inferred and its branch must match `branchId`.

`PATCH` accepts the same editable fields except `organizationId` and
`currency`. It rejects totals below active payments.

### Response

```json
{
  "id": "uuid",
  "purchaseDate": "2026-08-29T00:00:00.000Z",
  "documentNumber": "FC-A-123",
  "currency": "ARS",
  "paymentStatus": "PARCIAL",
  "organizationId": "uuid",
  "supplier": { "id": "uuid", "legalName": "Proveedor SA" },
  "branch": { "id": "uuid", "code": "SM", "name": "San Miguel" },
  "vehicle": {
    "version": {
      "id": "uuid",
      "name": "Wave 110 S",
      "model": {
        "id": "uuid",
        "name": "Wave 110",
        "vehicleType": "MOTO",
        "brand": { "id": "uuid", "name": "Honda" }
      }
    },
    "unit": { "id": "uuid", "vin": "8CHASSIS", "licensePlate": null }
  },
  "baseAmount": "1000000",
  "additionalCosts": "50000",
  "totalAmount": "1050000",
  "paidAmount": "500000",
  "balanceAmount": "550000",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

Detail adds `notes` and `movements`.

## Incomes

### Routes

- `GET /incomes`
- `GET /incomes/:id`
- `POST /incomes`
- `PATCH /incomes/:id`
- `POST /incomes/:id/collections`
- `POST /incomes/:id/movements/:movementId/reverse`

### Filters

Common filters plus `type`, `unitId`, `operationId`, `accountId`,
`collectorId`.

`type` is a trimmed business string up to 120 characters, not a closed enum.
Suggested UI values are `VENTA_VEHICULO`, `VENTA_ACCESORIO`, `SERVICIO`, and
`OTRO`.

### Create request

```json
{
  "organizationId": "uuid optional",
  "branchId": "uuid",
  "incomeDate": "2026-08-29",
  "type": "VENTA_ACCESORIO",
  "reference": "TT-123",
  "unitId": "uuid optional",
  "operationId": "uuid optional",
  "description": "Casco",
  "totalAmount": "150000.00",
  "currency": "ARS",
  "notes": "optional"
}
```

`PATCH` accepts the same editable fields except `organizationId` and
`currency`. Month and year are always derived from `incomeDate`.

### Response

```json
{
  "id": "uuid",
  "incomeDate": "2026-08-29T00:00:00.000Z",
  "type": "VENTA_ACCESORIO",
  "reference": "TT-123",
  "description": "Casco",
  "totalAmount": "150000",
  "currency": "ARS",
  "paymentStatus": "PARCIAL",
  "paidAmount": "50000",
  "balanceAmount": "100000",
  "organizationId": "uuid",
  "branch": { "id": "uuid", "code": "SM", "name": "San Miguel" },
  "vehicle": {
    "unit": { "id": "uuid", "vin": "8CHASSIS", "licensePlate": null }
  },
  "operation": { "id": "uuid", "number": "1048" },
  "collector": { "id": "uuid", "fullName": "Lucía Fernández" },
  "account": { "id": "uuid", "code": "BANCO", "name": "Banco", "type": "BANCO" },
  "notes": "optional",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

Detail adds `movements`.

## Expenses

### Routes

- `GET /expenses`
- `GET /expenses/:id`
- `POST /expenses`
- `PATCH /expenses/:id`
- `POST /expenses/:id/payments`
- `POST /expenses/:id/recoveries`
- `POST /expenses/:id/movements/:movementId/reverse`

### Filters

Common filters plus `category`, `unitId`, `operationId`, `accountId`,
`recoverable`, `recovered`.

`category` is a trimmed business string up to 100 characters. It is not a
closed enum and requires no seed data.

### Create request

```json
{
  "organizationId": "uuid optional",
  "branchId": "uuid optional",
  "expenseDate": "2026-08-29",
  "category": "GESTORIA",
  "reference": "TT-123",
  "unitId": "uuid optional",
  "operationId": "uuid optional",
  "description": "Informe de dominio",
  "totalAmount": "25000.00",
  "currency": "ARS",
  "recoverable": true,
  "notes": "optional"
}
```

### Response

```json
{
  "id": "uuid",
  "expenseDate": "2026-08-29T00:00:00.000Z",
  "category": "GESTORIA",
  "reference": "TT-123",
  "description": "Informe de dominio",
  "totalAmount": "25000",
  "currency": "ARS",
  "paymentStatus": "PAGADO",
  "paidAmount": "25000",
  "balanceAmount": "0",
  "recoverable": true,
  "recovered": false,
  "recoveredAmount": "10000",
  "recoverableBalance": "15000",
  "organizationId": "uuid",
  "branch": { "id": "uuid", "code": "SM", "name": "San Miguel" },
  "vehicle": {
    "unit": { "id": "uuid", "vin": "8CHASSIS", "licensePlate": null }
  },
  "operation": { "id": "uuid", "number": "1048" },
  "createdBy": { "id": "uuid", "fullName": "Lucía Fernández" },
  "paidBy": { "id": "uuid", "fullName": "Lucía Fernández" },
  "account": { "id": "uuid", "code": "CAJA", "name": "Caja", "type": "CAJA" },
  "notes": "optional",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

Detail adds `movements`. Recovery is allowed only when `recoverable` is true,
cannot exceed `totalAmount`, and sets `recovered` when the active recovered
amount reaches the total.

## Settlements and movement response

Payment, collection, and recovery request:

```json
{
  "idempotencyKey": "uuid",
  "accountId": "uuid",
  "amount": "50000.00",
  "occurredAt": "2026-08-29T16:00:00.000-03:00",
  "reference": "TT-123",
  "notes": "optional"
}
```

Reversal request:

```json
{
  "idempotencyKey": "uuid",
  "reason": "Duplicate bank entry"
}
```

Cash movement:

```json
{
  "id": "uuid",
  "account": { "id": "uuid", "code": "CAJA", "name": "Caja", "type": "CAJA" },
  "type": "INGRESO",
  "direction": "CREDITO",
  "amount": "50000",
  "occurredAt": "timestamp",
  "reference": "TT-123",
  "notes": "optional",
  "registeredBy": { "id": "uuid", "fullName": "Lucía Fernández" },
  "reversed": false,
  "reversalOfId": null,
  "sourceType": "INCOME",
  "sourceId": "uuid",
  "createdAt": "timestamp"
}
```

Movement types are `INGRESO`, `EGRESO`, `TRANSFERENCIA_ENTRANTE`,
`TRANSFERENCIA_SALIENTE`, `REINTEGRO`, and `AJUSTE`. Directions are `CREDITO`
and `DEBITO`.

## Cash accounts and transfers

### Account routes

- `GET /cash/accounts`
- `GET /cash/accounts/:id`
- `POST /cash/accounts`
- `PATCH /cash/accounts/:id`
- `GET /cash/movements`

Account filters: `page`, `limit`, `organizationId`, `type`, `branchId`,
`active`, `search`.

Account create request:

```json
{
  "organizationId": "uuid optional",
  "code": "BANCO_ARS",
  "name": "Banco ARS",
  "type": "BANCO",
  "branchId": "uuid optional",
  "responsiblePersonnelId": "uuid optional",
  "currency": "ARS",
  "active": true
}
```

Account types are `CAJA`, `BANCO`, `SOCIO`, `PROCESADORA_TARJETA`,
`FINANCIERA`, and `OTRO`.

Account response includes the same identity fields, nested `branch`,
`responsiblePersonnel`, timestamps, and `balance` as a decimal string.

### Transfer routes

- `GET /cash/transfers`
- `GET /cash/transfers/:id`
- `POST /cash/transfers`
- `POST /cash/transfers/:id/reverse`

Transfer request:

```json
{
  "organizationId": "uuid optional",
  "idempotencyKey": "uuid",
  "sourceAccountId": "uuid",
  "destinationAccountId": "uuid",
  "amount": "100000.00",
  "occurredAt": "timestamp optional",
  "reference": "optional",
  "notes": "optional"
}
```

Transfer status is `CONFIRMADA`, `REVERSADA`, or `PENDIENTE`. Source and
destination must differ and use the same currency.

## Reference endpoints

- Suppliers: `GET /api/suppliers?active=true`.
- Branches: `GET /api/inventory/branches`.
- Vehicle versions: `GET /api/catalog/versions?active=true`.
- Units: `GET /api/inventory/units?vehicleType=MOTO|AUTO`.
- Sales operations: `GET /api/sales/operations`.

The actor responsible for a settlement is derived from the access token.
Clients must not submit personnel IDs for payment, collection, or recovery.

## Domain errors

Domain failures use:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "code": "OVERPAYMENT",
  "message": "Payment exceeds expense balance"
}
```

Stable codes include `INVALID_AMOUNT`, `INVALID_BUSINESS_DATE`,
`INVALID_BRANCH`, `INVALID_SUPPLIER`, `INVALID_CASH_ACCOUNT`,
`INVALID_VEHICLE_VERSION`, `VEHICLE_REFERENCE_REQUIRED`,
`AMBIGUOUS_VEHICLE_REFERENCE`, `UNIT_BRANCH_MISMATCH`,
`OPERATION_BRANCH_MISMATCH`, `OPERATION_UNIT_MISMATCH`,
`CURRENCY_MISMATCH`, `OVERPAYMENT`, `OVER_RECOVERY`,
`EDIT_BELOW_SETTLED`, `EXPENSE_NOT_RECOVERABLE`, `RECOVERY_EXISTS`,
`INCOME_REQUIRES_RECONCILIATION`, `IDEMPOTENCY_CONFLICT`,
`ALREADY_REVERSED`, and `UNBALANCED_TRANSFER`.

DTO validation and malformed UUIDs return Nest's standard `400` response.
Missing permissions return `403`.

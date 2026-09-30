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
| `caja.recibir_rendicion` | Receive cash handovers and confirm them | Administrador |

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
- `GET /incomes/cash-handover/recipients`
- `POST /incomes/:id/cash-handover/confirm`

### Filters

Common filters plus `type`, `unitId`, `operationId`, `accountId`,
`collectorId`, `clientId`, `ticketNumber`, `paymentMethod`,
`handoverStatus` (`PENDIENTE_RENDICION|RENDIDO`) and `handoverToId`.
`search` also matches the operation ticket number and the client name or
document number.

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
  "notes": "optional",
  "clientId": "uuid optional",
  "paymentMethod": "EFECTIVO optional",
  "collectedById": "uuid optional",
  "handoverToId": "uuid required for EFECTIVO"
}
```

`PATCH` accepts the same editable fields except `organizationId` and
`currency`. Month and year are always derived from `incomeDate`.

### Client ↔ operation link (fase 4)

Every income linked to an operation is also linked to its client and, through
the operation, to its ticket number (`operation.ticketNumber`):

- With `operationId`, `clientId` is optional and always resolves to the
  operation client. Sending another client returns
  `400 CLIENT_OPERATION_MISMATCH`.
- Without an operation, `clientId` may reference any client of the tenant
  (`400 INVALID_CLIENT` otherwise).
- PostgreSQL enforces it with the `luma_validar_vinculos_ingreso` trigger
  (fills `cliente_id` from the operation and rejects a different one) and a
  composite FK `(cliente_id, organizacion_id)`. When an operation changes its
  client, its incomes follow in the same transaction.
- Existing incomes linked to an operation were backfilled by the migration.

Incomes generated by a payment-plan collection (`paymentComponent` not null)
keep their operation, branch and amount: `409 INCOME_LINKED_TO_COMPONENT`.

### Cash and handover (fase 4)

`paymentMethod` uses `EFECTIVO|TRANSFERENCIA_BANCARIA|TARJETA|
DESEMBOLSO_FINANCIERA|PAGARE|OTRO`. For `EFECTIVO`:

- `collectedById` is who physically received the cash. It defaults to the
  personnel of the user who registers the income.
- `handoverToId` is mandatory (`400 HANDOVER_RECIPIENT_REQUIRED`) and must be
  active personnel with an active user whose role has
  `caja.recibir_rendicion` (`400 INVALID_HANDOVER_RECIPIENT`). The rule is the
  permission; no role name or person is hardcoded.
- The income starts in `PENDIENTE_RENDICION`. If the collector is the
  recipient, it starts `RENDIDO`.
- Non-cash methods reject `handoverToId` (`400 HANDOVER_ONLY_FOR_CASH`).
- Once `RENDIDO`, method, collector and recipient are locked
  (`409 HANDOVER_ALREADY_CONFIRMED`).

`GET /incomes/cash-handover/recipients` (`ingresos.consultar`, optional
`organizationId` for global access) lists valid recipients:

```json
[
  {
    "id": "uuid",
    "fullName": "Lucas",
    "isCurrentUser": false,
    "pendingCount": 2,
    "pendingAmount": "300000"
  }
]
```

`POST /incomes/:id/cash-handover/confirm` (`caja.recibir_rendicion`) with
`{ "expectedVersion": 3 }`. Only the recipient can confirm
(`403 HANDOVER_RECIPIENT_ONLY`); stale versions return `409 VERSION_CONFLICT`,
incomes without a pending handover `409 HANDOVER_NOT_PENDING` and incomes
without an active collection `409 HANDOVER_NOT_COLLECTED`. It stores the date
and the confirming personnel and returns the income detail.

The database enforces the same contract with CHECK constraints
(`ingresos_efectivo_requiere_cobrador`, `ingresos_efectivo_requiere_rendicion`,
`ingresos_rendicion_contrato`: the confirmer is always the recipient).

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
  "operation": { "id": "uuid", "number": "1048", "ticketNumber": "B-0001" },
  "client": {
    "id": "uuid",
    "fullName": "Ana Pérez",
    "documentType": "DNI",
    "documentNumber": "12345678"
  },
  "paymentComponent": {
    "id": "uuid",
    "type": "EFECTIVO",
    "expectedAmount": "1500000"
  },
  "paymentMethod": "EFECTIVO",
  "collectedBy": { "id": "uuid", "fullName": "Vendedor" },
  "handover": {
    "status": "PENDIENTE_RENDICION",
    "recipient": { "id": "uuid", "fullName": "Lucas" },
    "confirmedAt": null,
    "confirmedBy": null
  },
  "rowVersion": 0,
  "collector": { "id": "uuid", "fullName": "Lucía Fernández" },
  "account": { "id": "uuid", "code": "BANCO", "name": "Banco", "type": "BANCO" },
  "notes": "optional",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

Detail adds `movements`.

`collector` keeps its previous meaning (who registered the latest active cash
movement). `collectedBy` is who received the money. `handover` is `null` for
non-cash incomes.

## Payment-plan collections (fase 4)

`POST /sales/operations/:id/payment-components/:componentId/collections`
(`ventas.consultar` + `ingresos.cobrar`):

```json
{
  "idempotencyKey": "uuid",
  "accountId": "uuid",
  "amount": "150000.00",
  "collectionDate": "2026-09-29 optional",
  "paymentMethod": "optional; default from the component type",
  "collectedById": "uuid optional",
  "handoverToId": "uuid required for EFECTIVO",
  "reference": "optional; defaults to the ticket number",
  "notes": "optional"
}
```

In one transaction it creates the income (`type: "Cobro de operación"`)
linked to operation, client, ticket number, unit and component, registers the
INGRESO cash movement and syncs `componentes_pago_operacion.estado_pago`
(`PENDIENTE|PAGO_PARCIAL|PAGADO`). Nothing is loaded twice.

- Default method: EFECTIVO → EFECTIVO, TRANSFERENCIA_BANCARIA →
  TRANSFERENCIA_BANCARIA, TARJETA → TARJETA, FINANCIACION →
  DESEMBOLSO_FINANCIERA, OTRO → OTRO.
- `TOMA_PARTE_PAGO` and cancelled components: `409 COMPONENT_NOT_COLLECTIBLE`.
- Own-credit financing (financiera with `es_credito_propio`) is collected
  through its installments: `409 OWN_CREDIT_COLLECTED_BY_INSTALLMENTS`.
- The component total cannot be exceeded: `409 OVERPAYMENT` (with
  `details.expectedAmount` and `details.collectedAmount`).
- Cancelled operations: `409 OPERATION_CANCELLED`. Unknown component:
  `404 PAYMENT_COMPONENT_NOT_FOUND`.
- Idempotent: retrying with the same key returns the operation.
- Reversing the movement (`POST /incomes/:id/movements/:movementId/reverse`)
  resyncs the component status.
- A payment plan with component incomes (or legacy `cobranzas`) cannot be
  replaced, and trade-ins cannot be added to an approved operation with them.

The patent collection (`POST /sales/operations/:id/licensing/collections`)
accepts the same `paymentMethod`, `collectedById` and `handoverToId` fields.

## Financiera paid (fase 4)

External financing is closed by marking that the financiera paid. **No
amount is recorded**: whatever net came in is what counts ("se registra el
neto y listo").

- `POST /sales/operations/:id/payment-components/:componentId/financing-payment`
  with `{ "notes": "optional" }` (`ventas.consultar` + `ingresos.cobrar`).
  Stores date, personnel and notes, and sets the component `PAGADO`. The
  tracking balance stops expecting what the financiera did not deposit.
- `POST .../financing-payment/revert` with `{ "reason": "required" }` clears
  the mark; the status goes back to what the collections say. The reason is
  kept in the audit log.
- Errors: `409 NOT_A_FINANCING_COMPONENT`,
  `409 OWN_CREDIT_COLLECTED_BY_INSTALLMENTS`, `409 FINANCING_ALREADY_MARKED`,
  `409 FINANCING_NOT_MARKED`, `409 OPERATION_CANCELLED`,
  `404 PAYMENT_COMPONENT_NOT_FOUND`.
- The net deposit is registered as a collection of the component (optional,
  before or after marking). A settlement covering several operations can be
  registered once as an income without operation, to the bank account.

Components in operation responses add `financialInstitution`, `ownCredit`
and `financingPayment: { informedAt, informedBy, notes } | null`.

## Own credit (fase 4)

The own credit is loaded in the payment plan as `FINANCIACION` with the
financiera **"Crédito personal"** (created by the seed with
`es_credito_propio = true`; the rule follows the flag, not the name).

`POST /credit-plans/installments/:id/pay` (`creditos.cobrar`) now also enters
cash:

```json
{
  "amount": 55000,
  "paymentDate": "2026-09-29",
  "idempotencyKey": "uuid",
  "accountId": "uuid",
  "paymentMethod": "EFECTIVO",
  "collectedById": "uuid optional",
  "handoverToId": "uuid required for EFECTIVO",
  "reference": "optional; defaults to the ticket number",
  "notes": "optional"
}
```

In one transaction it creates the income `type: "Cuota crédito"` linked to
operation, client, ticket number and installment (`installmentId`), registers
the INGRESO cash movement (with the cash handover circuit for EFECTIVO) and
updates the installment as before. Retrying with the same key returns the
installment. Reversing that cash movement gives the amount back to the
installment (`PARCIAL`/`PENDIENTE`) and reactivates a finished credit.
Installments paid before this version keep no income.

## Operation tracking grid (fase 4)

`GET /sales/operations/tracking` (`ventas.consultar` + `ingresos.consultar`)
accepts every filter of `GET /sales/operations` (`vehicleType` required,
branch scope applies) plus `withBalance=true|false`,
`withPendingCash=true|false` and `withFinancingPending=true|false` (external
financing not reported as paid). Both computed filters scan at most 10,000
operations (`400 FILTER_RESULT_TOO_LARGE` beyond that).

Each item:

```json
{
  "id": "uuid",
  "number": "1048",
  "ticketNumber": "B-0001",
  "operationDate": "2026-09-20T00:00:00.000Z",
  "status": "APROBADA",
  "client": { "id": "uuid", "fullName": "Ana Pérez", "documentType": "DNI", "documentNumber": "12345678" },
  "seller": { "id": "uuid", "fullName": "Vendedor" },
  "branch": { "id": "uuid", "code": "SM", "name": "San Miguel" },
  "vehicle": { "versionName": "Wave 110 S", "condition": "NUEVO", "chassis": null },
  "currency": "ARS",
  "agreedPrice": "2500000",
  "collectedAmount": "1500000",
  "balanceAmount": "1000000",
  "pendingHandoverAmount": "300000",
  "pendingHandoverCount": 2,
  "fulfillment": { "status": "PEDIDA" },
  "licensing": { "mode": "PAGA_CLIENTE", "status": "COBRO_PENDIENTE" },
  "paymentComponents": [
    {
      "id": "uuid",
      "type": "EFECTIVO",
      "expectedAmount": "1500000",
      "collectedAmount": "1500000",
      "balanceAmount": "0",
      "paymentStatus": "PAGADO",
      "collectible": true
    }
  ],
  "incomes": [
    {
      "id": "uuid",
      "incomeDate": "2026-09-20T00:00:00.000Z",
      "type": "Cobro de operación",
      "isLicensing": false,
      "paymentComponentId": "uuid",
      "paymentMethod": "EFECTIVO",
      "totalAmount": "150000",
      "collectedAmount": "150000",
      "paymentStatus": "PAGADO",
      "reference": "B-0001",
      "account": { "id": "uuid", "code": "CAJA", "name": "Caja", "type": "CAJA" },
      "collectedBy": { "id": "uuid", "fullName": "Vendedor" },
      "handover": {
        "status": "PENDIENTE_RENDICION",
        "recipient": { "id": "uuid", "fullName": "Lucas" },
        "confirmedAt": null,
        "confirmedBy": null
      },
      "rowVersion": 0
    }
  ]
}
```

Each row also returns `waivedAmount` and `ownCredit`
(`{ status, financedAmount, totalAmount, collectedAmount, paidInstallments,
installments, nextDueDate } | null`). Components add `collectableAmount`
(cash still collectable), `financialInstitution`, `ownCredit` and
`financingPayment`; incomes add `isOwnCreditInstallment`.

`fulfillment` and `licensing` are the same objects as in the operations list
(fase 3 and patentamiento). `collectedAmount` adds the active INGRESO
movements of the operation incomes **except patent incomes**, which are
charged on top of the agreed price and summarized in `licensing`.
Own-credit installments are also left out of `collectedAmount` (they carry
interest) and are shown in `ownCredit`.
`balanceAmount = agreedPrice - collectedAmount - waivedAmount` (negative
means collected in excess), where `waivedAmount` is what financing
components no longer expect: the part an external financiera kept once it is
marked as paid, and the whole own-credit financing (collected by
installments). `pendingHandoverAmount` is the collected cash still waiting for the
recipient's confirmation.

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

Common filters plus `category`, `accountId`, `recoverable`, `recovered`.
General expenses never accept, query, or return an inventory unit/VIN.

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
  "description": "Informe de dominio",
  "totalAmount": "25000.00",
  "paidBy": "Lucía Fernández",
  "status": "PENDIENTE",
  "recovered": false,
  "month": 8,
  "year": 2026,
  "currency": "ARS",
  "recoverable": true,
  "notes": "optional"
}
```

`reference` is the required TT/reference. New expenses must send
`status=PENDIENTE`; actual `PARCIAL|PAGADO` state is derived only from
append-only cash movements. `month` and `year` are required and must match
`expenseDate`; they are derived again in responses. `paidBy` is the declared
payer text. `recovered=true` is accepted only for a recoverable expense.

### Response

```json
{
  "id": "uuid",
  "expenseDate": "2026-08-29T00:00:00.000Z",
  "month": 8,
  "year": 2026,
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
  "createdBy": { "id": "uuid", "fullName": "Lucía Fernández" },
  "paidBy": "Lucía Fernández",
  "paymentRegisteredBy": { "id": "uuid", "fullName": "Lucía Fernández" },
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
`CLIENT_OPERATION_MISMATCH`, `INVALID_CLIENT`, `INCOME_LINKED_TO_COMPONENT`,
`HANDOVER_RECIPIENT_REQUIRED`, `INVALID_HANDOVER_RECIPIENT`,
`INVALID_COLLECTOR`, `HANDOVER_ONLY_FOR_CASH`, `HANDOVER_ALREADY_CONFIRMED`,
`HANDOVER_NOT_PENDING`, `HANDOVER_NOT_COLLECTED`, `HANDOVER_RECIPIENT_ONLY`,
`VERSION_CONFLICT`, `COMPONENT_NOT_COLLECTIBLE`,
`EDIT_BELOW_SETTLED`, `EXPENSE_NOT_RECOVERABLE`, `RECOVERY_EXISTS`,
`INCOME_REQUIRES_RECONCILIATION`, `IDEMPOTENCY_CONFLICT`,
`ALREADY_REVERSED`, and `UNBALANCED_TRANSFER`.

DTO validation and malformed UUIDs return Nest's standard `400` response.
Missing permissions return `403`.

## Alcance por sucursal

Compras, ingresos, gastos, cuentas, movimientos y transferencias se acotan a las sucursales del usuario. `branchId` es opcional en el alta de compras e ingresos cuando el usuario tiene una sola sucursal. Las cuentas de caja sin sucursal son compartidas por la organización (visibles y usables para pagos/cobranzas, editables sólo con `sucursales.todas`). Nuevo código de error: `403 BRANCH_OUT_OF_SCOPE` y `400 BRANCH_REQUIRED`. Ver [`api-branch-scope.md`](api-branch-scope.md).

# Auditoría

Lectura de todo lo que el sistema registra. La escritura no cambia: cada
mutación HTTP sigue pasando por `@AuditedMutation()` + `AuditService.execute`
(o `record`), que guardan una fila en `registros_auditoria` dentro de la misma
transacción.

Todos los endpoints piden el permiso `auditoria.consultar` y son de sólo
lectura. El seed se lo da sólo al rol ADMINISTRADOR (GERENTE no lo tiene por
ahora; al correr el seed se le quita si lo tenía). La lógica está en `src/audit/audit-query.service.ts`.

## Alcance

- **Organización:** `withTenant` + RLS. Sin `acceso_global` sólo se ven
  eventos cuya organización actora u objetivo es la propia.
- **Sucursal:** la bitácora es de toda la organización (igual que antes), pero
  un usuario sin `sucursales.todas` sólo recibe el detalle (`subject`,
  `metadata`, `previousData`) de los registros de sus sucursales. Los demás
  llegan con `restricted: true`: acción, usuario, fecha y hora, sin detalle.
  Clientes, usuarios, roles, proveedores, planes de crédito, financieras y
  catálogo son de toda la organización y nunca se restringen.
- **Costos de compra:** sin `compras.costos.consultar` el importe de una
  compra llega en `null` y el libro de dinero no devuelve totales.

## `GET /audit-logs`

Bitácora paginada, de lo más nuevo a lo más viejo.

| Parámetro | Descripción |
| --- | --- |
| `page`, `limit` | `limit` máximo 100, por defecto 50. |
| `from`, `to` | Instantes ISO 8601 con zona (`2026-10-04T00:00:00.000-03:00`), sobre `creado_en`, ambos inclusive. |
| `category` | Módulo: `VENTAS`, `DINERO`, `STOCK`, `CLIENTES`, `CREDITOS`, `COMISIONES`, `CATALOGO`, `USUARIOS`, `ACCESOS`, `OTROS`. |
| `action` | Código exacto de la acción (`INCOME_UPDATED`). |
| `actorId` | Usuario que hizo la acción. |
| `entity`, `entityId` | Tabla y registro afectados. |
| `operationNumber` / `operationId` | Eventos de la venta **y** de sus ingresos, gastos, pagos de patente/seguro, crédito propio y cuotas. Una venta inexistente o fuera del alcance devuelve una página vacía. |

Cada ítem:

```json
{
  "id": "…",
  "createdAt": "2026-10-04T15:30:12.000Z",
  "action": "INCOME_UPDATED",
  "actionLabel": "Ingreso modificado",
  "category": "DINERO",
  "categoryLabel": "Dinero y caja",
  "entity": "ingresos",
  "entityId": "…",
  "subject": {
    "title": "Ingreso: SEÑA",
    "detail": "Seña Honda Wave · Juan Pérez · rinde a Lucas",
    "amount": "150000.5",
    "operationId": "…",
    "operationNumber": "120"
  },
  "restricted": false,
  "previousData": { "amount": "120000", "handoverTo": "Nico" },
  "metadata": { "amount": "150000.5", "handoverTo": "Lucas" },
  "ipAddress": "181.45.10.2",
  "actor": { "id": "…", "email": "…", "name": "Carla Caja", "role": "Administrativa" },
  "branch": { "id": "…", "code": "SM", "name": "San Miguel" }
}
```

- `actionLabel` / `category` salen de `src/audit/audit.catalog.ts`. Una acción
  que no esté en el catálogo se lista con su código y en `OTROS`: **al sumar
  una mutación nueva, agregá su acción al catálogo.**
- `subject` se resuelve al leer, con una consulta por tabla y por página. Un
  registro que ya no existe o una tabla no contemplada deja `subject: null`.
- `branch` es la sucursal del usuario, no la del registro.
- `previousData` / `metadata` son `datos_anteriores` / `datos_nuevos`. Hoy
  guardan el antes y el después: la corrección de ventas, el alta y la
  modificación de ingresos (`incomeAuditSnapshot`), la confirmación de
  rendición, usuarios y roles. El resto de los eventos sólo identifica el
  registro.

## `GET /audit-logs/filters`

Opciones para los filtros: `categories`, `actions` (código, nombre, módulo),
`actors` (usuarios de la organización) y `accounts` (cuentas de caja dentro
del alcance de sucursal).

## `GET /audit-logs/operations/:id`

Trazabilidad de una venta. `404` si no existe o está fuera del alcance de
sucursal.

- `operation`: número, boleto, cliente, vehículo, precios, quién la cargó y
  cuándo, última modificación, entrega.
- `approvals`: por cada `aprobaciones_operacion`, quién pidió y cuándo
  (`requestedBy`, `requestedAt`), quién decidió y cuándo (`decidedBy`,
  `decidedAt`), decisión, precios de referencia y motivo.
- `events`: los mismos ítems que la bitácora, en orden cronológico (hasta
  500; `eventsTotal` informa el total).
- `movements`: movimientos de caja de los ingresos y gastos de la venta.

## `GET /audit-logs/money-movements`

Libro de `movimientos_caja`, de lo más nuevo a lo más viejo por la fecha
con la que figura en caja (`date`): la cargada en el ingreso
(`fecha_ingreso`) o el gasto (`fecha_generacion`) al que corresponde, que es
la misma que muestran esas pantallas. Lo que no nace de un ingreso ni de un
gasto (transferencias, retiros, compras, comisiones, ajustes) usa el día de
Argentina de `contabilizado_en`. Respeta el alcance de sucursal igual que `GET /cash/movements`
(cuentas compartidas o de las sucursales del usuario).

| Parámetro | Descripción |
| --- | --- |
| `page`, `limit`, `from`, `to` | Como arriba, pero el rango y el orden son por `date` (ver arriba), no por el momento de carga. Cada ítem trae `date`, `occurredAt` y `createdAt`. |
| `accountId` | Cuenta de caja. |
| `branchId` | Sucursal de la cuenta de caja. |
| `direction` | `CREDITO` (entrada) o `DEBITO` (salida). |
| `type` | `INGRESO`, `EGRESO`, `TRANSFERENCIA_ENTRANTE`, `TRANSFERENCIA_SALIENTE`, `REINTEGRO`, `AJUSTE`. |
| `actorId` | Usuario que registró el movimiento. |
| `operationNumber` | Movimientos de los ingresos y gastos de esa venta. |
| `search` | Referencia, notas, descripción del ingreso, cliente, detalle del gasto o quien registró. |
| `onlyReversals` | `true`: sólo movimientos reversados y sus reversas. |

Cada ítem trae `date` (`YYYY-MM-DD`, la fecha con la que figura en caja),
`createdAt` (fecha y hora de carga), `occurredAt` (`contabilizado_en` del
movimiento), cuenta y sucursal, tipo, sentido, `amount`, `registeredBy`,
`source` (`INCOME`, `EXPENSE`, `PURCHASE`, `COMMISSION`, `TRANSFER`, `OTHER`),
la venta y el cliente, el medio de pago, `handover` (a quién se rinde el
efectivo, estado, quién confirmó y cuándo) y `reversal` (quién lo reversó,
cuándo y con qué nota) o `reversalOfId` si el movimiento es una reversa.

`totals` suma entradas y salidas **vigentes** del filtro (sin lo reversado ni
sus reversas), como strings decimales y **una fila por moneda** de la cuenta
(`[{ currency, credit, debit }]`): pesos y dólares no se suman. Cada
movimiento trae `account.currency`.

`summary` es el resumen para el cierre: una fila por caja con movimientos
vigentes en el filtro (`account`, `branch`, `currency`, `credit`, `debit`,
`pendingHandover` = efectivo cobrado que todavía no confirmó quien lo
recibe), ordenada por sucursal y caja. Es `null` cuando `totals` es `null`.

## Reglas de las cajas

- Un cobro (movimiento con `ingreso_id`) sólo entra a una cuenta **de la
  sucursal del ingreso**: otra sucursal o una cuenta compartida devuelven
  `400 CASH_ACCOUNT_BRANCH_MISMATCH`. Pagos de gastos, compras y comisiones
  siguen aceptando cuentas compartidas.
- Las cuentas históricas importadas (`es_importada`) no reciben movimientos
  nuevos: `400 HISTORIC_CASH_ACCOUNT`. Reversar lo que ya tienen sigue
  permitido.
- La cuenta tiene que ser de la moneda del registro: `400 CURRENCY_MISMATCH`.

Para pasar a una caja activa los cobros que quedaron en una histórica:
`npm run caja:reasignar-historicas -- --actor-email <correo>` (simulación) y
lo mismo con `--apply`. Reversa cada cobro en la histórica y lo vuelve a
registrar en la caja del mismo socio, sucursal y moneda; lo deja en la
auditoría como `INCOME_COLLECTION_REASSIGNED`.

Lo mismo para los pagos (y recuperaciones) de gastos que quedaron en una
histórica: `npm run caja:reasignar-egresos-historicos -- --actor-email <correo>`
(simulación) y con `--apply`. Queda en la auditoría del gasto como
`EXPENSE_PAYMENT_REASSIGNED`. Un gasto general (sin sucursal) sólo se pasa a
una caja compartida del mismo socio; si no hay, lo lista en "NO SE MUEVEN".

En una cuenta compartida, un usuario acotado ve el movimiento pero no la
venta ni el cliente cuando el ingreso o el gasto es de otra sucursal.

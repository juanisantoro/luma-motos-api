# API de inicio / dashboard por rol

Base URL: `/api`. Requiere `Authorization: Bearer <token>`. Endpoint único,
sin `organizationId`: siempre responde sobre la organización (y, cuando
aplica, la sucursal) del actor autenticado.

## Endpoint

`GET /api/dashboard/inicio`

No tiene un permiso único a nivel de controller: sirve a los cinco roles,
cada uno con un set de secciones distinto, y cada sección individual se
calcula sólo si el actor tiene el permiso puntual que le corresponde (nunca
por nombre de rol). Un actor sin ningún permiso relevante igual recibe `200`
con sólo el saludo, en vez de un error.

El campo `role` de la respuesta determina qué forma tiene el resto del
payload:

| `role` | Quién lo recibe | Requisito adicional |
| --- | --- | --- |
| `ADMINISTRADOR` | Rol ADMINISTRADOR | — |
| `GERENTE` | Rol GERENTE | Necesita sucursal asignada; sin sucursal responde sólo el saludo |
| `ADMINISTRATIVA` | Rol ADMINISTRATIVA | Necesita sucursal asignada; sin sucursal responde sólo el saludo |
| `VENDEDOR` | Roles VENDEDOR **y** CALLCENTER | Necesita sucursal asignada; sin sucursal responde sólo el saludo |
| `OTRO` | Cualquier rol personalizado (creado vía el módulo de roles) | Sólo saludo: no hay heurística para adivinar a cuál de las cuatro pantallas debería parecerse |

VENDEDOR y CALLCENTER comparten el mismo `role: "VENDEDOR"` en la respuesta
y el mismo componente en el frontend (`SellerDashboard`).

## Saludo (común a los cinco)

```json
{
  "greeting": {
    "name": "Juan Vendedor",
    "organizationName": "Luma Motos Casa Central",
    "branchName": "San Miguel",
    "date": "2026-08-30"
  }
}
```

`branchName` es `null` para un actor sin sucursal (por ejemplo,
ADMINISTRADOR con acceso a toda la organización).

## Tareas pendientes de administración (`pendingTasks`)

Presente en las respuestas de `ADMINISTRADOR`, `GERENTE` y `ADMINISTRATIVA`.
Es el trabajo pendiente de administración contado sucursal por sucursal:

- `ADMINISTRATIVA`: las sucursales de su alcance (normalmente la suya).
- `GERENTE`: las sucursales que tiene asignadas; todas si tiene
  `sucursales.todas`.
- `ADMINISTRADOR`: todas las sucursales activas de la organización.

```json
{
  "pendingTasks": {
    "branches": [
      {
        "branchId": "uuid",
        "branchName": "San Miguel",
        "total": 23,
        "tasks": [
          { "key": "INSTALLMENTS_OVERDUE", "count": 9, "amount": 1250000 },
          { "key": "INCOMES_PENDING_COLLECTION", "count": 4, "amount": null }
        ]
      }
    ]
  }
}
```

| `key` | Qué cuenta | Permiso |
| --- | --- | --- |
| `INSTALLMENTS_DUE_TODAY` | Cuotas de crédito propio que vencen hoy, sin cobrar (con `amount`). | `creditos.consultar` |
| `INSTALLMENTS_OVERDUE` | Cuotas con vencimiento pasado, `PENDIENTE` o `PARCIAL` (con `amount`). | `creditos.consultar` |
| `INCOMES_PENDING_COLLECTION` | Ingresos `PENDIENTE` o `PAGO_PARCIAL` que no esperan conciliación. | `ingresos.consultar` |
| `CASH_PENDING_HANDOVER` | Ingresos en efectivo con `estado_rendicion = PENDIENTE_RENDICION`. | `ingresos.consultar` |
| `VEHICLE_PAYMENTS_UNCONFIRMED` | Gastos de motos y autos (`pagos_vehiculo`) en `PENDIENTE`, por la sucursal del gasto. | `pagos_vehiculo.consultar` |
| `LICENSING_OVERDUE` | Patentes con la fecha estimada vencida y sin cargar. | `ventas.patentamiento.gestionar` |
| `LICENSING_PENDING_COLLECTION` | Patentes recibidas con el cobro al cliente pendiente. | `ventas.patentamiento.gestionar` |
| `EXPENSES_PENDING_PAYMENT` | Gastos `PENDIENTE`, `PAGO_PARCIAL` o `VENCIDO`. | `gastos.consultar` |

Cada tarea aparece sólo si el actor tiene su permiso (nunca por nombre de
rol); `pendingTasks` es `null` si no tiene ninguno. `amount` sólo viene en las
cuotas, que son siempre en pesos. Cada número sale de la misma consulta que
usa la pantalla donde la tarea se resuelve, acotada a una sucursal
(`BranchScope.only`). Implementación: `src/dashboard/pending-tasks.service.ts`.

## ADMINISTRADOR — toda la organización

Acepta el query opcional `month=current|previous` (por defecto `current`).
Con `previous`, todo lo que es "del mes" pasa al mes anterior: `monthlySales`
(que compara ese mes contra el previo a él), `salesByBranch`, `topModels` y,
dentro de cada sucursal, `monthlySales`, `collection`, `expensesThisMonth`,
`sellers` y `topModels`. Lo que es una foto de hoy no cambia: `pendingTasks`,
`newClientsThisWeek`, stock, cartera de créditos, compras pendientes y
aprobaciones pendientes. Otro valor responde `400`. Los demás roles ignoran
el parámetro y siempre ven el mes en curso.

```json
{
  "role": "ADMINISTRADOR",
  "greeting": { "...": "..." },
  "month": "current",
  "period": "2026-08",
  "monthlySales": {
    "period": "2026-08",
    "currentMonth": { "units": 42, "amount": 105000000 },
    "previousMonth": { "units": 38, "amount": 95000000 }
  },
  "newClientsThisWeek": 12,
  "stockUnitsTotal": 87,
  "creditPortfolio": {
    "financedAmount": 320000000,
    "overdueAmount": 5400000,
    "overdueInstallments": 14
  },
  "pendingPurchases": 3,
  "salesByBranch": [
    { "branchId": "uuid", "branchName": "San Miguel", "units": 25, "amount": 62000000 },
    { "branchId": "uuid", "branchName": "Del Viso", "units": 17, "amount": 43000000 }
  ],
  "topModels": [
    {
      "versionId": "uuid",
      "vehicleType": "MOTO",
      "brand": "Honda",
      "model": "Wave",
      "version": "110cc",
      "units": 8,
      "amount": 20000000
    }
  ],
  "branches": [
    {
      "branchId": "uuid",
      "branchName": "San Miguel",
      "monthlySales": { "...": "misma forma, sólo esta sucursal" },
      "collection": {
        "agreedAmount": 62000000,
        "collectedAmount": 50800000,
        "pendingAmount": 11200000,
        "pendingOperations": 9
      },
      "expensesThisMonth": { "amount": 9800000, "count": 31 },
      "stockUnits": 58,
      "creditPortfolio": { "...": "misma forma, sólo esta sucursal" },
      "pendingApprovals": 3,
      "sellers": [{ "sellerId": "uuid", "sellerName": "Vendedor Demo", "units": 12 }],
      "topModels": [{ "...": "misma forma que topModels, sólo esta sucursal" }]
    }
  ]
}
```

| Campo | Permiso | Notas |
| --- | --- | --- |
| `month`, `period` | — | Mes elegido (`current`/`previous`) y su período `AAAA-MM` |
| `monthlySales`, `salesByBranch`, `topModels` | `ventas.consultar` | `salesByBranch` siempre lista todas las sucursales activas, incluidas las que tuvieron cero ventas en el mes |
| `newClientsThisWeek` | `clientes.consultar` | Ventana rodante de 7 días (hoy incluido), no semana calendario |
| `stockUnitsTotal` | `inventario.consultar` | Suma unidades `EN_STOCK` de MOTO + AUTO |
| `creditPortfolio` | `creditos.consultar` | Cartera de créditos personales de toda la organización |
| `pendingPurchases` | `compras.consultar` | Compras a proveedor pendientes de recepción |
| `branches` | `ventas.consultar` | Una entrada por sucursal activa (las mismas de `salesByBranch`), cada una con sus propios números. Es lo que arma la vista por sucursal del inicio |

Dentro de cada entrada de `branches`, cada dato respeta su permiso y vuelve en
`null` si el rol no lo tiene:

| Campo | Permiso | Notas |
| --- | --- | --- |
| `monthlySales`, `topModels` | `ventas.consultar` | Mes elegido contra el anterior a él; `topModels` trae hasta 5 |
| `collection` | `ventas.consultar` + `ingresos.consultar` | Cobranza de las ventas computables **del mes** de esa sucursal, con las reglas de Seguimiento de cobros: no cuenta patente ni cuotas de crédito propio. `pendingAmount` suma sólo los saldos positivos y `pendingOperations` cuenta esas ventas. Se atribuye por la sucursal de la venta, no por la de la caja |
| `expensesThisMonth` | `gastos.consultar` | Gastos en pesos generados en el mes elegido para esa sucursal. No incluye cancelados, ni los de otra moneda, ni los generales (sin sucursal) |
| `stockUnits` | `inventario.consultar` | Unidades `EN_STOCK` de MOTO + AUTO |
| `creditPortfolio` | `creditos.consultar` | Créditos personales de las ventas de esa sucursal |
| `pendingApprovals` | `ventas.aprobar` | Ventas esperando aprobación, MOTO + AUTO |
| `sellers` | `comisiones.consultar` | Hasta 5 vendedores por unidades computables del mes |

Lo pendiente de administración de cada sucursal (patentes, efectivo sin
rendir, cuotas vencidas) no se repite acá: el inicio lo toma de `pendingTasks`.

Este home **no** incluye comisiones ni caja consolidada, ni "alertas de
gestión": se sacaron a pedido del cliente durante la revisión de los
mockups y se reubicaron (a nivel sucursal) en el home de ADMINISTRATIVA.

## GERENTE — su propia sucursal

```json
{
  "role": "GERENTE",
  "greeting": { "...": "..." },
  "pendingApprovalsCount": 4,
  "monthlySales": { "...": "misma forma que en ADMINISTRADOR, acotado a la sucursal" },
  "ownCommission": { "period": "2026-08", "amount": 350000 },
  "creditOverdue": { "amount": 1200000, "installments": 5 },
  "approvals": [
    {
      "operationId": "uuid",
      "operationNumber": "1048",
      "sellerName": "Vendedor Demo",
      "clientName": "Ana Pérez",
      "listPrice": 2600000,
      "agreedPrice": 2450000,
      "differencePercent": -5.8
    }
  ],
  "teamRanking": [
    { "sellerId": "uuid", "sellerName": "Vendedor Demo", "units": 6, "amount": 180000 }
  ],
  "topModels": [{ "...": "..." }]
}
```

| Campo | Permiso | Notas |
| --- | --- | --- |
| `pendingApprovalsCount`, `approvals` | `ventas.aprobar` | Hasta 10 operaciones pendientes, MOTO + AUTO combinadas |
| `monthlySales`, `topModels` | `ventas.consultar` | |
| `ownCommission`, `teamRanking` | `comisiones.consultar` | |
| `creditOverdue` | `creditos.consultar` | |

`approvals` es el listado resumido que respalda el botón "Ir a
aprobaciones →" del panel: la bandeja completa es
`GET /api/sales/operations/approvals`.

## ADMINISTRATIVA — su propia sucursal

```json
{
  "role": "ADMINISTRATIVA",
  "greeting": { "...": "..." },
  "dueTodayAlert": { "amount": 850000, "clientCount": 6 },
  "dueThisWeek": { "amount": 3100000, "count": 22 },
  "unconfirmedVehiclePayments": { "count": 4, "staleCount": 1 },
  "payableExpensesThisWeek": { "amount": 540000, "count": 7 },
  "collectionsToday": [
    { "id": "uuid", "numero_cuota": 3, "monto": "150000", "monto_pagado": "0", "cliente_nombre": "Ana Pérez" }
  ],
  "recentInquiries": [
    {
      "id": "uuid",
      "clientName": "Ana Pérez",
      "institutionName": "Banco Demo",
      "result": "RECHAZADA",
      "consultedAt": "2026-08-29T15:00:00.000Z"
    }
  ],
  "licensingAlerts": { "overdue": 2, "receivedPendingCollection": 1 },
  "managementAlerts": {
    "overdueInstallments": { "amount": 900000, "count": 3 },
    "staleVehiclePayments": { "count": 1 },
    "zeroStockModels": {
      "items": [
        { "versionId": "uuid", "vehicleType": "MOTO", "brand": "Honda", "model": "Wave", "version": "110cc" }
      ],
      "total": 2
    }
  },
  "topModels": [{ "...": "..." }]
}
```

| Campo | Permiso | Notas |
| --- | --- | --- |
| `dueTodayAlert`, `dueThisWeek` | `creditos.consultar` | `dueThisWeek` es una ventana de 7 días hacia adelante desde hoy |
| `unconfirmedVehiclePayments` | `pagos_vehiculo.consultar` | `staleCount` cuenta los pendientes de más de 5 días |
| `payableExpensesThisWeek` | `gastos.consultar` | |
| `collectionsToday` | `creditos.cobrar` | Hasta 10 cuotas que vencen hoy, ordenadas por monto |
| `recentInquiries` | `consultas_crediticias.consultar` | Últimas 8 consultas crediticias registradas en la sucursal |
| `managementAlerts` | Se arma si el actor tiene al menos uno de `creditos.consultar` / `pagos_vehiculo.consultar` / `inventario.consultar` | Cada sub-campo respeta su propio permiso por separado |
| `managementAlerts.overdueInstallments` | `creditos.consultar` | Cuotas vencidas hace más de 30 días |
| `managementAlerts.zeroStockModels` | `inventario.consultar` | Versiones vendibles con cero unidades `EN_STOCK` en la sucursal |
| `licensingAlerts` | `ventas.patentamiento.gestionar` | Fase 5. `overdue`: patentes que pasaron la fecha estimada sin cargar (mismo filtro que `licensingOverdue=true`). `receivedPendingCollection`: PAGA_CLIENTE con la patente recibida y el cobro al cliente pendiente (`licensingCollectionPending=true`). Ambos sobre las sucursales del actor, MOTO + AUTO |
| `topModels` | `ventas.consultar` | |

**Decidido**: la ADMINISTRATIVA no ve comisiones por ahora. Se descarta la
tarjeta "Comisiones por pagar" de su home y no se le asigna ningún permiso
`comisiones.*`.

## VENDEDOR / CALLCENTER — su propia cartera

```json
{
  "role": "VENDEDOR",
  "greeting": { "...": "..." },
  "attentionCount": 3,
  "monthlySales": { "...": "misma forma que en ADMINISTRADOR, acotado al vendedor" },
  "ownCommission": { "period": "2026-08", "amount": 42000 },
  "clientsThisWeek": 5,
  "myOperations": [
    {
      "operationId": "uuid",
      "operationNumber": "1050",
      "clientName": "Ana Pérez",
      "amount": 2450000,
      "reason": "PENDIENTE_APROBACION"
    },
    {
      "operationId": "uuid",
      "operationNumber": "1041",
      "clientName": "Luis Gómez",
      "amount": 2100000,
      "reason": "RESERVA_POR_VENCER",
      "reservationExpiresAt": "2026-08-31T10:00:00.000Z"
    }
  ],
  "topModels": [{ "...": "..." }],
  "quickLinks": {
    "bcraCheck": "/creditos/consulta-bcra",
    "catalog": "/catalogo/motos",
    "newClient": "/clientes"
  }
}
```

| Campo | Permiso | Notas |
| --- | --- | --- |
| `monthlySales`, `topModels` | `ventas.consultar` | |
| `ownCommission` | `comisiones.propio` | |
| `clientsThisWeek` | `clientes.consultar` | Clientes creados por el propio actor en los últimos 7 días |
| `myOperations`, `attentionCount` | Se arma si `ventas.consultar` permitió resolver el `sellerId` del actor | Hasta 8 operaciones que requieren alguna acción |
| `quickLinks.*` | `creditos.consultar` / `catalogo.consultar` / `clientes.gestionar` respectivamente | Cada link sale `null` si el actor no tiene el permiso correspondiente, en vez de omitir la clave |

`myOperations[].reason` es uno de `RECHAZADA`, `PENDIENTE_APROBACION`,
`LISTA_PARA_FIRMAR` (aprobada, lista para firmar/cerrar) o
`RESERVA_POR_VENCER` (reserva de stock activa que vence en menos de 48hs).
Si una misma operación cae en dos motivos a la vez, la reserva por vencer
tiene prioridad sobre el motivo derivado del estado.

## Frontend

`DashboardPage.tsx` llama a este endpoint y despacha por el campo `role` a
uno de cuatro componentes: `AdminDashboard`, `ManagerDashboard`,
`AdministrativeDashboard` o `SellerDashboard` (este último reutilizado para
VENDEDOR y CALLCENTER). Reemplazó la grilla genérica de accesos a módulos
que existía antes de este home por perfil.

## Alcance por sucursal

Todas las métricas se calculan sobre las sucursales del actor (`user.branchScope`), no sólo sobre `branch`. GERENTE, ADMINISTRATIVA y VENDEDOR/CALLCENTER reciben su pantalla cuando tienen al menos una sucursal en alcance; si en el futuro se les habilitan más sucursales vía `acceso_personal_sucursal`, los KPIs las suman sin cambios. El ranking del equipo (comisiones) sigue consultándose por la sucursal principal. Ver [`api-branch-scope.md`](api-branch-scope.md).

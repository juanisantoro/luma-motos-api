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

## ADMINISTRADOR — toda la organización

```json
{
  "role": "ADMINISTRADOR",
  "greeting": { "...": "..." },
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
  ]
}
```

| Campo | Permiso | Notas |
| --- | --- | --- |
| `monthlySales`, `salesByBranch`, `topModels` | `ventas.consultar` | `salesByBranch` siempre lista todas las sucursales activas, incluidas las que tuvieron cero ventas en el mes |
| `newClientsThisWeek` | `clientes.consultar` | Ventana rodante de 7 días (hoy incluido), no semana calendario |
| `stockUnitsTotal` | `inventario.consultar` | Suma unidades `EN_STOCK` de MOTO + AUTO |
| `creditPortfolio` | `creditos.consultar` | Cartera de créditos personales de toda la organización |
| `pendingPurchases` | `compras.consultar` | Compras a proveedor pendientes de recepción |

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
  "cashBalanceToday": 1240000,
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
| `cashBalanceToday` | `caja.consultar` | Suma de saldos de cuentas de caja activas de la sucursal |
| `unconfirmedVehiclePayments` | `pagos_vehiculo.consultar` | `staleCount` cuenta los pendientes de más de 5 días |
| `payableExpensesThisWeek` | `gastos.consultar` | |
| `collectionsToday` | `creditos.cobrar` | Hasta 10 cuotas que vencen hoy, ordenadas por monto |
| `recentInquiries` | `consultas_crediticias.consultar` | Últimas 8 consultas crediticias registradas en la sucursal |
| `managementAlerts` | Se arma si el actor tiene al menos uno de `creditos.consultar` / `pagos_vehiculo.consultar` / `inventario.consultar` | Cada sub-campo respeta su propio permiso por separado |
| `managementAlerts.overdueInstallments` | `creditos.consultar` | Cuotas vencidas hace más de 30 días |
| `managementAlerts.zeroStockModels` | `inventario.consultar` | Versiones vendibles con cero unidades `EN_STOCK` en la sucursal |
| `topModels` | `ventas.consultar` | |

**Pendiente de decisión**: "Comisiones por pagar" estaba en el mockup
aprobado para este home pero no se implementó — ADMINISTRATIVA no tiene
ningún permiso `comisiones.*` en el seed actual (sólo GERENTE y
ADMINISTRADOR lo tienen). Antes de agregarlo hay que definir con qué
permiso se habilita para este rol.

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

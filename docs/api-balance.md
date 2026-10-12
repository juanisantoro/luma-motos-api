# Balance del mes

`GET /balance` junta en una respuesta lo que ya cargan Ingresos, Gastos
generales, Gastos de motos y autos, Compras y Comisiones, para un mes de
trabajo (de corte a corte, ver `api-work-months.md`). Es sólo lectura.

Permiso: `meses_trabajo.gestionar` (el mismo que mover los cortes; hoy lo
tiene sólo ADMINISTRADOR). No hace falta migración.

## Query

| Parámetro  | Valor                | Por defecto          |
| ---------- | -------------------- | -------------------- |
| `period`   | `AAAA-MM`            | el mes de trabajo en curso |
| `currency` | `ARS` \| `USD`       | `ARS`                |

Pesos y dólares no se suman: cada pedido es de una moneda.

## Qué entra y con qué fecha

| Sección (`section`) | Qué es | Fecha que manda |
| --- | --- | --- |
| `INCOME` | Ingresos (sin transferencias ni anulados). Renglón: el tipo del ingreso. | Regla A: lo que cobra una parte del plan de pago de una venta va al mes de la venta; el resto, por `fecha_ingreso`. Igual que el filtro Corte de Ingresos. |
| `COST_OF_SALES` | Lo que costó cada unidad vendida en el mes (ventas aprobadas o cerradas). Se toma la compra al proveedor de la unidad; si no hay, el costo de la ficha (sólo pesos). | `fecha_operacion` |
| `EXPENSE` | Gastos generales no cancelados, por categoría, menos los de categoría `COMISIONES`. | `fecha_generacion` |
| `COMMISSION` | Gastos de categoría `COMISIONES` (pago de comisiones de vendedores) y comisiones de gerentes pagadas. | `fecha_generacion` / `pagado_en` en hora de Argentina |
| `VEHICLE_EXPENSE` | Gastos de motos y autos (`pagos_vehiculo`), por concepto. | `fecha` |
| `PURCHASE` | Compras a proveedores no canceladas. No entran en el resultado: son stock; se informan aparte. | `fecha_compra` |

## Respuesta

```json
{
  "period": "2026-10",
  "from": "2026-09-28",
  "to": "2026-10-27",
  "current": true,
  "currency": "ARS",
  "branches": [{ "key": "<uuid>", "name": "San Miguel" }, { "key": "GENERAL", "name": "Generales" }],
  "partners": [{ "key": "<personal uuid>", "name": "Juan Capdevila" }, { "key": "OTHER", "name": "Cajas sin socio" }, { "key": "NONE", "name": "Sin caja" }],
  "entries": [
    { "section": "INCOME", "line": "Venta", "branch": "<uuid>", "partner": "<personal uuid>", "amount": 1000000, "paid": true }
  ],
  "sales": {
    "units": 12,
    "unitsWithoutCost": 1,
    "pending": [{ "branch": "<uuid>", "amount": 2000000, "operations": 1 }]
  }
}
```

- `entries` viene desagregado; la pantalla suma por renglón, sucursal o socio.
- `branch`: la sucursal del registro, o `GENERAL` si no tiene. Lo que es
  `GENERAL` (y las comisiones de gerentes) sólo lo ve quien tiene todas las
  sucursales.
- `partner`: el responsable de la caja que cobró o pagó (de los movimientos
  de caja vigentes). `OTHER`: una caja sin responsable. `NONE`: todavía sin
  cobrar o pagar, o pagado sin movimiento de caja (lo importado, el pago de
  comisiones de gerentes). `null` en el costo de lo vendido, que no se
  reparte por caja.
- `paid: false`: lo que falta cobrar o pagar de ese registro.
- `sales.pending`: lo que falta cobrar de las ventas del mes, por sucursal,
  con las reglas de Seguimiento de cobros. Sólo en pesos.
- `sales.unitsWithoutCost`: unidades vendidas sin compra ni costo cargado;
  el costo de lo vendido queda corto por esas.

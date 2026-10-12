# API de meses de trabajo

Base URL: `/api`. Requiere `Authorization: Bearer <token>`.

La organización define cuándo termina cada mes ("corte"). Todo lo que en el
sistema es "del mes" usa esas fechas:

- El inicio de cada rol.
- Comisiones: sugerido, acuerdo, pago y liquidaciones (por las fechas de la
  venta).

En las grillas, los filtros de siempre (`from`/`to`, `month`/`year`, "Mes y
año", "Período") siguen siendo fechas de almanaque. El mes de trabajo es un
filtro aparte, "Corte":

- Ingresos: `period=AAAA-MM`. Lo pactado en el plan de pago de una venta
  (contado, transferencia, tarjeta, financiera, toma) cuenta en el mes de la
  venta aunque se acredite después del corte; lo demás (patente, saldos
  sueltos, cuotas de crédito propio, ingresos sin venta), por su fecha.
- Gastos de motos y autos: `period=AAAA-MM` (no se combina con `month`/`year`
  en el front).
- Historial de comisiones pagadas (`/commissions/history` y
  `/commissions/manager-history`): `period=AAAA-MM`, por la fecha del pago en
  Argentina. No se combina con `paidFrom`/`paidTo` ni con `year`/`month`.
- Gastos, Compras y Ventas: el front manda las fechas del mes de trabajo como
  `from`/`to`.

## Reglas

- Cada mes se identifica con `AAAA-MM` y puede tener un corte (`fecha_corte`).
- El mes va del día siguiente al corte del mes anterior hasta su propio corte.
  Un mes sin corte termina el último día del almanaque, y uno cuyo anterior no
  tiene corte empieza el 1. Sin ningún corte, todo es el mes de almanaque.
- El corte de un mes cae entre el **15 de ese mes y el 14 del siguiente**
  (también lo valida la base, con un CHECK). Así los meses no se pisan ni
  dejan huecos, duran entre 16 y 45 días, y de cualquier rango guardado se
  sabe de qué mes es: el mes de `periodo_hasta − 14 días`.
- Al definir o mover un corte, ningún mes con corte (ese o el siguiente)
  puede quedar con menos de 20 días: casi siempre es una fecha mal tipeada
  (`400`). Un mes sin corte no se controla porque todavía no está definido.
- El mes en curso es el que contiene el día de hoy en Argentina.
- Un corte **no se puede mover** (ni quitar) si hay liquidaciones de
  comisiones, de vendedores o de gerentes, que se crucen con ese mes o con el
  siguiente: responde `409`. Mover el corte de un mes cambia su fin y el
  comienzo del siguiente.
- El cambio de un corte toma un bloqueo exclusivo de la organización; acordar
  una comisión toma el mismo bloqueo compartido. No se puede mover un corte
  mientras se liquida.

Implementación: `src/work-months/`. Tabla `meses_trabajo` (migración
`20261010000000_work_months`), con RLS por organización.

## Endpoints

### `GET /api/work-months`

Sin permiso propio: cualquier usuario autenticado. Query opcional
`organizationId` (sólo con acceso global).

Devuelve el mes en curso y los meses de la pantalla: el siguiente, el actual y
los 12 anteriores (o hasta el mes siguiente al primer corte, si es más viejo),
del más nuevo al más viejo. Todo mes más viejo que la lista es de almanaque.

```json
{
  "current": "2026-10",
  "months": [
    {
      "period": "2026-10",
      "from": "2026-09-28",
      "to": "2026-10-27",
      "cutDate": "2026-10-27",
      "cutMin": "2026-10-15",
      "cutMax": "2026-11-14",
      "current": true,
      "locked": false
    }
  ]
}
```

`cutDate` es `null` si el mes no tiene corte (termina con el almanaque).
`locked` indica que hay comisiones liquidadas de ese mes o del siguiente.

### `PUT /api/work-months/:period`

Permiso `meses_trabajo.gestionar` (rol ADMINISTRADOR). Body:

```json
{ "cutDate": "2026-10-27" }
```

Define o cambia el corte. Responde el mes con sus fechas nuevas. `400` si la
fecha cae fuera del 15 del mes al 14 del siguiente; `409` si hay comisiones
liquidadas. Repetir el mismo corte no cambia nada ni deja registro.

### `DELETE /api/work-months/:period`

Mismo permiso. Quita el corte: el mes vuelve a terminar con el almanaque.
Mismas reglas de `409`.

## Auditoría

`WORK_MONTH_CUT_SET` y `WORK_MONTH_CUT_REMOVED` (módulo Comisiones), con el
período, el corte anterior y el nuevo, y las fechas resultantes del mes.

# API de consulta BCRA (situación crediticia)

Base URL: `/api`. Requiere `Authorization: Bearer <token>`. No acepta
`organizationId`: es una consulta en vivo contra una API pública externa,
sin dato propio del tenant que filtrar.

## Permisos

| Código                  | Alcance                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `creditos.consultar`     | Habilita el endpoint y devuelve siempre `resumen` (el semáforo). Mismo permiso que el resto de créditos personales. |
| `creditos.bcra.detalle`  | Además del resumen, agrega `detalle` con el historial período por período tal como lo entrega el BCRA. Seed actual: GERENTE y ADMINISTRADOR. |

## Consulta

`GET /api/bcra/situacion/:cuit`

`:cuit` se valida y normaliza server-side antes de llamar al BCRA (11 dígitos,
dígito verificador módulo 11 estándar AFIP). Un CUIT/CUIL/CDI inválido nunca
llega a la API externa: responde `400` de inmediato.

Es una consulta **en vivo** contra la API pública "Central de Deudores -
Históricas" del BCRA (`api.bcra.gob.ar`), sin autenticación ni API key.
Timeout de 9s. La respuesta del BCRA (ni siquiera el CUIT consultado, en los
logs de error de red) **nunca se persiste ni se loguea**: es una consulta
distinta cada vez que se pide, no hay caché ni tabla propia.

```json
{
  "resumen": {
    "veredicto": "ROJO",
    "identificacion": "20345678901",
    "denominacion": "Ana Pérez",
    "periodoMasReciente": "202607",
    "peorSituacionActual": 3,
    "procesoJudActual": false,
    "enRevisionActual": false,
    "antecedenteSeveroReciente": true,
    "montoIrregularActual": 45000,
    "montoTotalActual": 620000,
    "porcentajeIrregular": 0.0726,
    "mayorMontoIrregularHistorico": 80000,
    "periodoMayorMontoIrregular": "202605",
    "consultadoEn": "2026-08-30T00:00:00.000Z"
  },
  "detalle": {
    "periodos": [
      {
        "periodo": "202607",
        "entidades": [
          {
            "entidad": "Banco Demo",
            "situacion": 3,
            "monto": 45,
            "enRevision": false,
            "procesoJud": false
          }
        ]
      }
    ]
  }
}
```

`detalle` sólo se incluye si el actor tiene `creditos.bcra.detalle`; si no,
la respuesta trae únicamente `resumen`. Dentro de `detalle`, `monto` viene en
miles de pesos tal como lo entrega el BCRA. Dentro de `resumen`,
`montoIrregularActual`, `montoTotalActual` y `mayorMontoIrregularHistorico`
ya están convertidos a pesos (no a miles).

Si el CUIT no tiene historial en el sistema financiero, el BCRA responde
`404` y esto se traduce en un `200` normal con
`veredicto: "SIN_DATOS"` y el resto de los campos en cero/null — no es un
error, no implica nada negativo sobre la persona.

## Semáforo (`veredicto`)

Heurística pura sobre el período **más reciente** que devuelve el BCRA. Es
una ayuda a la decisión humana, nunca una aprobación/rechazo automático del
crédito.

| Situación BCRA | Significado |
| --- | --- |
| `0` | Sin informar por esa entidad/período (no documentado por el BCRA, pero aparece en la práctica con `monto: 0`; se ignora, nunca cuenta como mala situación). |
| `1` | Normal |
| `2` | Con seguimiento especial |
| `3` | Con problemas |
| `4` | Con alto riesgo de insolvencia |
| `5` | Irrecuperable |

- **ROJO**: la peor situación del período más reciente es 3, 4 o 5, **o**
  alguna entidad de ese período tiene `procesoJud: true` (un proceso
  judicial vigente pesa más que una situación baja).
- **AMARILLO**: la peor situación actual es 2, o el período actual está
  limpio (0/1) pero hubo situación 3+ en algún período de los últimos 24
  meses que devuelve el BCRA (normalizado ahora, pero con antecedente
  reciente).
- **VERDE**: situación actual 0 o 1, sin proceso judicial vigente y sin
  ningún antecedente de situación 3+ en los últimos 24 meses.
- **SIN_DATOS**: el BCRA no tiene historial para ese CUIT.

El veredicto es **deliberadamente agnóstico al monto** — la peor situación
manda, sin importar cuánto sea la deuda. Es el criterio estándar que usan
bancos y fintechs y no se modificó. Lo que sí se agregó (a pedido del
cliente, tras revisar un caso real donde un monto bajo en mora quedaba en
rojo igual que uno alto) es `montoIrregularActual` / `montoTotalActual` /
`porcentajeIrregular`, para que quien evalúa el crédito vea cuánto de la
deuda informada está realmente en problema en vez de quedarse sólo con el
color.

## Errores

- `400`: CUIT/CUIL/CDI inválido (largo o dígito verificador), o el BCRA
  devuelve `400` (no debería ocurrir: se valida antes de llamarlo).
- `401`: sesión ausente o inválida.
- `403`: falta `creditos.consultar`.
- `502`: el BCRA devolvió un error inesperado o una respuesta no legible.
- `504`: el BCRA no respondió dentro de los 9 segundos.

## Frontend

Pantalla dedicada en `/creditos/consulta-bcra` (ítem de menú "Consulta BCRA"
bajo "Créditos personales"). El vendedor escribe el CUIT del cliente (se
enmascara y se valida en el cliente con el mismo dígito verificador antes de
habilitar "Consultar"), ve el semáforo con el monto en mora al lado, y si
tiene el permiso puede expandir el detalle completo período por período. No
hay persistencia en ningún punto del circuito, ni en el backend ni en el
frontend.

# Asistente de ayuda (Lumi)

Responde preguntas de uso del sistema con el manual del rol del usuario y,
cuando hace falta, lee datos del sistema con las consultas de abajo. Nunca
modifica nada.

## Endpoint

`POST /api/assistant/ask` (sesión iniciada, sin permiso propio; 15 preguntas
por minuto).

```json
{
  "question": "¿Dónde cargo la patente?",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

- `question`: 3 a 600 caracteres.
- `history` (opcional): hasta 8 mensajes previos de la misma conversación. No
  se guarda en el servidor; lo manda el front en cada pregunta.

Respuesta `200`:

```json
{ "answer": "1. Andá a Ventas → Operaciones…", "covered": true, "cached": false }
```

`covered=false` cuando el manual no cubre la pregunta (la respuesta empieza con
"No encuentro eso en el manual").

Errores tipados:

| Código | HTTP | Cuándo |
| --- | --- | --- |
| `ASSISTANT_MANUAL_NOT_AVAILABLE` | 404 | El rol del usuario no tiene manual. |
| `ASSISTANT_NOT_CONFIGURED` | 503 | Falta `OPENAI_API_KEY`. |
| `ASSISTANT_UPSTREAM_ERROR` | 502 | OpenAI falló o ningún modelo está disponible. |
| `ASSISTANT_TIMEOUT` | 504 | OpenAI no respondió a tiempo. |

El endpoint lleva `@AuditedMutation()` sólo para pasar `MutationAuditGuard`
(es un POST): no escribe en la base ni pasa por `AuditService`.

## Consultas de datos

Lumi puede leer datos reales con un conjunto fijo de consultas
(`src/assistant/assistant.tools.ts`). El modelo decide cuál pedir; el back la
ejecuta y le devuelve el resultado para que redacte la respuesta.

| Consulta | Servicio que usa | Permisos (los del endpoint) |
| --- | --- | --- |
| `buscar_clientes` | `ClientsService.findAll` | `clientes.consultar` |
| `buscar_operaciones` | `SalesService.findAll` | `ventas.consultar` |
| `seguimiento_cobros` | `SalesService.tracking` | `ventas.consultar` + `ingresos.consultar` |
| `pagos_patentes_seguros` | `VehiclePaymentsService.findAll` | `pagos_vehiculo.consultar` |
| `consultar_stock` | `InventoryService.findAll` | `inventario.consultar` |

Reglas de seguridad (valen para cualquier consulta que se agregue):

1. **Mismo servicio que la pantalla, con el usuario de la sesión.** Sin SQL
   propio. El alcance por sucursal, la restricción del vendedor a sus propias
   ventas y el aislamiento por organización son los de la pantalla, porque es
   el mismo código.
2. **Mismos permisos que el endpoint.** Sin el permiso, la consulta no se le
   ofrece al modelo; si el modelo la pide igual, se rechaza y queda un warning
   en el log.
3. **El modelo no elige de quién son los datos.** No existen parámetros de
   vendedor, sucursal ni organización: sólo texto de búsqueda y filtros de
   estado. Cualquier otro parámetro que mande se descarta.
4. **Sólo lectura, hasta 8 filas, sin totales.** El resultado lleva un
   `hayMasResultados` booleano en lugar de la cantidad. El prompt además le
   prohíbe dar totales, cantidades de ventas, facturación, costos, comisiones
   o comparaciones entre vendedores o sucursales.
5. **Lista blanca de campos.** Al modelo no le llegan ids, precio de lista ni
   mínimo, costos, notas ni proveedor. El documento y el teléfono de un cliente
   sólo salen por `buscar_clientes` (lo mismo que muestra la pantalla Clientes),
   nunca su domicilio ni sus notas.
6. **Sin detalles de errores.** Si el servicio rechaza la consulta, el modelo
   sólo recibe "no se pudo consultar".
7. **Nunca se reusan.** Una respuesta que leyó datos se guarda con
   `uso_datos = true` y queda fuera del reuso de respuestas (además hay un
   CHECK en la base).

Los datos que devuelve una consulta (nombre del cliente, importes, patentes)
se envían a OpenAI para redactar la respuesta, y la respuesta queda guardada
en `consultas_asistente`.

Un perfil sin ninguno de esos permisos no tiene consultas: Lumi le responde
sólo con el manual.

## Manuales

El manual se elige por `role.code` de la sesión (`src/assistant/assistant.manuals.ts`),
nunca por un dato del cliente. `ADMINISTRADOR` no tiene manual propio: recibe los
de todos los perfiles, con la aclaración de que las limitaciones de cada perfil
no le aplican. Un rol clonado o nuevo no tiene asistente hasta registrarlo ahí. Los textos de `src/assistant/manuals/*.manual.ts`
se generan desde los HTML del frontend, que son la fuente de verdad:

```
node scripts/sync-assistant-manuals.mjs ../luma-motos-ui/src/features/manual/content
```

Hay que volver a correrlo cada vez que cambia un manual. Un rol nuevo además se
registra a mano en `assistant.manuals.ts`.

## Configuración

| Variable | Default | Uso |
| --- | --- | --- |
| `OPENAI_API_KEY` | (sin valor) | Key de la API de OpenAI. Sin ella el asistente responde 503 y el resto de la API funciona igual. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Modelo principal. |
| `OPENAI_FALLBACK_MODELS` | `gpt-4.1-mini,gpt-4o` | Se prueban en orden si el principal no existe en la cuenta. |
| `OPENAI_TIMEOUT_MS` | `30000` | Tiempo máximo por llamada. |

## Registro de preguntas y reuso de respuestas

Cada consulta queda en la tabla `consultas_asistente` (migraciones
`20261003010000_assistant_queries` y `20261003020000_assistant_queries_data`,
RLS por organización): pregunta, respuesta,
usuario, sucursal, rol, `cubierta`, modelo y tokens (`tokens_entrada`,
`tokens_entrada_cache`, `tokens_salida`).

Reuso: si llega una pregunta sin conversación previa y ya hay una respuesta
guardada para la misma organización, el mismo rol, la misma `version_manual` y
la misma pregunta normalizada (minúsculas, sin acentos ni signos), se devuelve
esa respuesta sin llamar a OpenAI (`cached: true` en la respuesta del endpoint).
La reutilización también se registra, con `desde_cache = true` y
`consulta_origen_id`.

- `version_manual` es un hash del prompt completo (reglas + manual). Al
  regenerar un manual o cambiar las reglas, las respuestas viejas dejan de
  reusarse solas.
- Una respuesta se reusa hasta 30 días.
- Las repreguntas (con `history`) nunca se reusan: dependen de la conversación.
- El guardado es "best effort": si la tabla no existe o la base falla, el
  asistente responde igual y deja un warning en el log.
- No pasa por `AuditService`: es el registro propio del asistente.

Consultas útiles:

```sql
-- Lo que el manual no cubre
SELECT pregunta, rol_codigo, creado_en FROM consultas_asistente
WHERE cubierta = false ORDER BY creado_en DESC;

-- Preguntas más frecuentes
SELECT pregunta_normalizada, count(*) FROM consultas_asistente
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;

-- Consumo por rol y cuánto se ahorró por reuso
SELECT rol_codigo, count(*) AS consultas,
       count(*) FILTER (WHERE desde_cache) AS reusadas,
       sum(tokens_entrada) AS tokens_entrada, sum(tokens_salida) AS tokens_salida
FROM consultas_asistente GROUP BY 1;
```

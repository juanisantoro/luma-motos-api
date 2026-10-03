# Asistente de ayuda (Lumi)

Responde preguntas de uso del sistema con el manual del rol del usuario. No
consulta ni modifica datos: el modelo recibe sólo el manual y la conversación.

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

Cada consulta queda en la tabla `consultas_asistente` (migración
`20261003010000_assistant_queries`, RLS por organización): pregunta, respuesta,
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

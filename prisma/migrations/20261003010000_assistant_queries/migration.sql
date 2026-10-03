-- Lumi (asistente de ayuda): registro de preguntas y respuestas.
--
-- Cada consulta al asistente queda guardada con su respuesta, si el manual
-- la cubría y los tokens que consumió. Sirve para dos cosas:
--   1. Ver qué se pregunta y qué le falta al manual ("cubierta" = false).
--   2. Reusar la respuesta cuando llega la misma pregunta (normalizada) para
--      el mismo rol y la misma versión del manual, sin volver a llamar a
--      OpenAI. "version_manual" es un hash del prompt completo (reglas +
--      manual): al regenerar un manual cambia y las respuestas viejas dejan
--      de reusarse solas.
--
-- La tabla no lleva relaciones modeladas en Prisma a propósito (mismo
-- criterio que pagos_vehiculo): el service la usa con SQL crudo. Las FK sí
-- se aplican acá, a nivel de base.

CREATE TABLE "consultas_asistente" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "usuario_id" UUID NOT NULL,
  "sucursal_id" UUID,
  "rol_codigo" VARCHAR(60) NOT NULL,
  "version_manual" CHAR(16) NOT NULL,
  "pregunta" TEXT NOT NULL,
  "pregunta_normalizada" VARCHAR(600) NOT NULL,
  "respuesta" TEXT NOT NULL,
  "cubierta" BOOLEAN NOT NULL,
  "con_historial" BOOLEAN NOT NULL DEFAULT false,
  "desde_cache" BOOLEAN NOT NULL DEFAULT false,
  "consulta_origen_id" UUID,
  "modelo" VARCHAR(80),
  "tokens_entrada" INTEGER,
  "tokens_entrada_cache" INTEGER,
  "tokens_salida" INTEGER,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consultas_asistente_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consultas_asistente_cache_con_origen"
    CHECK ("desde_cache" = ("consulta_origen_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "consultas_asistente_id_organizacion_unico"
  ON "consultas_asistente" ("id", "organizacion_id");

CREATE INDEX "consultas_asistente_organizacion_fecha_indice"
  ON "consultas_asistente" ("organizacion_id", "creado_en" DESC);

-- Búsqueda de una respuesta reusable.
CREATE INDEX "consultas_asistente_reuso_indice"
  ON "consultas_asistente" (
    "organizacion_id", "rol_codigo", "version_manual", "pregunta_normalizada"
  );

ALTER TABLE "consultas_asistente"
  ADD CONSTRAINT "consultas_asistente_organizacion_id_fkey"
    FOREIGN KEY ("organizacion_id")
    REFERENCES "organizaciones"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "consulta_asistente_usuario_organizacion_fk"
    FOREIGN KEY ("usuario_id", "organizacion_id")
    REFERENCES "usuarios"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "consulta_asistente_sucursal_organizacion_fk"
    FOREIGN KEY ("sucursal_id", "organizacion_id")
    REFERENCES "sucursales"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "consulta_asistente_origen_organizacion_fk"
    FOREIGN KEY ("consulta_origen_id", "organizacion_id")
    REFERENCES "consultas_asistente"("id", "organizacion_id")
    ON DELETE RESTRICT;

ALTER TABLE "consultas_asistente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consultas_asistente" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_consultas_asistente_organizacion" ON "consultas_asistente";
CREATE POLICY "politica_consultas_asistente_organizacion" ON "consultas_asistente"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

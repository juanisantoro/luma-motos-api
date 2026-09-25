-- Fase 2: casco de regalo y patentamiento en la operación de venta.
--
-- * incluye_casco: el cliente recibe casco de regalo (default false).
-- * modalidad_patentamiento: BONIFICADA (no se le cobra la patente al
--   cliente) o PAGA_CLIENTE. Obligatoria en altas nuevas (validado en la API);
--   queda NULL en operaciones históricas, que se muestran como "sin definir".
-- * importe_patentamiento: importe opcional a cobrar al cliente; solo tiene
--   sentido con PAGA_CLIENTE.
-- * patente_estimada_desde/hasta: ventana informativa de llegada de la patente
--   (10 y 15 días hábiles desde la operación). No bloquea ni genera deuda.
--   Las operaciones históricas no se rellenan para no marcarlas como
--   vencidas en masa.

CREATE TYPE "public"."modalidad_patentamiento_luma" AS ENUM ('BONIFICADA', 'PAGA_CLIENTE');

ALTER TABLE "public"."operaciones"
  ADD COLUMN "incluye_casco" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "modalidad_patentamiento" "public"."modalidad_patentamiento_luma",
  ADD COLUMN "importe_patentamiento" DECIMAL(18, 2),
  ADD COLUMN "patente_estimada_desde" DATE,
  ADD COLUMN "patente_estimada_hasta" DATE;

ALTER TABLE "public"."operaciones"
  ADD CONSTRAINT "operacion_importe_patentamiento_valido" CHECK (
    "importe_patentamiento" IS NULL
    OR (
      "importe_patentamiento" > 0
      AND "modalidad_patentamiento" = 'PAGA_CLIENTE'
    )
  ),
  ADD CONSTRAINT "operacion_patente_estimada_valida" CHECK (
    ("patente_estimada_desde" IS NULL AND "patente_estimada_hasta" IS NULL)
    OR (
      "patente_estimada_desde" IS NOT NULL
      AND "patente_estimada_hasta" IS NOT NULL
      AND "patente_estimada_desde" <= "patente_estimada_hasta"
    )
  );

CREATE INDEX "operaciones_modalidad_patentamiento_indice"
  ON "public"."operaciones" ("organizacion_id", "modalidad_patentamiento");

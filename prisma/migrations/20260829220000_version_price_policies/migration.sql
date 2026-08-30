ALTER TABLE "public"."politicas_precios_vehiculos"
  ADD COLUMN "activa" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "desactivada_en" TIMESTAMPTZ(6);

ALTER TABLE "public"."politicas_precios_vehiculos"
  ADD CONSTRAINT "politicas_precios_vigencia_valida_check"
  CHECK ("vigente_hasta" IS NULL OR "vigente_hasta" >= "vigente_desde");

CREATE INDEX "politicas_precios_efectiva_indice"
  ON "public"."politicas_precios_vehiculos"
  ("organizacion_id", "version_id", "sucursal_id", "activa", "vigente_desde" DESC);

CREATE UNIQUE INDEX "reservas_stock_unidad_activa_unica"
  ON "public"."reservas_stock" ("organizacion_id", "unidad_vehiculo_id")
  WHERE "estado" = 'ACTIVO' AND "unidad_vehiculo_id" IS NOT NULL;

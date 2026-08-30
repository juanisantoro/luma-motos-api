DROP INDEX IF EXISTS "public"."politicas_precios_organizacion_vigente_unico";

CREATE UNIQUE INDEX "politicas_precios_organizacion_vigente_unico"
  ON "public"."politicas_precios_vehiculos"
  (
    "organizacion_id",
    "version_id",
    COALESCE("sucursal_id", '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE "vigente_hasta" IS NULL AND "activa" = true;

ALTER TABLE "public"."politicas_precios_vehiculos"
  DROP CONSTRAINT IF EXISTS "politica_precio_rango_valido";

ALTER TABLE "public"."politicas_precios_vehiculos"
  ADD CONSTRAINT "politica_precio_rango_valido"
  CHECK ("vigente_hasta" IS NULL OR "vigente_hasta" >= "vigente_desde");

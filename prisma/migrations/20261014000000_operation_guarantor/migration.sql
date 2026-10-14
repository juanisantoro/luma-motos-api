-- Garante de la operación. Cuando alguna parte se paga con crédito, la venta
-- indica si tiene un garante propio (nombre, apellido y DNI obligatorios) o si
-- el garante es el mismo cliente (se copian sus datos al cargarla).
-- Reemplaza el texto libre "respaldo_garante", que queda sólo como dato
-- histórico de las operaciones viejas. Las operaciones con crédito ya cargadas
-- quedan sin garante (tiene_garante NULL) hasta que alguien las edite.
ALTER TABLE "public"."operaciones"
  ADD COLUMN "tiene_garante" BOOLEAN,
  ADD COLUMN "garante_nombre" VARCHAR(120),
  ADD COLUMN "garante_apellido" VARCHAR(120),
  ADD COLUMN "garante_documento" VARCHAR(30),
  ADD COLUMN "garante_busqueda" VARCHAR(400);

-- Con garante propio, los tres datos son obligatorios.
ALTER TABLE "public"."operaciones"
  ADD CONSTRAINT "operacion_garante_completo" CHECK (
    "tiene_garante" IS DISTINCT FROM TRUE
    OR (
      NULLIF(BTRIM("garante_nombre"), '') IS NOT NULL
      AND NULLIF(BTRIM("garante_apellido"), '') IS NOT NULL
      AND NULLIF(BTRIM("garante_documento"), '') IS NOT NULL
    )
  );

-- Texto normalizado (apellido, nombre y DNI sin puntos) para buscar por
-- garante desde todos los buscadores y desde Lumi.
CREATE INDEX "operaciones_garante_busqueda_trgm_indice"
  ON "public"."operaciones" USING GIN ("garante_busqueda" gin_trgm_ops);

-- Prevent duplicate document identities inside one organization while allowing
-- clients without a document.
CREATE UNIQUE INDEX "clientes_organizacion_tipo_documento_unico"
ON "public"."clientes" (
  "organizacion_id",
  "tipo_documento",
  "documento_normalizado"
)
WHERE "documento_normalizado" IS NOT NULL;

CREATE INDEX "clientes_organizacion_estado_creado_indice"
ON "public"."clientes" ("organizacion_id", "activo", "creado_en" DESC);

-- Scope financial institutions to organizations and complete the credit inquiry
-- history with branch attribution and request idempotency.

ALTER TABLE "public"."financieras"
  ADD COLUMN "organizacion_id" UUID,
  ADD COLUMN "identificacion_fiscal_normalizada" VARCHAR(30);

DROP INDEX IF EXISTS "public"."financieras_nombre_normalizado_unico";
DROP INDEX IF EXISTS "public"."financieras_identificacion_fiscal_unico";

CREATE TEMPORARY TABLE "financieras_organizaciones_mapa" (
  "financiera_original_id" UUID NOT NULL,
  "organizacion_id" UUID NOT NULL,
  "financiera_destino_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  PRIMARY KEY ("financiera_original_id", "organizacion_id")
) ON COMMIT DROP;

INSERT INTO "financieras_organizaciones_mapa" (
  "financiera_original_id",
  "organizacion_id"
)
SELECT "financiera_id", "organizacion_id"
FROM "public"."consultas_crediticias"
UNION
SELECT "financiera_id", "organizacion_id"
FROM "public"."componentes_pago_operacion"
WHERE "financiera_id" IS NOT NULL;

INSERT INTO "financieras_organizaciones_mapa" (
  "financiera_original_id",
  "organizacion_id"
)
SELECT financiera."id", organizacion."id"
FROM "public"."financieras" AS financiera
JOIN "public"."organizaciones" AS organizacion
  ON organizacion."codigo" = 'LUMA_CENTRAL'
WHERE NOT EXISTS (
  SELECT 1
  FROM "financieras_organizaciones_mapa" AS mapa
  WHERE mapa."financiera_original_id" = financiera."id"
);

WITH destinos_originales AS (
  SELECT
    mapa."financiera_original_id",
    mapa."organizacion_id",
    row_number() OVER (
      PARTITION BY mapa."financiera_original_id"
      ORDER BY mapa."organizacion_id"
    ) AS orden
  FROM "financieras_organizaciones_mapa" AS mapa
)
UPDATE "financieras_organizaciones_mapa" AS mapa
SET "financiera_destino_id" = mapa."financiera_original_id"
FROM destinos_originales AS destino
WHERE destino."financiera_original_id" = mapa."financiera_original_id"
  AND destino."organizacion_id" = mapa."organizacion_id"
  AND destino.orden = 1;

UPDATE "public"."financieras" AS financiera
SET
  "organizacion_id" = mapa."organizacion_id",
  "identificacion_fiscal_normalizada" = NULLIF(
    regexp_replace(upper(financiera."identificacion_fiscal"), '[^A-Z0-9]', '', 'g'),
    ''
  )
FROM "financieras_organizaciones_mapa" AS mapa
WHERE mapa."financiera_original_id" = financiera."id"
  AND mapa."financiera_destino_id" = financiera."id";

INSERT INTO "public"."financieras" (
  "id",
  "razon_social",
  "nombre_normalizado",
  "identificacion_fiscal",
  "identificacion_fiscal_normalizada",
  "datos_contacto",
  "activo",
  "creado_en",
  "actualizado_en",
  "organizacion_id"
)
SELECT
  mapa."financiera_destino_id",
  financiera."razon_social",
  financiera."nombre_normalizado",
  financiera."identificacion_fiscal",
  NULLIF(
    regexp_replace(upper(financiera."identificacion_fiscal"), '[^A-Z0-9]', '', 'g'),
    ''
  ),
  financiera."datos_contacto",
  financiera."activo",
  financiera."creado_en",
  financiera."actualizado_en",
  mapa."organizacion_id"
FROM "financieras_organizaciones_mapa" AS mapa
JOIN "public"."financieras" AS financiera
  ON financiera."id" = mapa."financiera_original_id"
WHERE mapa."financiera_destino_id" <> mapa."financiera_original_id";

UPDATE "public"."consultas_crediticias" AS consulta
SET "financiera_id" = mapa."financiera_destino_id"
FROM "financieras_organizaciones_mapa" AS mapa
WHERE mapa."financiera_original_id" = consulta."financiera_id"
  AND mapa."organizacion_id" = consulta."organizacion_id";

UPDATE "public"."componentes_pago_operacion" AS componente
SET "financiera_id" = mapa."financiera_destino_id"
FROM "financieras_organizaciones_mapa" AS mapa
WHERE mapa."financiera_original_id" = componente."financiera_id"
  AND mapa."organizacion_id" = componente."organizacion_id";

ALTER TABLE "public"."financieras"
  ALTER COLUMN "organizacion_id" SET NOT NULL;

CREATE UNIQUE INDEX "financieras_id_organizacion_unico"
  ON "public"."financieras" ("id", "organizacion_id");

CREATE UNIQUE INDEX "financieras_organizacion_nombre_unico"
  ON "public"."financieras" ("organizacion_id", "nombre_normalizado");

CREATE UNIQUE INDEX "financieras_organizacion_identificacion_fiscal_unico"
  ON "public"."financieras" (
    "organizacion_id",
    "identificacion_fiscal_normalizada"
  )
  WHERE "identificacion_fiscal_normalizada" IS NOT NULL;

CREATE INDEX "financieras_organizacion_estado_nombre_indice"
  ON "public"."financieras" ("organizacion_id", "activo", "razon_social");

ALTER TABLE "public"."financieras"
  ADD CONSTRAINT "financieras_organizacion_fk"
  FOREIGN KEY ("organizacion_id")
  REFERENCES "public"."organizaciones" ("id")
  ON DELETE RESTRICT
  ON UPDATE NO ACTION;

ALTER TABLE "public"."consultas_crediticias"
  ADD COLUMN "sucursal_id" UUID,
  ADD COLUMN "clave_idempotencia" VARCHAR(120),
  ADD COLUMN "huella_idempotencia" CHAR(64);

UPDATE "public"."consultas_crediticias" AS consulta
SET
  "sucursal_id" = COALESCE(
    (
      SELECT operacion."sucursal_id"
      FROM "public"."operaciones" AS operacion
      WHERE operacion."id" = consulta."operacion_id"
        AND operacion."organizacion_id" = consulta."organizacion_id"
    ),
    (
      SELECT personal."sucursal_principal_id"
      FROM "public"."personal" AS personal
      WHERE personal."id" = consulta."consultado_por_personal_id"
        AND personal."organizacion_id" = consulta."organizacion_id"
    ),
    (
      SELECT sucursal."id"
      FROM "public"."sucursales" AS sucursal
      WHERE sucursal."organizacion_id" = consulta."organizacion_id"
        AND sucursal."activa" = true
      ORDER BY sucursal."creado_en", sucursal."id"
      LIMIT 1
    )
  ),
  "clave_idempotencia" = 'legacy:' || consulta."id"::text,
  "huella_idempotencia" =
    md5(consulta."id"::text) || md5(consulta."id"::text || ':legacy');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "public"."consultas_crediticias"
    WHERE "sucursal_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill credit inquiry branches: an organization has no active branch';
  END IF;
END
$$;

ALTER TABLE "public"."consultas_crediticias"
  ALTER COLUMN "sucursal_id" SET NOT NULL,
  ALTER COLUMN "clave_idempotencia" SET NOT NULL,
  ALTER COLUMN "huella_idempotencia" SET NOT NULL;

ALTER TABLE "public"."consultas_crediticias"
  DROP CONSTRAINT "consultas_crediticias_financiera_id_fkey";

ALTER TABLE "public"."componentes_pago_operacion"
  DROP CONSTRAINT "componentes_pago_operacion_financiera_id_fkey";

ALTER TABLE "public"."consultas_crediticias"
  ADD CONSTRAINT "consulta_financiera_organizacion_fk"
  FOREIGN KEY ("financiera_id", "organizacion_id")
  REFERENCES "public"."financieras" ("id", "organizacion_id")
  ON DELETE NO ACTION
  ON UPDATE NO ACTION,
  ADD CONSTRAINT "consulta_sucursal_organizacion_fk"
  FOREIGN KEY ("sucursal_id", "organizacion_id")
  REFERENCES "public"."sucursales" ("id", "organizacion_id")
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;

ALTER TABLE "public"."componentes_pago_operacion"
  ADD CONSTRAINT "componente_financiera_organizacion_fk"
  FOREIGN KEY ("financiera_id", "organizacion_id")
  REFERENCES "public"."financieras" ("id", "organizacion_id")
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;

CREATE UNIQUE INDEX "consultas_crediticias_organizacion_idempotencia_unico"
  ON "public"."consultas_crediticias" (
    "organizacion_id",
    "clave_idempotencia"
  );

CREATE INDEX "consultas_crediticias_organizacion_resultado_fecha_indice"
  ON "public"."consultas_crediticias" (
    "organizacion_id",
    "resultado",
    "consultado_en" DESC
  );

CREATE INDEX "consultas_crediticias_sucursal_fecha_indice"
  ON "public"."consultas_crediticias" ("sucursal_id", "consultado_en" DESC);

ALTER TABLE "public"."financieras" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."financieras" FORCE ROW LEVEL SECURITY;

CREATE POLICY "politica_financieras_organizacion"
  ON "public"."financieras"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (luma_tiene_acceso_organizacion("organizacion_id"))
  WITH CHECK (luma_tiene_acceso_organizacion("organizacion_id"));

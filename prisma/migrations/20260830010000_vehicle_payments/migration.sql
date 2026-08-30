-- Catálogos administrables para el nuevo módulo de pagos de documentación
-- de vehículos (patentes, seguros, formularios).

CREATE TABLE "conceptos_pago_vehiculo" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nombre" VARCHAR(120) NOT NULL,
  "nombre_normalizado" VARCHAR(120) NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conceptos_pago_vehiculo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conceptos_pago_vehiculo_nombre_normalizado_key"
  ON "conceptos_pago_vehiculo" ("nombre_normalizado");

INSERT INTO "conceptos_pago_vehiculo" ("nombre", "nombre_normalizado") VALUES
  ('Patente', 'patente'),
  ('Seguro', 'seguro'),
  ('Formulario', 'formulario')
ON CONFLICT ("nombre_normalizado") DO NOTHING;

CREATE TABLE "beneficiarios_pago_vehiculo" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nombre" VARCHAR(160) NOT NULL,
  "nombre_normalizado" VARCHAR(160) NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "beneficiarios_pago_vehiculo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "beneficiarios_pago_vehiculo_nombre_normalizado_key"
  ON "beneficiarios_pago_vehiculo" ("nombre_normalizado");

INSERT INTO "beneficiarios_pago_vehiculo" ("nombre", "nombre_normalizado") VALUES
  ('Carolina', 'carolina')
ON CONFLICT ("nombre_normalizado") DO NOTHING;

-- Tabla principal. No lleva relaciones modeladas en Prisma a propósito
-- (ver comentario en schema.prisma): el service la consulta con SQL crudo
-- para no depender de un Prisma Client regenerado. Las FK sí se aplican acá,
-- a nivel de base.

CREATE TABLE "pagos_vehiculo" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "concepto_id" UUID NOT NULL,
  "unidad_vehiculo_id" UUID NOT NULL,
  "operacion_id" UUID,
  "beneficiario_id" UUID NOT NULL,
  "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  "fecha" DATE NOT NULL,
  "observaciones" TEXT,
  "creado_por_personal_id" UUID NOT NULL,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pagos_vehiculo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pagos_vehiculo_estado_valido"
    CHECK ("estado" IN ('PENDIENTE', 'PAGADO'))
);

CREATE UNIQUE INDEX "pagos_vehiculo_id_organizacion_unico"
  ON "pagos_vehiculo" ("id", "organizacion_id");

CREATE INDEX "pagos_vehiculo_organizacion_fecha_indice"
  ON "pagos_vehiculo" ("organizacion_id", "fecha" DESC);

ALTER TABLE "pagos_vehiculo"
  ADD CONSTRAINT "pagos_vehiculo_organizacion_id_fkey"
    FOREIGN KEY ("organizacion_id")
    REFERENCES "organizaciones"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "pagos_vehiculo_concepto_id_fkey"
    FOREIGN KEY ("concepto_id")
    REFERENCES "conceptos_pago_vehiculo"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "pagos_vehiculo_beneficiario_id_fkey"
    FOREIGN KEY ("beneficiario_id")
    REFERENCES "beneficiarios_pago_vehiculo"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "pago_vehiculo_unidad_organizacion_fk"
    FOREIGN KEY ("unidad_vehiculo_id", "organizacion_id")
    REFERENCES "unidades_vehiculos"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "pago_vehiculo_operacion_organizacion_fk"
    FOREIGN KEY ("operacion_id", "organizacion_id")
    REFERENCES "operaciones"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "pago_vehiculo_creador_organizacion_fk"
    FOREIGN KEY ("creado_por_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id")
    ON DELETE RESTRICT;

ALTER TABLE "pagos_vehiculo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pagos_vehiculo" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_pagos_vehiculo_organizacion" ON "pagos_vehiculo";
CREATE POLICY "politica_pagos_vehiculo_organizacion" ON "pagos_vehiculo"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

DROP TRIGGER IF EXISTS "disparador_pagos_vehiculo_actualizado_en" ON "pagos_vehiculo";
CREATE TRIGGER "disparador_pagos_vehiculo_actualizado_en"
BEFORE UPDATE ON "pagos_vehiculo"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

DROP TRIGGER IF EXISTS "disparador_conceptos_pago_vehiculo_actualizado_en" ON "conceptos_pago_vehiculo";
CREATE TRIGGER "disparador_conceptos_pago_vehiculo_actualizado_en"
BEFORE UPDATE ON "conceptos_pago_vehiculo"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

DROP TRIGGER IF EXISTS "disparador_beneficiarios_pago_vehiculo_actualizado_en" ON "beneficiarios_pago_vehiculo";
CREATE TRIGGER "disparador_beneficiarios_pago_vehiculo_actualizado_en"
BEFORE UPDATE ON "beneficiarios_pago_vehiculo"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

DROP TRIGGER IF EXISTS "disparador_tipos_ingreso_actualizado_en" ON "tipos_ingreso";
CREATE TRIGGER "disparador_tipos_ingreso_actualizado_en"
BEFORE UPDATE ON "tipos_ingreso"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

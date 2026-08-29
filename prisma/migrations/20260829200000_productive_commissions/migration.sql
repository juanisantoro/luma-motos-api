CREATE TYPE "estado_politica_comision_luma" AS ENUM (
  'BORRADOR',
  'ACTIVA',
  'INACTIVA'
);

CREATE TYPE "estado_liquidacion_comision_luma" AS ENUM (
  'CALCULADA',
  'ACORDADA',
  'PENDIENTE_PAGO',
  'PAGADA'
);

CREATE TABLE "politicas_comisiones" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "tipo_vehiculo" "tipo_vehiculo_luma" NOT NULL,
  "moneda" CHAR(3) NOT NULL DEFAULT 'ARS',
  "vigente_desde" DATE NOT NULL,
  "vigente_hasta" DATE,
  "estado" "estado_politica_comision_luma" NOT NULL DEFAULT 'BORRADOR',
  "version_fila" INTEGER NOT NULL DEFAULT 0,
  "creado_por_personal_id" UUID NOT NULL,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "politicas_comisiones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "politicas_comisiones_vigencia_valida"
    CHECK ("vigente_hasta" IS NULL OR "vigente_hasta" >= "vigente_desde"),
  CONSTRAINT "politicas_comisiones_moneda_valida"
    CHECK ("moneda" ~ '^[A-Z]{3}$'),
  CONSTRAINT "politicas_comisiones_version_valida"
    CHECK ("version_fila" >= 0)
);

CREATE UNIQUE INDEX "politicas_comisiones_id_organizacion_unico"
  ON "politicas_comisiones" ("id", "organizacion_id");

CREATE INDEX "politicas_comisiones_tipo_vigencia_indice"
  ON "politicas_comisiones"
  ("organizacion_id", "tipo_vehiculo", "estado", "vigente_desde" DESC);

ALTER TABLE "politicas_comisiones"
  ADD CONSTRAINT "politicas_comisiones_organizacion_id_fkey"
    FOREIGN KEY ("organizacion_id")
    REFERENCES "organizaciones"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "politicas_comisiones_creador_organizacion_fk"
    FOREIGN KEY ("creado_por_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id")
    ON DELETE RESTRICT;

CREATE TABLE "escalas_comisiones" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "politica_id" UUID NOT NULL,
  "organizacion_id" UUID NOT NULL,
  "minimo_ventas" INTEGER NOT NULL,
  "maximo_ventas" INTEGER,
  "importe_fijo" DECIMAL(18,2) NOT NULL,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "escalas_comisiones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "escalas_comisiones_rango_valido"
    CHECK (
      "minimo_ventas" >= 1
      AND ("maximo_ventas" IS NULL OR "maximo_ventas" >= "minimo_ventas")
    ),
  CONSTRAINT "escalas_comisiones_importe_valido"
    CHECK ("importe_fijo" >= 0)
);

CREATE UNIQUE INDEX "escalas_comisiones_id_organizacion_unico"
  ON "escalas_comisiones" ("id", "organizacion_id");

CREATE UNIQUE INDEX "escalas_comisiones_politica_minimo_unico"
  ON "escalas_comisiones" ("politica_id", "minimo_ventas");

CREATE INDEX "escalas_comisiones_politica_orden_indice"
  ON "escalas_comisiones" ("politica_id", "minimo_ventas");

ALTER TABLE "escalas_comisiones"
  ADD CONSTRAINT "escalas_comisiones_politica_organizacion_fk"
    FOREIGN KEY ("politica_id", "organizacion_id")
    REFERENCES "politicas_comisiones"("id", "organizacion_id")
    ON DELETE CASCADE,
  ADD CONSTRAINT "escalas_comisiones_organizacion_id_fkey"
    FOREIGN KEY ("organizacion_id")
    REFERENCES "organizaciones"("id")
    ON DELETE RESTRICT;

ALTER TABLE "liquidaciones_comisiones"
  ADD COLUMN "tipo_vehiculo" "tipo_vehiculo_luma" NOT NULL DEFAULT 'MOTO',
  ADD COLUMN "politica_comision_id" UUID,
  ADD COLUMN "estado" "estado_liquidacion_comision_luma" NOT NULL DEFAULT 'CALCULADA',
  ADD COLUMN "moneda" CHAR(3) NOT NULL DEFAULT 'ARS',
  ADD COLUMN "politica_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "escala_snapshot" JSONB,
  ADD COLUMN "operaciones_snapshot" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "fecha_reunion" DATE,
  ADD COLUMN "version_fila" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pagado_en" TIMESTAMPTZ(6),
  ADD COLUMN "pagado_por_personal_id" UUID,
  ADD COLUMN "gasto_id" UUID,
  ADD COLUMN "movimiento_caja_id" UUID,
  ADD COLUMN "cuenta_caja_id" UUID,
  ADD COLUMN "referencia_pago" VARCHAR(160),
  ADD COLUMN "comprobante_pago" VARCHAR(240),
  ADD COLUMN "observaciones_pago" TEXT,
  ADD COLUMN "clave_idempotencia_pago" VARCHAR(100),
  ADD COLUMN "hash_idempotencia_pago" CHAR(64),
  ADD COLUMN "pago_legacy" BOOLEAN NOT NULL DEFAULT false;

UPDATE "liquidaciones_comisiones"
SET "estado" = CASE
  WHEN "estado_pago" = 'PAGADO' THEN 'PAGADA'::"estado_liquidacion_comision_luma"
  WHEN "importe_acordado" IS NOT NULL THEN 'ACORDADA'::"estado_liquidacion_comision_luma"
  ELSE 'CALCULADA'::"estado_liquidacion_comision_luma"
END,
"pago_legacy" = ("estado_pago" = 'PAGADO');

ALTER TABLE "liquidaciones_comisiones"
  DROP CONSTRAINT IF EXISTS
    "liquidaciones_comisiones_personal_id_sucursal_id_periodo_de_key";

CREATE UNIQUE INDEX "liquidaciones_comisiones_periodo_tipo_unico"
  ON "liquidaciones_comisiones"
  ("organizacion_id", "personal_id", "periodo_desde", "periodo_hasta", "tipo_vehiculo");

CREATE UNIQUE INDEX "liquidaciones_comisiones_pago_idempotencia_unico"
  ON "liquidaciones_comisiones" ("organizacion_id", "clave_idempotencia_pago");

CREATE INDEX "liquidaciones_comisiones_estado_tipo_periodo_indice"
  ON "liquidaciones_comisiones"
  ("organizacion_id", "estado", "tipo_vehiculo", "periodo_desde" DESC);

ALTER TABLE "liquidaciones_comisiones"
  ADD CONSTRAINT "liquidaciones_comisiones_politica_organizacion_fk"
    FOREIGN KEY ("politica_comision_id", "organizacion_id")
    REFERENCES "politicas_comisiones"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "liquidaciones_comisiones_pagador_organizacion_fk"
    FOREIGN KEY ("pagado_por_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "liquidaciones_comisiones_gasto_organizacion_fk"
    FOREIGN KEY ("gasto_id", "organizacion_id")
    REFERENCES "gastos"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "liquidaciones_comisiones_movimiento_organizacion_fk"
    FOREIGN KEY ("movimiento_caja_id", "organizacion_id")
    REFERENCES "movimientos_caja"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "liquidaciones_comisiones_cuenta_organizacion_fk"
    FOREIGN KEY ("cuenta_caja_id", "organizacion_id")
    REFERENCES "cuentas_caja"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "liquidaciones_comisiones_snapshot_valido"
    CHECK (
      jsonb_typeof("politica_snapshot") = 'object'
      AND ("escala_snapshot" IS NULL OR jsonb_typeof("escala_snapshot") = 'object')
      AND jsonb_typeof("operaciones_snapshot") = 'array'
    ),
  ADD CONSTRAINT "liquidaciones_comisiones_version_valida"
    CHECK ("version_fila" >= 0),
  ADD CONSTRAINT "liquidaciones_comisiones_pago_completo"
    CHECK (
      (
        "estado" <> 'PAGADA'
        AND NOT "pago_legacy"
        AND "pagado_en" IS NULL
        AND "pagado_por_personal_id" IS NULL
        AND "gasto_id" IS NULL
        AND "movimiento_caja_id" IS NULL
        AND "cuenta_caja_id" IS NULL
        AND "clave_idempotencia_pago" IS NULL
        AND "hash_idempotencia_pago" IS NULL
      )
      OR
      (
        "estado" = 'PAGADA'
        AND NOT "pago_legacy"
        AND "pagado_en" IS NOT NULL
        AND "pagado_por_personal_id" IS NOT NULL
        AND "gasto_id" IS NOT NULL
        AND "movimiento_caja_id" IS NOT NULL
        AND "cuenta_caja_id" IS NOT NULL
        AND "clave_idempotencia_pago" IS NOT NULL
        AND "hash_idempotencia_pago" IS NOT NULL
      )
      OR
      (
        "estado" = 'PAGADA'
        AND "pago_legacy"
        AND "estado_pago" = 'PAGADO'
        AND "pagado_en" IS NULL
        AND "pagado_por_personal_id" IS NULL
        AND "gasto_id" IS NULL
        AND "movimiento_caja_id" IS NULL
        AND "cuenta_caja_id" IS NULL
        AND "clave_idempotencia_pago" IS NULL
        AND "hash_idempotencia_pago" IS NULL
      )
    );

CREATE OR REPLACE FUNCTION "luma_validar_escalas_comision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  politica UUID := COALESCE(NEW.politica_id, OLD.politica_id);
  primera INTEGER;
  abiertas INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "politicas_comisiones" WHERE "id" = politica
  ) THEN
    RETURN NULL;
  END IF;

  SELECT MIN("minimo_ventas"), COUNT(*) FILTER (WHERE "maximo_ventas" IS NULL)
  INTO primera, abiertas
  FROM "escalas_comisiones"
  WHERE "politica_id" = politica;

  IF primera IS NULL OR primera <> 1 OR abiertas <> 1 THEN
    RAISE EXCEPTION
      'Las escalas deben comenzar en 1 y terminar con un único tramo abierto'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        "minimo_ventas",
        LAG("maximo_ventas") OVER (ORDER BY "minimo_ventas") AS anterior_maximo,
        ROW_NUMBER() OVER (ORDER BY "minimo_ventas") AS posicion
      FROM "escalas_comisiones"
      WHERE "politica_id" = politica
    ) rangos
    WHERE posicion > 1
      AND (
        anterior_maximo IS NULL
        OR "minimo_ventas" <> anterior_maximo + 1
      )
  ) THEN
    RAISE EXCEPTION
      'Las escalas de comisión no pueden tener huecos ni solapamientos'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "disparador_validar_escalas_comision"
AFTER INSERT OR UPDATE OR DELETE ON "escalas_comisiones"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "luma_validar_escalas_comision"();

CREATE OR REPLACE FUNCTION "luma_validar_vigencia_politica_comision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = 'ACTIVA' AND EXISTS (
    SELECT 1
    FROM "politicas_comisiones" existente
    WHERE existente.id <> NEW.id
      AND existente.organizacion_id = NEW.organizacion_id
      AND existente.tipo_vehiculo = NEW.tipo_vehiculo
      AND existente.estado = 'ACTIVA'
      AND daterange(
        existente.vigente_desde,
        COALESCE(existente.vigente_hasta, 'infinity'::date),
        '[]'
      ) && daterange(
        NEW.vigente_desde,
        COALESCE(NEW.vigente_hasta, 'infinity'::date),
        '[]'
      )
  ) THEN
    RAISE EXCEPTION
      'La política de comisión se superpone con otra política activa'
      USING ERRCODE = '23505';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "disparador_validar_vigencia_politica_comision"
AFTER INSERT OR UPDATE OF "estado", "vigente_desde", "vigente_hasta"
ON "politicas_comisiones"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "luma_validar_vigencia_politica_comision"();

CREATE OR REPLACE FUNCTION "luma_proteger_snapshot_liquidacion_comision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    NEW.personal_id IS DISTINCT FROM OLD.personal_id
    OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id
    OR NEW.periodo_desde IS DISTINCT FROM OLD.periodo_desde
    OR NEW.periodo_hasta IS DISTINCT FROM OLD.periodo_hasta
    OR NEW.tipo_vehiculo IS DISTINCT FROM OLD.tipo_vehiculo
    OR NEW.cantidad_ventas IS DISTINCT FROM OLD.cantidad_ventas
    OR NEW.importe_sugerido IS DISTINCT FROM OLD.importe_sugerido
    OR NEW.politica_comision_id IS DISTINCT FROM OLD.politica_comision_id
    OR NEW.politica_snapshot IS DISTINCT FROM OLD.politica_snapshot
    OR NEW.escala_snapshot IS DISTINCT FROM OLD.escala_snapshot
    OR NEW.operaciones_snapshot IS DISTINCT FROM OLD.operaciones_snapshot
  THEN
    RAISE EXCEPTION 'El snapshot de la liquidación es inmutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "disparador_proteger_snapshot_liquidacion_comision"
BEFORE UPDATE ON "liquidaciones_comisiones"
FOR EACH ROW EXECUTE FUNCTION "luma_proteger_snapshot_liquidacion_comision"();

CREATE TRIGGER "disparador_politicas_comisiones_actualizado_en"
BEFORE UPDATE ON "politicas_comisiones"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

ALTER TABLE "politicas_comisiones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "politicas_comisiones" FORCE ROW LEVEL SECURITY;
CREATE POLICY "politica_politicas_comisiones_organizacion"
  ON "politicas_comisiones"
  FOR ALL
  USING (luma_tiene_acceso_organizacion("organizacion_id"))
  WITH CHECK (luma_tiene_acceso_organizacion("organizacion_id"));

ALTER TABLE "escalas_comisiones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "escalas_comisiones" FORCE ROW LEVEL SECURITY;
CREATE POLICY "politica_escalas_comisiones_organizacion"
  ON "escalas_comisiones"
  FOR ALL
  USING (luma_tiene_acceso_organizacion("organizacion_id"))
  WITH CHECK (luma_tiene_acceso_organizacion("organizacion_id"));

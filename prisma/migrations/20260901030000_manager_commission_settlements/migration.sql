-- Manager (GERENTE) commission settlements: a real agree/pay flow for
-- manager commissions, separate from liquidaciones_comisiones (the
-- vendor commission ledger). This closes the two scope gaps flagged in the
-- session report:
--   1. Managers previously only had a live, never-persisted calculation
--      (GET /commissions/me). Now they can be agreed (frozen) and paid,
--      just like vendors, but through their own table.
--   2. Admin screens (suggested/settlement commissions) previously only
--      listed vendors. This table is what a new consolidated "Gerentes"
--      admin view reads and writes.
--
-- liquidaciones_comisiones (vendor) is not touched by this migration in any
-- way - no column added, no constraint changed, no row written. This table
-- does not reuse liquidaciones_comisiones.sucursal_id (NOT NULL, one branch
-- per row) precisely because a manager scoped to TODAS_LAS_SUCURSALES has
-- no single branch to attribute the settlement to; sucursales_incluidas
-- below stores the actual set of branches counted for that settlement
-- instead, for traceability.
--
-- Not modeled with Prisma relations on purpose (same reasoning as
-- configuracion_comision_gerente and planes_credito): the service queries
-- this table with raw SQL so it does not depend on a regenerated Prisma
-- Client.

CREATE TYPE "estado_liquidacion_comision_gerente_luma" AS ENUM (
  'SUGERIDA',
  'ACORDADA',
  'PAGADA'
);

CREATE TABLE "liquidaciones_comisiones_gerente" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "personal_id" UUID NOT NULL,
  "tipo_vehiculo" "tipo_vehiculo_luma" NOT NULL,
  "periodo_desde" DATE NOT NULL,
  "periodo_hasta" DATE NOT NULL,
  "modo_calculo" "modo_calculo_comision_gerente_luma" NOT NULL,
  "alcance" "alcance_comision_gerente_luma" NOT NULL,
  "sucursales_incluidas" JSONB NOT NULL DEFAULT '[]',
  "cantidad_operaciones_computables" INTEGER NOT NULL DEFAULT 0,
  "porcentaje" DECIMAL(5,2),
  "politica_comision_id" UUID,
  "escala_snapshot" JSONB,
  "monto_calculado" DECIMAL(18,2) NOT NULL,
  "moneda" CHAR(3) NOT NULL DEFAULT 'ARS',
  "estado" "estado_liquidacion_comision_gerente_luma" NOT NULL DEFAULT 'SUGERIDA',
  "acordado_en" TIMESTAMPTZ(6),
  "acordado_por_personal_id" UUID,
  "pagado_en" TIMESTAMPTZ(6),
  "pagado_por_personal_id" UUID,
  "notas" TEXT,
  "version_fila" INTEGER NOT NULL DEFAULT 0,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "liquidaciones_comisiones_gerente_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "liquidaciones_comisiones_gerente_id_organizacion_unico" UNIQUE ("id", "organizacion_id"),
  CONSTRAINT "liquidaciones_comisiones_gerente_periodo_tipo_unico" UNIQUE
    ("organizacion_id", "personal_id", "periodo_desde", "periodo_hasta", "tipo_vehiculo"),
  CONSTRAINT "liquidaciones_comisiones_gerente_monto_valido" CHECK ("monto_calculado" >= 0),
  CONSTRAINT "liquidaciones_comisiones_gerente_operaciones_valido" CHECK ("cantidad_operaciones_computables" >= 0),
  CONSTRAINT "liquidaciones_comisiones_gerente_porcentaje_valido" CHECK (
    "porcentaje" IS NULL OR ("porcentaje" > 0 AND "porcentaje" <= 100)
  ),
  CONSTRAINT "liquidaciones_comisiones_gerente_modo_porcentaje_consistente" CHECK (
    ("modo_calculo" = 'PORCENTAJE' AND "porcentaje" IS NOT NULL AND "politica_comision_id" IS NULL)
    OR
    ("modo_calculo" = 'ESCALA' AND "politica_comision_id" IS NOT NULL AND "porcentaje" IS NULL)
  ),
  CONSTRAINT "liquidaciones_comisiones_gerente_acordado_consistente" CHECK (
    ("acordado_en" IS NULL) = ("acordado_por_personal_id" IS NULL)
  ),
  CONSTRAINT "liquidaciones_comisiones_gerente_pagado_consistente" CHECK (
    ("pagado_en" IS NULL) = ("pagado_por_personal_id" IS NULL)
  ),
  CONSTRAINT "liquidaciones_comisiones_gerente_pago_requiere_acuerdo" CHECK (
    "pagado_en" IS NULL OR "acordado_en" IS NOT NULL
  ),
  CONSTRAINT "liquidaciones_comisiones_gerente_estado_consistente" CHECK (
    ("estado" = 'SUGERIDA' AND "acordado_en" IS NULL AND "pagado_en" IS NULL)
    OR
    ("estado" = 'ACORDADA' AND "acordado_en" IS NOT NULL AND "pagado_en" IS NULL)
    OR
    ("estado" = 'PAGADA' AND "acordado_en" IS NOT NULL AND "pagado_en" IS NOT NULL)
  )
);

CREATE INDEX "liquidaciones_comisiones_gerente_estado_tipo_periodo_indice"
  ON "liquidaciones_comisiones_gerente" ("organizacion_id", "estado", "tipo_vehiculo", "periodo_desde" DESC);

CREATE INDEX "liquidaciones_comisiones_gerente_gerente_indice"
  ON "liquidaciones_comisiones_gerente" ("organizacion_id", "personal_id", "periodo_desde" DESC);

ALTER TABLE "liquidaciones_comisiones_gerente"
  ADD CONSTRAINT "liquidaciones_comisiones_gerente_organizacion_id_fkey"
    FOREIGN KEY ("organizacion_id")
    REFERENCES "organizaciones"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "liquidaciones_comisiones_gerente_personal_organizacion_fk"
    FOREIGN KEY ("personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "liquidaciones_comisiones_gerente_politica_organizacion_fk"
    FOREIGN KEY ("politica_comision_id", "organizacion_id")
    REFERENCES "politicas_comisiones"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "liquidaciones_comisiones_gerente_acordador_organizacion_fk"
    FOREIGN KEY ("acordado_por_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "liquidaciones_comisiones_gerente_pagador_organizacion_fk"
    FOREIGN KEY ("pagado_por_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id")
    ON DELETE RESTRICT;

DROP TRIGGER IF EXISTS "disparador_liquidaciones_comisiones_gerente_actualizado_en" ON "liquidaciones_comisiones_gerente";
CREATE TRIGGER "disparador_liquidaciones_comisiones_gerente_actualizado_en"
BEFORE UPDATE ON "liquidaciones_comisiones_gerente"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

ALTER TABLE "liquidaciones_comisiones_gerente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "liquidaciones_comisiones_gerente" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_liquidaciones_comisiones_gerente_organizacion" ON "liquidaciones_comisiones_gerente";
CREATE POLICY "politica_liquidaciones_comisiones_gerente_organizacion" ON "liquidaciones_comisiones_gerente"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

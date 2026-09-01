-- CALLCENTER role support + configurable manager (GERENTE) commissions.
--
-- Part 1: the "contact"/seller of a sales operation (asignaciones_personal_operacion
-- .rol_asignacion) can now be a CALLCENTER person, not only a VENDEDOR. This
-- widens the existing rol_asignacion_luma enum with a new value; it does not
-- touch any existing VENDEDOR/CONTACTO row.
--
-- Part 2: configuracion_comision_gerente lets an ADMINISTRADOR configure,
-- per individual GERENTE, whether they commission on a percentage of the
-- closing price or on the same unit-count scale vendors use, and whether
-- their scope is their own branch or every branch in the organization. This
-- table is additive and does not modify liquidaciones_comisiones or any
-- other existing commission table.
--
-- Not modeled with Prisma relations on purpose (see planes_credito in an
-- earlier migration): the service queries configuracion_comision_gerente
-- with raw SQL so it does not depend on a regenerated Prisma Client.

ALTER TYPE "rol_asignacion_luma" ADD VALUE 'CALLCENTER';

CREATE TYPE "modo_calculo_comision_gerente_luma" AS ENUM (
  'PORCENTAJE',
  'ESCALA'
);

CREATE TYPE "alcance_comision_gerente_luma" AS ENUM (
  'SUCURSAL_PROPIA',
  'TODAS_LAS_SUCURSALES'
);

CREATE TABLE "configuracion_comision_gerente" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "personal_id" UUID NOT NULL,
  "organizacion_id" UUID NOT NULL,
  "modo_calculo" "modo_calculo_comision_gerente_luma" NOT NULL,
  "porcentaje" DECIMAL(5,2),
  "politica_comision_id" UUID,
  "alcance" "alcance_comision_gerente_luma" NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_por_personal_id" UUID,
  CONSTRAINT "configuracion_comision_gerente_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "configuracion_comision_gerente_personal_unico" UNIQUE ("personal_id"),
  CONSTRAINT "configuracion_comision_gerente_porcentaje_valido" CHECK (
    "porcentaje" IS NULL OR ("porcentaje" > 0 AND "porcentaje" <= 100)
  ),
  CONSTRAINT "configuracion_comision_gerente_modo_porcentaje_consistente" CHECK (
    ("modo_calculo" = 'PORCENTAJE' AND "porcentaje" IS NOT NULL AND "politica_comision_id" IS NULL)
    OR
    ("modo_calculo" = 'ESCALA' AND "politica_comision_id" IS NOT NULL AND "porcentaje" IS NULL)
  )
);

CREATE INDEX "configuracion_comision_gerente_organizacion_activo_indice"
  ON "configuracion_comision_gerente" ("organizacion_id", "activo");

ALTER TABLE "configuracion_comision_gerente"
  ADD CONSTRAINT "configuracion_comision_gerente_organizacion_id_fkey"
    FOREIGN KEY ("organizacion_id")
    REFERENCES "organizaciones"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "configuracion_comision_gerente_personal_organizacion_fk"
    FOREIGN KEY ("personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "configuracion_comision_gerente_politica_organizacion_fk"
    FOREIGN KEY ("politica_comision_id", "organizacion_id")
    REFERENCES "politicas_comisiones"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "configuracion_comision_gerente_actualizador_organizacion_fk"
    FOREIGN KEY ("actualizado_por_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id")
    ON DELETE RESTRICT;

DROP TRIGGER IF EXISTS "disparador_configuracion_comision_gerente_actualizado_en" ON "configuracion_comision_gerente";
CREATE TRIGGER "disparador_configuracion_comision_gerente_actualizado_en"
BEFORE UPDATE ON "configuracion_comision_gerente"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

ALTER TABLE "configuracion_comision_gerente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "configuracion_comision_gerente" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_configuracion_comision_gerente_organizacion" ON "configuracion_comision_gerente";
CREATE POLICY "politica_configuracion_comision_gerente_organizacion" ON "configuracion_comision_gerente"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

-- Adds ambito (VENDEDOR | GERENCIA) to politicas_comisiones so a manager's
-- commission scale lives in its own catalog, separate from the vendor
-- scales, while reusing the exact same table/tier structure (no duplicated
-- table). Existing rows default to VENDEDOR - the only ambito that existed
-- before this migration - so the real MOTO policy already in the database
-- keeps behaving exactly as it did (confirmed by read-back after applying).

CREATE TYPE "ambito_politica_comision_luma" AS ENUM (
  'VENDEDOR',
  'GERENCIA'
);

ALTER TABLE "politicas_comisiones"
  ADD COLUMN "ambito" "ambito_politica_comision_luma" NOT NULL DEFAULT 'VENDEDOR';

-- The "active policy for this vehicle type" lookup has to be scoped per
-- ambito too, so a VENDEDOR policy and a GERENCIA policy for the same
-- tipo_vehiculo can both be ACTIVA at once without colliding.
DROP INDEX "politicas_comisiones_tipo_vigencia_indice";

CREATE INDEX "politicas_comisiones_ambito_tipo_vigencia_indice"
  ON "politicas_comisiones"
  ("organizacion_id", "ambito", "tipo_vehiculo", "estado", "vigente_desde" DESC);

-- luma_validar_vigencia_politica_comision is the real enforcement of "only
-- one ACTIVA policy per vehicle type at a time" (a DEFERRABLE constraint
-- trigger, not just the index above). Without adding ambito to its overlap
-- check, activating a GERENCIA policy for MOTO would be rejected the moment
-- it overlaps the existing ACTIVA VENDEDOR MOTO policy - which it normally
-- would, since that policy is open-ended.
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
      AND existente.ambito = NEW.ambito
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

-- Defense in depth beyond the application-level check in
-- saveManagerCommissionConfig(): configuracion_comision_gerente.politica_comision_id
-- must reference a GERENCIA-ambito policy specifically. This mirrors the
-- existing "belt and suspenders" pattern above (app validates, DB trigger
-- guarantees it can never be bypassed even by a future direct-SQL bug).
CREATE OR REPLACE FUNCTION "luma_validar_ambito_politica_gerente"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.politica_comision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "politicas_comisiones"
    WHERE "id" = NEW.politica_comision_id
      AND "ambito" = 'GERENCIA'
  ) THEN
    RAISE EXCEPTION
      'La política de escala de un gerente debe ser de ámbito GERENCIA'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER "disparador_validar_ambito_politica_gerente"
AFTER INSERT OR UPDATE OF "politica_comision_id" ON "configuracion_comision_gerente"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "luma_validar_ambito_politica_gerente"();

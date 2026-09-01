-- Adds an optional finish/acabado to each physical inventory unit, paired
-- with the existing free-text "color" column. Both are now constrained at
-- the application layer to a closed list of standardized values (see
-- inventory.dto.ts) to avoid free-text color drift (e.g. "Azul" vs
-- "Azul oscuro" vs "Blue").
ALTER TABLE "public"."unidades_vehiculos"
  ADD COLUMN "acabado" VARCHAR(40);

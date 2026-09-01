-- Adds an optional standard/reference cost price to each catalog version
-- (versiones_vehiculos), distinct from unidades_vehiculos.costo_compra
-- (the actual acquisition cost of one physical unit) and from
-- politicas_precios_vehiculos (the sale/list price). This is the cost
-- gerencia loads per model to reason about margin; not all versions will
-- have it set from day one, so it stays nullable.
--
-- No dedicated currency column, mirroring unidades_vehiculos.costo_compra:
-- cost figures in this codebase are institutional-currency-only (ARS),
-- unlike sale prices (politicas_precios_vehiculos.moneda) which vary by
-- policy.
ALTER TABLE "public"."versiones_vehiculos"
  ADD COLUMN "precio_costo" DECIMAL(18,2);

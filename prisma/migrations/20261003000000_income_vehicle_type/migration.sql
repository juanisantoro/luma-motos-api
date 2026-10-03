-- Ingresos: tipo de vehículo del circuito donde se cargó (motos o autos).
--
-- La grilla de ingresos filtra por tipo de vehículo y hasta ahora lo deducía
-- sólo de la unidad o de la operación vinculada. Un ingreso cargado sin
-- ninguna de las dos quedaba guardado pero no aparecía en ninguna grilla.
-- Ahora el alta guarda desde qué pantalla se cargó y la grilla lo usa cuando
-- no hay unidad ni operación de donde deducirlo. La columna es opcional: los
-- ingresos con unidad u operación se siguen clasificando por ellas.

ALTER TABLE "public"."ingresos"
  ADD COLUMN "tipo_vehiculo" "public"."tipo_vehiculo_luma";

-- Ingresos cargados a mano el 03/10/2026 (hora de Argentina) sin unidad ni
-- operación: se cargaron desde "Ingresos de motos" y hoy no se ven.
UPDATE "public"."ingresos"
SET "tipo_vehiculo" = 'MOTO'
WHERE "operacion_id" IS NULL
  AND "unidad_vehiculo_id" IS NULL
  AND "fila_importacion_id" IS NULL
  AND "es_transferencia" = false
  AND ("creado_en" AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = DATE '2026-10-03';

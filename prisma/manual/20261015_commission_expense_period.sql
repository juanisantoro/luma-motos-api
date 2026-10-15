-- Opcional: lleva los gastos de comisiones de vendedores ya pagados al mes
-- que liquidan (antes quedaban en el mes del pago). Desde esta versión los
-- nuevos ya se guardan así. Cambia el Balance de los meses ya pasados:
-- correrla sólo si se quiere ese criterio también para lo histórico.
-- Los movimientos de caja no se tocan (siguen con la fecha real del pago).
UPDATE "public"."gastos" g
SET "fecha_generacion" = l."periodo_hasta"
FROM "public"."liquidaciones_comisiones" l
WHERE l."gasto_id" = g."id"
  AND l."organizacion_id" = g."organizacion_id"
  AND g."fecha_generacion" <> l."periodo_hasta";

-- Fase 3: la venta ya no elige unidad ni proveedor. El vendedor puede
-- indicar un color deseado, que se guarda en la operación y se usa por
-- defecto al pedir la moto a un proveedor. Antes el color sólo vivía en la
-- solicitud de abastecimiento creada desde una disponibilidad.
ALTER TABLE "public"."operaciones" ADD COLUMN "color_deseado" VARCHAR(80);

-- Operaciones históricas creadas contra una disponibilidad: el color pedido
-- queda también en la operación.
UPDATE "public"."operaciones" AS o
SET "color_deseado" = s."color"
FROM "public"."solicitudes_abastecimiento" AS s
WHERE s."operacion_id" = o."id"
  AND s."organizacion_id" = o."organizacion_id"
  AND s."color" IS NOT NULL
  AND o."color_deseado" IS NULL;

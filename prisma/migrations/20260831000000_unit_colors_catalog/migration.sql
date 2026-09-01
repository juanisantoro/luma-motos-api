-- Moves the standardized color list for unidades_vehiculos.color out of
-- hardcoded arrays (duplicated between the backend DTO and the frontend)
-- and into a lookup table, so colors can be added/removed without a code
-- deploy. Mirrors the existing tipos_ingreso / conceptos_pago_vehiculo
-- pattern: a plain lookup table with nombre/nombre_normalizado/activo,
-- validated against from the service layer via raw SQL rather than wired
-- up as a Prisma relation or an @IsIn(...) list.
--
-- unidades_vehiculos.color itself is NOT changed to a foreign key - it
-- stays a free VARCHAR(80), consistent with how ingresos.tipo_original
-- already relates to tipos_ingreso (by validated name, not by id).
CREATE TABLE "colores_unidad" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nombre" VARCHAR(80) NOT NULL,
  "nombre_normalizado" VARCHAR(80) NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "colores_unidad_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "colores_unidad_nombre_normalizado_key"
  ON "colores_unidad" ("nombre_normalizado");

-- Seed with the same 18 standardized colors that were previously
-- hardcoded as UNIT_COLORS in src/inventory/inventory.dto.ts.
INSERT INTO "colores_unidad" ("nombre", "nombre_normalizado") VALUES
  ('Negro', 'negro'),
  ('Blanco', 'blanco'),
  ('Gris', 'gris'),
  ('Plata', 'plata'),
  ('Rojo', 'rojo'),
  ('Bordó', 'bordó'),
  ('Azul', 'azul'),
  ('Celeste', 'celeste'),
  ('Verde', 'verde'),
  ('Amarillo', 'amarillo'),
  ('Naranja', 'naranja'),
  ('Violeta', 'violeta'),
  ('Rosa', 'rosa'),
  ('Marrón', 'marrón'),
  ('Beige', 'beige'),
  ('Dorado', 'dorado'),
  ('Cobre', 'cobre'),
  ('Bronce', 'bronce')
ON CONFLICT ("nombre_normalizado") DO NOTHING;

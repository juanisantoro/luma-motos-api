CREATE TABLE "tipos_ingreso" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nombre" VARCHAR(120) NOT NULL,
  "nombre_normalizado" VARCHAR(120) NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tipos_ingreso_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tipos_ingreso_nombre_normalizado_key"
  ON "tipos_ingreso" ("nombre_normalizado");

-- Seed with the distinct "tipo" values already present in production
-- income records, so the new dropdown doesn't orphan existing data.
INSERT INTO "tipos_ingreso" ("nombre", "nombre_normalizado") VALUES
  ('CREDITO', 'credito'),
  ('Efectivo por compra', 'efectivo por compra'),
  ('Otros', 'otros'),
  ('Pagarés', 'pagarés'),
  ('Patente', 'patente'),
  ('POSTNER MERCADO', 'postner mercado'),
  ('Seguro', 'seguro'),
  ('Seña', 'seña'),
  ('TRANSFERENCIA', 'transferencia')
ON CONFLICT ("nombre_normalizado") DO NOTHING;

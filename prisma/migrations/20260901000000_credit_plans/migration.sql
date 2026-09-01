-- Créditos personales: planes de financiación propia de la agencia,
-- créditos tomados en una operación de venta (snapshot de los términos
-- del plan al momento de aceptarlo) y el cronograma/cobranza de cuotas.
--
-- Estas tablas no se modelan con relaciones de Prisma a propósito (ver
-- comentario en schema.prisma junto a pagos_vehiculo): el service las
-- consulta con SQL crudo para no depender de un Prisma Client regenerado.
-- Las FK sí se aplican acá, a nivel de base.

CREATE TYPE "metodo_calculo_credito_luma" AS ENUM (
  'FRANCES',
  'INTERES_SIMPLE'
);

CREATE TYPE "estado_credito_operacion_luma" AS ENUM (
  'ACTIVO',
  'CANCELADO',
  'FINALIZADO'
);

CREATE TYPE "estado_cuota_credito_luma" AS ENUM (
  'PENDIENTE',
  'PAGADA',
  'VENCIDA',
  'PARCIAL'
);

-- Planes de crédito administrables. Definen el método de cálculo del
-- interés, la cantidad de cuotas y la tasa, más un rango de monto
-- financiable opcional.

CREATE TABLE "planes_credito" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "nombre" VARCHAR(160) NOT NULL,
  "metodo_calculo" "metodo_calculo_credito_luma" NOT NULL,
  "cantidad_cuotas" INTEGER NOT NULL,
  "tasa_interes" DECIMAL(6,3) NOT NULL,
  "monto_minimo" DECIMAL(18,2),
  "monto_maximo" DECIMAL(18,2),
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "planes_credito_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "planes_credito_cuotas_validas" CHECK ("cantidad_cuotas" >= 1 AND "cantidad_cuotas" <= 360),
  CONSTRAINT "planes_credito_tasa_valida" CHECK ("tasa_interes" >= 0),
  CONSTRAINT "planes_credito_monto_minimo_valido" CHECK ("monto_minimo" IS NULL OR "monto_minimo" >= 0),
  CONSTRAINT "planes_credito_monto_maximo_valido" CHECK ("monto_maximo" IS NULL OR "monto_maximo" >= 0),
  CONSTRAINT "planes_credito_rango_monto_valido" CHECK (
    "monto_minimo" IS NULL OR "monto_maximo" IS NULL OR "monto_maximo" >= "monto_minimo"
  )
);

CREATE UNIQUE INDEX "planes_credito_id_organizacion_unico"
  ON "planes_credito" ("id", "organizacion_id");

CREATE INDEX "planes_credito_organizacion_activo_indice"
  ON "planes_credito" ("organizacion_id", "activo");

ALTER TABLE "planes_credito"
  ADD CONSTRAINT "planes_credito_organizacion_id_fkey"
    FOREIGN KEY ("organizacion_id")
    REFERENCES "organizaciones"("id")
    ON DELETE RESTRICT;

-- Crédito efectivamente tomado en una operación puntual: snapshot de los
-- términos del plan al momento de aceptarlo (el plan puede cambiar o
-- desactivarse después sin afectar créditos ya tomados).

CREATE TABLE "operacion_creditos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "operacion_id" UUID NOT NULL,
  "plan_credito_id" UUID,
  "metodo_calculo" "metodo_calculo_credito_luma" NOT NULL,
  "cantidad_cuotas" INTEGER NOT NULL,
  "tasa_interes" DECIMAL(6,3) NOT NULL,
  "monto_financiado" DECIMAL(18,2) NOT NULL,
  "interes_total" DECIMAL(18,2) NOT NULL,
  "monto_total" DECIMAL(18,2) NOT NULL,
  "monto_cuota" DECIMAL(18,2) NOT NULL,
  "estado" "estado_credito_operacion_luma" NOT NULL DEFAULT 'ACTIVO',
  "creado_por_personal_id" UUID NOT NULL,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operacion_creditos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operacion_creditos_cuotas_validas" CHECK ("cantidad_cuotas" >= 1 AND "cantidad_cuotas" <= 360),
  CONSTRAINT "operacion_creditos_tasa_valida" CHECK ("tasa_interes" >= 0),
  CONSTRAINT "operacion_creditos_monto_financiado_valido" CHECK ("monto_financiado" > 0),
  CONSTRAINT "operacion_creditos_interes_total_valido" CHECK ("interes_total" >= 0),
  CONSTRAINT "operacion_creditos_monto_total_valido" CHECK ("monto_total" > 0),
  CONSTRAINT "operacion_creditos_monto_cuota_valido" CHECK ("monto_cuota" > 0)
);

CREATE UNIQUE INDEX "operacion_creditos_id_organizacion_unico"
  ON "operacion_creditos" ("id", "organizacion_id");

CREATE INDEX "operacion_creditos_organizacion_operacion_indice"
  ON "operacion_creditos" ("organizacion_id", "operacion_id");

CREATE INDEX "operacion_creditos_organizacion_estado_indice"
  ON "operacion_creditos" ("organizacion_id", "estado");

ALTER TABLE "operacion_creditos"
  ADD CONSTRAINT "operacion_creditos_organizacion_id_fkey"
    FOREIGN KEY ("organizacion_id")
    REFERENCES "organizaciones"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "operacion_credito_operacion_organizacion_fk"
    FOREIGN KEY ("operacion_id", "organizacion_id")
    REFERENCES "operaciones"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "operacion_credito_plan_organizacion_fk"
    FOREIGN KEY ("plan_credito_id", "organizacion_id")
    REFERENCES "planes_credito"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "operacion_credito_creador_organizacion_fk"
    FOREIGN KEY ("creado_por_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id")
    ON DELETE RESTRICT;

-- Cronograma de cuotas de cada crédito tomado, con seguimiento de cobranza.

CREATE TABLE "cuotas_credito" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "operacion_credito_id" UUID NOT NULL,
  "numero_cuota" INTEGER NOT NULL,
  "monto" DECIMAL(18,2) NOT NULL,
  "vencimiento" DATE NOT NULL,
  "estado" "estado_cuota_credito_luma" NOT NULL DEFAULT 'PENDIENTE',
  "monto_pagado" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "fecha_pago" DATE,
  "registrado_por_personal_id" UUID,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cuotas_credito_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cuotas_credito_numero_valido" CHECK ("numero_cuota" >= 1),
  CONSTRAINT "cuotas_credito_monto_valido" CHECK ("monto" > 0),
  CONSTRAINT "cuotas_credito_monto_pagado_valido" CHECK ("monto_pagado" >= 0)
);

CREATE UNIQUE INDEX "cuotas_credito_id_organizacion_unico"
  ON "cuotas_credito" ("id", "organizacion_id");

CREATE UNIQUE INDEX "cuotas_credito_operacion_credito_numero_unico"
  ON "cuotas_credito" ("operacion_credito_id", "numero_cuota");

CREATE INDEX "cuotas_credito_organizacion_estado_vencimiento_indice"
  ON "cuotas_credito" ("organizacion_id", "estado", "vencimiento");

ALTER TABLE "cuotas_credito"
  ADD CONSTRAINT "cuotas_credito_organizacion_id_fkey"
    FOREIGN KEY ("organizacion_id")
    REFERENCES "organizaciones"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "cuota_credito_operacion_credito_organizacion_fk"
    FOREIGN KEY ("operacion_credito_id", "organizacion_id")
    REFERENCES "operacion_creditos"("id", "organizacion_id")
    ON DELETE CASCADE,
  ADD CONSTRAINT "cuota_credito_registrador_organizacion_fk"
    FOREIGN KEY ("registrado_por_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id")
    ON DELETE RESTRICT;

DROP TRIGGER IF EXISTS "disparador_planes_credito_actualizado_en" ON "planes_credito";
CREATE TRIGGER "disparador_planes_credito_actualizado_en"
BEFORE UPDATE ON "planes_credito"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

DROP TRIGGER IF EXISTS "disparador_cuotas_credito_actualizado_en" ON "cuotas_credito";
CREATE TRIGGER "disparador_cuotas_credito_actualizado_en"
BEFORE UPDATE ON "cuotas_credito"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

ALTER TABLE "planes_credito" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "planes_credito" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_planes_credito_organizacion" ON "planes_credito";
CREATE POLICY "politica_planes_credito_organizacion" ON "planes_credito"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

ALTER TABLE "operacion_creditos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operacion_creditos" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_operacion_creditos_organizacion" ON "operacion_creditos";
CREATE POLICY "politica_operacion_creditos_organizacion" ON "operacion_creditos"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

ALTER TABLE "cuotas_credito" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cuotas_credito" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_cuotas_credito_organizacion" ON "cuotas_credito";
CREATE POLICY "politica_cuotas_credito_organizacion" ON "cuotas_credito"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

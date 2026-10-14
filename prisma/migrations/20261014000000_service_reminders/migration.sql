-- Avisos de service: a los 30 días de entregada una moto vendida toca el
-- 1º service, y desde el último service hecho, uno por año. La lista se
-- calcula sola (ventas entregadas + órdenes de service); esta tabla sólo
-- guarda qué aviso ya se resolvió (se contactó al cliente o se descartó)
-- para que no vuelva a aparecer.
--
-- Sin relaciones modeladas en Prisma (como ordenes_service): las FK van acá,
-- con la organización, para que nada cruce de tenant.

CREATE TABLE "avisos_service" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "unidad_vehiculo_id" UUID NOT NULL,
  -- PRIMER_SERVICE (30 días de la entrega) o ANUAL (un año del último).
  "etapa" VARCHAR(20) NOT NULL,
  -- Día en que le tocaba el service: identifica el aviso junto a la etapa.
  "vence_el" DATE NOT NULL,
  -- CONTACTADO (se le escribió o llamó) o DESCARTADO (no corresponde).
  "estado" VARCHAR(20) NOT NULL,
  -- WHATSAPP, TELEFONO u OTRO.
  "canal" VARCHAR(20),
  "nota" TEXT,
  "registrado_por_personal_id" UUID NOT NULL,
  "registrado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "avisos_service_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "avisos_service_etapa_valida"
    CHECK ("etapa" IN ('PRIMER_SERVICE', 'ANUAL')),
  CONSTRAINT "avisos_service_estado_valido"
    CHECK ("estado" IN ('CONTACTADO', 'DESCARTADO')),
  CONSTRAINT "avisos_service_canal_valido"
    CHECK ("canal" IS NULL OR "canal" IN ('WHATSAPP', 'TELEFONO', 'OTRO')),
  CONSTRAINT "avisos_service_organizacion_fk"
    FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id")
    ON DELETE RESTRICT,
  CONSTRAINT "avisos_service_unidad_fk"
    FOREIGN KEY ("unidad_vehiculo_id", "organizacion_id")
    REFERENCES "unidades_vehiculos"("id", "organizacion_id") ON DELETE RESTRICT,
  CONSTRAINT "avisos_service_registrado_por_fk"
    FOREIGN KEY ("registrado_por_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "avisos_service_aviso_unico"
  ON "avisos_service" ("organizacion_id", "unidad_vehiculo_id", "etapa", "vence_el");

ALTER TABLE "avisos_service" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "avisos_service" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_avisos_service_organizacion" ON "avisos_service";
CREATE POLICY "politica_avisos_service_organizacion" ON "avisos_service"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

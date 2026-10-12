-- Meses de trabajo: la organización decide cuándo termina cada mes.
--
-- Una fila por mes ("AAAA-MM") que tenga corte. El mes va del día siguiente
-- al corte del mes anterior hasta "fecha_corte"; un mes sin fila termina el
-- último día del almanaque y uno cuyo anterior no tiene fila empieza el 1.
-- Sin filas, todo sigue con meses de almanaque.
--
-- El corte de un mes cae entre el 15 de ese mes y el 14 del siguiente: así
-- los meses no se pisan ni dejan huecos, y de un rango guardado (por ejemplo
-- el de una liquidación de comisiones) se sabe de qué mes es.
--
-- La tabla no lleva relaciones modeladas en Prisma: el código la usa con SQL
-- crudo. Las FK se aplican acá.

CREATE TABLE "meses_trabajo" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "periodo" CHAR(7) NOT NULL,
  "fecha_corte" DATE NOT NULL,
  "creado_por_usuario_id" UUID NOT NULL,
  "actualizado_por_usuario_id" UUID NOT NULL,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meses_trabajo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meses_trabajo_periodo_valido"
    CHECK ("periodo" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "meses_trabajo_corte_en_rango"
    CHECK (
      "fecha_corte" >= to_date("periodo" || '-15', 'YYYY-MM-DD')
      AND "fecha_corte" <= (to_date("periodo" || '-01', 'YYYY-MM-DD') + INTERVAL '1 month' + INTERVAL '13 days')::date
    )
);

CREATE UNIQUE INDEX "meses_trabajo_organizacion_periodo_unico"
  ON "meses_trabajo" ("organizacion_id", "periodo");

ALTER TABLE "meses_trabajo"
  ADD CONSTRAINT "meses_trabajo_organizacion_id_fkey"
    FOREIGN KEY ("organizacion_id")
    REFERENCES "organizaciones"("id")
    ON DELETE RESTRICT,
  -- Sin la organización en la FK: un usuario con acceso global puede
  -- definir el corte de otra organización.
  ADD CONSTRAINT "meses_trabajo_creado_por_fkey"
    FOREIGN KEY ("creado_por_usuario_id")
    REFERENCES "usuarios"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "meses_trabajo_actualizado_por_fkey"
    FOREIGN KEY ("actualizado_por_usuario_id")
    REFERENCES "usuarios"("id")
    ON DELETE RESTRICT;

ALTER TABLE "meses_trabajo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meses_trabajo" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_meses_trabajo_organizacion" ON "meses_trabajo";
CREATE POLICY "politica_meses_trabajo_organizacion" ON "meses_trabajo"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

-- Permiso para cargar y mover los cortes: sólo el rol ADMINISTRADOR.
-- permisos_rol tiene RLS forzada y ADMINISTRADOR es un rol de sistema: sin
-- acceso global, el INSERT lo rechaza la política (como en las migraciones
-- 20260929000000 y 20261008000000).
SELECT set_config('app.acceso_global', 'true', true);

INSERT INTO "permisos" ("codigo", "modulo", "descripcion")
VALUES (
  'meses_trabajo.gestionar',
  'meses_trabajo',
  'Define el corte de cada mes de trabajo: desde y hasta qué día cuenta cada mes.'
)
ON CONFLICT ("codigo") DO NOTHING;

INSERT INTO "permisos_rol" ("rol_id", "codigo_permiso")
SELECT r."id", 'meses_trabajo.gestionar'
FROM "roles" r
WHERE r."codigo" = 'ADMINISTRADOR'
ON CONFLICT DO NOTHING;

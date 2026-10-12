-- Service (taller): órdenes de trabajo de las motos que entran a service.
--
-- Circuito: la administrativa recibe la moto y carga la orden (RECIBIDA); el
-- mecánico la trabaja (EN_TALLER), tilda las tareas y la firma (TERMINADA);
-- la administrativa la cobra y la entrega (ENTREGADA). Se puede cancelar
-- mientras no se entregó.
--
-- Las tablas no llevan relaciones modeladas en Prisma (como pagos_vehiculo):
-- las FK se aplican acá, con la organización, para que nada cruce de tenant.

-- Tipos de service (1º, 2º, 3º…): las tareas que lleva cada uno y, a futuro,
-- lo que se cobra. Cada organización tiene los suyos.
CREATE TABLE "tipos_service" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "nombre" VARCHAR(80) NOT NULL,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "tareas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "precio_sugerido" DECIMAL(18, 2),
  "moneda" CHAR(3) NOT NULL DEFAULT 'ARS',
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tipos_service_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tipos_service_nombre_no_vacio" CHECK (btrim("nombre") <> ''),
  CONSTRAINT "tipos_service_precio_no_negativo"
    CHECK ("precio_sugerido" IS NULL OR "precio_sugerido" >= 0),
  CONSTRAINT "tipos_service_organizacion_fk"
    FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id")
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "tipos_service_id_organizacion_unico"
  ON "tipos_service" ("id", "organizacion_id");
CREATE UNIQUE INDEX "tipos_service_organizacion_nombre_unico"
  ON "tipos_service" ("organizacion_id", lower(btrim("nombre")));

CREATE TABLE "ordenes_service" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "sucursal_id" UUID NOT NULL,
  -- Número de orden correlativo por organización (el 000001 del papel).
  "numero" INTEGER NOT NULL,
  "estado" VARCHAR(20) NOT NULL DEFAULT 'RECIBIDA',
  "fecha_recepcion" DATE NOT NULL,
  -- Cliente: el registrado (si lo hay) y los datos tal como se cargaron.
  "cliente_id" UUID,
  "cliente_nombre" VARCHAR(160) NOT NULL,
  "cliente_telefono" VARCHAR(40),
  "cliente_correo" VARCHAR(160),
  "cliente_documento" VARCHAR(20),
  "cliente_direccion" VARCHAR(240),
  "cliente_localidad" VARCHAR(120),
  -- Moto: la unidad vendida por Luma (si se encontró) y los datos cargados.
  "unidad_vehiculo_id" UUID,
  "moto_dominio" VARCHAR(20),
  "moto_chasis" VARCHAR(40),
  "moto_motor" VARCHAR(40),
  "moto_modelo" VARCHAR(120),
  "moto_anio" INTEGER,
  "km_actual" INTEGER NOT NULL,
  "km_proximo_service" INTEGER,
  "tipo_service_id" UUID,
  -- Nombre del tipo al recibirla ("1º service") o lo que se escribió en Otro.
  "tipo_service_nombre" VARCHAR(80) NOT NULL,
  "observaciones_recepcion" TEXT,
  -- Trabajo del mecánico: [{ descripcion, realizada, observacion }].
  "tareas" JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- { tipo, viscosidad, litros, filtro }.
  "aceite" JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- [{ codigo, descripcion, cantidad, precioUnitario }].
  "repuestos" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "diagnostico" TEXT,
  "mecanico_personal_id" UUID,
  "terminada_en" TIMESTAMPTZ(6),
  -- Cobro y entrega.
  "importe" DECIMAL(18, 2),
  "ingreso_id" UUID,
  "entregada_en" TIMESTAMPTZ(6),
  "entregada_por_personal_id" UUID,
  "estado_entrega" VARCHAR(10),
  "observaciones_entrega" TEXT,
  "cancelada_motivo" TEXT,
  "cancelada_en" TIMESTAMPTZ(6),
  "version_fila" INTEGER NOT NULL DEFAULT 0,
  "creado_por_personal_id" UUID NOT NULL,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ordenes_service_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ordenes_service_estado_valido" CHECK (
    "estado" IN ('RECIBIDA', 'EN_TALLER', 'TERMINADA', 'ENTREGADA', 'CANCELADA')
  ),
  CONSTRAINT "ordenes_service_numero_positivo" CHECK ("numero" > 0),
  CONSTRAINT "ordenes_service_cliente_no_vacio" CHECK (btrim("cliente_nombre") <> ''),
  CONSTRAINT "ordenes_service_km_validos" CHECK (
    "km_actual" >= 0
    AND ("km_proximo_service" IS NULL OR "km_proximo_service" >= 0)
  ),
  CONSTRAINT "ordenes_service_anio_valido" CHECK (
    "moto_anio" IS NULL OR "moto_anio" BETWEEN 1950 AND 2100
  ),
  CONSTRAINT "ordenes_service_importe_no_negativo" CHECK (
    "importe" IS NULL OR "importe" >= 0
  ),
  CONSTRAINT "ordenes_service_estado_entrega_valido" CHECK (
    "estado_entrega" IS NULL OR "estado_entrega" IN ('OPTIMO', 'BUENO', 'REGULAR')
  ),
  -- Terminada o entregada: la firmó un mecánico.
  CONSTRAINT "ordenes_service_firma" CHECK (
    "estado" NOT IN ('TERMINADA', 'ENTREGADA')
    OR ("mecanico_personal_id" IS NOT NULL AND "terminada_en" IS NOT NULL)
  ),
  -- Entregada: con fecha, quién la entregó e importe (cero si no se cobra).
  CONSTRAINT "ordenes_service_entrega" CHECK (
    "estado" <> 'ENTREGADA'
    OR (
      "entregada_en" IS NOT NULL
      AND "entregada_por_personal_id" IS NOT NULL
      AND "importe" IS NOT NULL
    )
  ),
  CONSTRAINT "ordenes_service_cancelacion" CHECK (
    "estado" <> 'CANCELADA'
    OR ("cancelada_motivo" IS NOT NULL AND "cancelada_en" IS NOT NULL)
  ),
  CONSTRAINT "ordenes_service_organizacion_fk"
    FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id")
    ON DELETE RESTRICT,
  CONSTRAINT "ordenes_service_sucursal_fk"
    FOREIGN KEY ("sucursal_id", "organizacion_id")
    REFERENCES "sucursales"("id", "organizacion_id") ON DELETE RESTRICT,
  CONSTRAINT "ordenes_service_cliente_fk"
    FOREIGN KEY ("cliente_id", "organizacion_id")
    REFERENCES "clientes"("id", "organizacion_id") ON DELETE RESTRICT,
  CONSTRAINT "ordenes_service_unidad_fk"
    FOREIGN KEY ("unidad_vehiculo_id", "organizacion_id")
    REFERENCES "unidades_vehiculos"("id", "organizacion_id") ON DELETE RESTRICT,
  CONSTRAINT "ordenes_service_tipo_fk"
    FOREIGN KEY ("tipo_service_id", "organizacion_id")
    REFERENCES "tipos_service"("id", "organizacion_id") ON DELETE RESTRICT,
  CONSTRAINT "ordenes_service_mecanico_fk"
    FOREIGN KEY ("mecanico_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id") ON DELETE RESTRICT,
  CONSTRAINT "ordenes_service_ingreso_fk"
    FOREIGN KEY ("ingreso_id", "organizacion_id")
    REFERENCES "ingresos"("id", "organizacion_id") ON DELETE RESTRICT,
  CONSTRAINT "ordenes_service_entregada_por_fk"
    FOREIGN KEY ("entregada_por_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id") ON DELETE RESTRICT,
  CONSTRAINT "ordenes_service_creado_por_fk"
    FOREIGN KEY ("creado_por_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "ordenes_service_id_organizacion_unico"
  ON "ordenes_service" ("id", "organizacion_id");
CREATE UNIQUE INDEX "ordenes_service_organizacion_numero_unico"
  ON "ordenes_service" ("organizacion_id", "numero");
CREATE UNIQUE INDEX "ordenes_service_ingreso_unico"
  ON "ordenes_service" ("ingreso_id") WHERE "ingreso_id" IS NOT NULL;
CREATE INDEX "ordenes_service_sucursal_estado_indice"
  ON "ordenes_service" ("organizacion_id", "sucursal_id", "estado");
CREATE INDEX "ordenes_service_dominio_indice"
  ON "ordenes_service" ("organizacion_id", upper("moto_dominio"));

ALTER TABLE "tipos_service" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tipos_service" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_tipos_service_organizacion" ON "tipos_service";
CREATE POLICY "politica_tipos_service_organizacion" ON "tipos_service"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

ALTER TABLE "ordenes_service" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordenes_service" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_ordenes_service_organizacion" ON "ordenes_service";
CREATE POLICY "politica_ordenes_service_organizacion" ON "ordenes_service"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

-- Lo que sigue toca tablas con RLS forzada sin una organización en curso
-- (permisos_rol, roles de sistema, una fila por organización): se corre con
-- acceso global, como en las migraciones 20261008000000 y 20261010000000.
SELECT set_config('app.acceso_global', 'true', true);

-- Tipos de service iniciales: todavía no está definido qué lleva cada uno,
-- así que arrancan con las 15 tareas de la planilla en papel y se ajustan
-- desde la configuración.
INSERT INTO "tipos_service" ("organizacion_id", "nombre", "orden", "tareas")
SELECT o."id", t."nombre", t."orden", ARRAY[
  'Cambio de aceite de motor',
  'Cambio de filtro de aceite',
  'Revisión y ajuste de cadena / transmisión',
  'Revisión de frenos (delantero y trasero)',
  'Revisión de presión y estado de neumáticos',
  'Revisión de luces e iluminación',
  'Revisión de batería y sistema de carga',
  'Revisión de bujía',
  'Limpieza de filtro de aire',
  'Revisión de suspensión delantera',
  'Revisión de suspensión trasera',
  'Revisión de cables y comandos',
  'Ajuste de tornillería general',
  'Diagnóstico electrónico',
  'Prueba de funcionamiento'
]::TEXT[]
FROM "organizaciones" o
CROSS JOIN (VALUES
  ('1º service', 1),
  ('2º service', 2),
  ('3º service', 3),
  ('4º service', 4)
) AS t("nombre", "orden")
ON CONFLICT DO NOTHING;

-- Tipo de ingreso con el que entra a caja el cobro de un service.
INSERT INTO "tipos_ingreso" ("nombre", "nombre_normalizado")
VALUES ('Service', 'service')
ON CONFLICT ("nombre_normalizado") DO NOTHING;

-- Rol de sistema del mecánico: sólo ve y trabaja las órdenes de su sucursal.
INSERT INTO "roles" ("codigo", "nombre", "descripcion", "es_sistema", "organizacion_id")
SELECT 'MECANICO', 'Mecánico',
  'Trabaja las órdenes de service de su sucursal: checklist, aceite, repuestos y firma.',
  true, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM "roles"
  WHERE "codigo" = 'MECANICO' AND "es_sistema" AND "organizacion_id" IS NULL
);

INSERT INTO "permisos" ("codigo", "modulo", "descripcion") VALUES
  ('service.consultar', 'service', 'Consulta las órdenes de service de sus sucursales.'),
  ('service.gestionar', 'service', 'Recibe motos para service: carga, corrige, reabre y cancela órdenes.'),
  ('service.trabajar', 'service', 'Trabaja una orden de service: checklist, aceite, repuestos, diagnóstico y firma.'),
  ('service.cobrar', 'service', 'Cobra y entrega las motos con el service terminado.'),
  ('service.tipos.gestionar', 'service', 'Configura los tipos de service: tareas y precio sugerido.')
ON CONFLICT ("codigo") DO NOTHING;

INSERT INTO "permisos_rol" ("rol_id", "codigo_permiso")
SELECT r."id", p."codigo"
FROM "roles" r
JOIN (VALUES
  ('MECANICO', 'service.consultar'),
  ('MECANICO', 'service.trabajar'),
  ('ADMINISTRATIVA', 'service.consultar'),
  ('ADMINISTRATIVA', 'service.gestionar'),
  ('ADMINISTRATIVA', 'service.cobrar'),
  ('GERENTE', 'service.consultar'),
  ('GERENTE', 'service.gestionar'),
  ('GERENTE', 'service.cobrar'),
  ('ADMINISTRADOR', 'service.consultar'),
  ('ADMINISTRADOR', 'service.gestionar'),
  ('ADMINISTRADOR', 'service.trabajar'),
  ('ADMINISTRADOR', 'service.cobrar'),
  ('ADMINISTRADOR', 'service.tipos.gestionar')
) AS p("rol", "codigo") ON p."rol" = r."codigo"
WHERE r."es_sistema" AND r."organizacion_id" IS NULL
ON CONFLICT DO NOTHING;

BEGIN;

-- Port database/003_datos_prueba_excel.sql into the Prisma migration chain.
-- This migration intentionally converges catalog objects to one canonical
-- definition so it can also reconcile databases where 003 was run manually.

ALTER TABLE "personal"
  ADD COLUMN IF NOT EXISTS "es_actor_sistema_importado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "datos_inferidos" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "personal"
  DROP CONSTRAINT IF EXISTS "personal_datos_inferidos_objeto",
  DROP CONSTRAINT IF EXISTS "personal_actor_sistema_importado_sin_acceso";

ALTER TABLE "personal"
  ADD CONSTRAINT "personal_datos_inferidos_objeto"
    CHECK (jsonb_typeof(datos_inferidos) = 'object'),
  ADD CONSTRAINT "personal_actor_sistema_importado_sin_acceso"
    CHECK (
      NOT es_actor_sistema_importado
      OR (NOT puede_iniciar_sesion AND usuario_id IS NULL)
    );

ALTER TABLE "clientes"
  ADD COLUMN IF NOT EXISTS "es_importado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "fila_importacion_id" UUID,
  ADD COLUMN IF NOT EXISTS "datos_inferidos" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "clientes"
  DROP CONSTRAINT IF EXISTS "clientes_datos_inferidos_objeto",
  DROP CONSTRAINT IF EXISTS "clientes_importado_linea_origen",
  DROP CONSTRAINT IF EXISTS "cliente_importacion_fila_organizacion_fk";

ALTER TABLE "clientes"
  ADD CONSTRAINT "clientes_datos_inferidos_objeto"
    CHECK (jsonb_typeof(datos_inferidos) = 'object'),
  ADD CONSTRAINT "clientes_importado_linea_origen"
    CHECK (NOT es_importado OR fila_importacion_id IS NOT NULL),
  ADD CONSTRAINT "cliente_importacion_fila_organizacion_fk"
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES "filas_importacion"(id, organizacion_id)
    ON DELETE RESTRICT;

DROP INDEX IF EXISTS "clientes_importados_fila_unica";
CREATE UNIQUE INDEX "clientes_importados_fila_unica"
  ON "clientes" (organizacion_id, fila_importacion_id)
  WHERE fila_importacion_id IS NOT NULL;

ALTER TABLE "cuentas_caja"
  ADD COLUMN IF NOT EXISTS "es_importada" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "datos_inferidos" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "cuentas_caja"
  DROP CONSTRAINT IF EXISTS "cuentas_caja_datos_inferidos_objeto";

ALTER TABLE "cuentas_caja"
  ADD CONSTRAINT "cuentas_caja_datos_inferidos_objeto"
    CHECK (jsonb_typeof(datos_inferidos) = 'object');

ALTER TABLE "unidades_vehiculos"
  ADD COLUMN IF NOT EXISTS "es_importada" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "fila_importacion_id" UUID,
  ADD COLUMN IF NOT EXISTS "datos_inferidos" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "unidades_vehiculos"
  DROP CONSTRAINT IF EXISTS "unidades_vehiculos_datos_inferidos_objeto",
  DROP CONSTRAINT IF EXISTS "unidades_vehiculos_importada_linea_origen",
  DROP CONSTRAINT IF EXISTS "unidad_importacion_fila_organizacion_fk";

ALTER TABLE "unidades_vehiculos"
  ADD CONSTRAINT "unidades_vehiculos_datos_inferidos_objeto"
    CHECK (jsonb_typeof(datos_inferidos) = 'object'),
  ADD CONSTRAINT "unidades_vehiculos_importada_linea_origen"
    CHECK (NOT es_importada OR fila_importacion_id IS NOT NULL),
  ADD CONSTRAINT "unidad_importacion_fila_organizacion_fk"
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES "filas_importacion"(id, organizacion_id)
    ON DELETE RESTRICT;

DROP INDEX IF EXISTS "unidades_vehiculos_importadas_fila_unica";
CREATE UNIQUE INDEX "unidades_vehiculos_importadas_fila_unica"
  ON "unidades_vehiculos" (organizacion_id, fila_importacion_id)
  WHERE fila_importacion_id IS NOT NULL;

ALTER TABLE "operaciones"
  ADD COLUMN IF NOT EXISTS "es_importada" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "precios_referencia_completos" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "fila_importacion_id" UUID,
  ADD COLUMN IF NOT EXISTS "datos_inferidos" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ALTER COLUMN "precio_lista" DROP NOT NULL,
  ALTER COLUMN "precio_minimo" DROP NOT NULL;

ALTER TABLE "operaciones"
  DROP CONSTRAINT IF EXISTS "operacion_precios_valido",
  DROP CONSTRAINT IF EXISTS "operaciones_datos_inferidos_objeto",
  DROP CONSTRAINT IF EXISTS "operaciones_importada_linea_origen",
  DROP CONSTRAINT IF EXISTS "operacion_importacion_fila_organizacion_fk";

ALTER TABLE "operaciones"
  ADD CONSTRAINT "operacion_precios_valido" CHECK (
    precio_acordado > 0
    AND (
      (
        precios_referencia_completos
        AND precio_lista IS NOT NULL
        AND precio_minimo IS NOT NULL
        AND precio_lista >= 0
        AND precio_minimo >= 0
        AND precio_minimo <= precio_lista
      )
      OR (
        es_importada
        AND NOT precios_referencia_completos
        AND precio_lista IS NULL
        AND precio_minimo IS NULL
      )
    )
  ),
  ADD CONSTRAINT "operaciones_datos_inferidos_objeto"
    CHECK (jsonb_typeof(datos_inferidos) = 'object'),
  ADD CONSTRAINT "operaciones_importada_linea_origen"
    CHECK (NOT es_importada OR fila_importacion_id IS NOT NULL),
  ADD CONSTRAINT "operacion_importacion_fila_organizacion_fk"
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES "filas_importacion"(id, organizacion_id)
    ON DELETE RESTRICT;

DROP INDEX IF EXISTS "operaciones_importadas_fila_unica";
CREATE UNIQUE INDEX "operaciones_importadas_fila_unica"
  ON "operaciones" (organizacion_id, fila_importacion_id)
  WHERE fila_importacion_id IS NOT NULL;

ALTER TABLE "componentes_pago_operacion"
  ADD COLUMN IF NOT EXISTS "es_importado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "fila_importacion_id" UUID,
  ADD COLUMN IF NOT EXISTS "datos_inferidos" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "componentes_pago_operacion"
  DROP CONSTRAINT IF EXISTS "componentes_pago_datos_inferidos_objeto",
  DROP CONSTRAINT IF EXISTS "componentes_pago_importado_linea_origen",
  DROP CONSTRAINT IF EXISTS "componente_pago_importacion_fila_organizacion_fk";

ALTER TABLE "componentes_pago_operacion"
  ADD CONSTRAINT "componentes_pago_datos_inferidos_objeto"
    CHECK (jsonb_typeof(datos_inferidos) = 'object'),
  ADD CONSTRAINT "componentes_pago_importado_linea_origen"
    CHECK (NOT es_importado OR fila_importacion_id IS NOT NULL),
  ADD CONSTRAINT "componente_pago_importacion_fila_organizacion_fk"
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES "filas_importacion"(id, organizacion_id)
    ON DELETE RESTRICT;

DROP INDEX IF EXISTS "componentes_pago_importados_fila_unica";
CREATE UNIQUE INDEX "componentes_pago_importados_fila_unica"
  ON "componentes_pago_operacion" (organizacion_id, fila_importacion_id)
  WHERE fila_importacion_id IS NOT NULL;

ALTER TABLE "gastos"
  ADD COLUMN IF NOT EXISTS "es_importado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "fila_importacion_id" UUID,
  ADD COLUMN IF NOT EXISTS "pagador_original" TEXT,
  ADD COLUMN IF NOT EXISTS "recuperable_original" TEXT,
  ADD COLUMN IF NOT EXISTS "referencia_origen" TEXT,
  ADD COLUMN IF NOT EXISTS "vin_origen_mostrado" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "vin_origen_normalizado" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "datos_inferidos" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "gastos"
  DROP CONSTRAINT IF EXISTS "gastos_datos_inferidos_objeto",
  DROP CONSTRAINT IF EXISTS "gastos_importado_linea_origen",
  DROP CONSTRAINT IF EXISTS "gasto_vin_origen_formato",
  DROP CONSTRAINT IF EXISTS "gasto_importacion_fila_organizacion_fk";

ALTER TABLE "gastos"
  ADD CONSTRAINT "gastos_datos_inferidos_objeto"
    CHECK (jsonb_typeof(datos_inferidos) = 'object'),
  ADD CONSTRAINT "gastos_importado_linea_origen"
    CHECK (NOT es_importado OR fila_importacion_id IS NOT NULL),
  ADD CONSTRAINT "gasto_vin_origen_formato"
    CHECK (
      vin_origen_normalizado IS NULL
      OR vin_origen_normalizado ~ '^[A-Z0-9]{6,32}$'
    ),
  ADD CONSTRAINT "gasto_importacion_fila_organizacion_fk"
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES "filas_importacion"(id, organizacion_id)
    ON DELETE RESTRICT;

DROP INDEX IF EXISTS "gastos_importados_fila_unica";
CREATE UNIQUE INDEX "gastos_importados_fila_unica"
  ON "gastos" (organizacion_id, fila_importacion_id)
  WHERE fila_importacion_id IS NOT NULL;

-- Manual 003 already created this FK. It depends on the unique key below, so
-- release it before converging the ingresos constraints and recreate it later.
ALTER TABLE "movimientos_caja"
  DROP CONSTRAINT IF EXISTS "movimiento_caja_ingreso_organizacion_fk";

CREATE TABLE IF NOT EXISTS "ingresos" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "sucursal_id" UUID NOT NULL,
  "fila_importacion_id" UUID NOT NULL,
  "fecha_ingreso" DATE NOT NULL,
  "tipo_original" VARCHAR(120) NOT NULL,
  "descripcion" TEXT NOT NULL,
  "importe" NUMERIC(18, 2) NOT NULL,
  "estado_registro" VARCHAR(40) NOT NULL,
  "estado_original" VARCHAR(120),
  "observaciones" TEXT,
  "cobrado_por_original" TEXT,
  "cobrado_por_personal_id" UUID,
  "cuenta_caja_id" UUID,
  "es_transferencia" BOOLEAN NOT NULL DEFAULT false,
  "requiere_conciliacion" BOOLEAN NOT NULL DEFAULT false,
  "datos_inferidos" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "creado_en" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "ingresos"
  DROP CONSTRAINT IF EXISTS "ingresos_organizacion_id_fkey",
  DROP CONSTRAINT IF EXISTS "ingresos_sucursal_id_fkey",
  DROP CONSTRAINT IF EXISTS "ingresos_fila_importacion_id_fkey",
  DROP CONSTRAINT IF EXISTS "ingresos_cobrado_por_personal_id_fkey",
  DROP CONSTRAINT IF EXISTS "ingresos_cuenta_caja_id_fkey",
  DROP CONSTRAINT IF EXISTS "ingresos_importe_valido",
  DROP CONSTRAINT IF EXISTS "ingresos_estado_registro_valido",
  DROP CONSTRAINT IF EXISTS "ingresos_conciliacion_estado_valido",
  DROP CONSTRAINT IF EXISTS "ingresos_datos_inferidos_objeto",
  DROP CONSTRAINT IF EXISTS "ingresos_id_organizacion_unico",
  DROP CONSTRAINT IF EXISTS "ingresos_fila_organizacion_unico",
  DROP CONSTRAINT IF EXISTS "ingreso_sucursal_organizacion_fk",
  DROP CONSTRAINT IF EXISTS "ingreso_fila_organizacion_fk",
  DROP CONSTRAINT IF EXISTS "ingreso_cobrador_organizacion_fk",
  DROP CONSTRAINT IF EXISTS "ingreso_cuenta_organizacion_fk";

ALTER TABLE "ingresos"
  ADD CONSTRAINT "ingresos_organizacion_id_fkey"
    FOREIGN KEY (organizacion_id) REFERENCES "organizaciones"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "ingresos_sucursal_id_fkey"
    FOREIGN KEY (sucursal_id) REFERENCES "sucursales"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "ingresos_fila_importacion_id_fkey"
    FOREIGN KEY (fila_importacion_id) REFERENCES "filas_importacion"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "ingresos_cobrado_por_personal_id_fkey"
    FOREIGN KEY (cobrado_por_personal_id) REFERENCES "personal"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "ingresos_cuenta_caja_id_fkey"
    FOREIGN KEY (cuenta_caja_id) REFERENCES "cuentas_caja"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "ingresos_importe_valido" CHECK (importe > 0),
  ADD CONSTRAINT "ingresos_estado_registro_valido" CHECK (
    estado_registro IN ('COBRADO', 'PENDIENTE', 'PENDIENTE_CONCILIACION', 'ANULADO')
  ),
  ADD CONSTRAINT "ingresos_conciliacion_estado_valido" CHECK (
    (requiere_conciliacion AND estado_registro = 'PENDIENTE_CONCILIACION')
    OR NOT requiere_conciliacion
  ),
  ADD CONSTRAINT "ingresos_datos_inferidos_objeto"
    CHECK (jsonb_typeof(datos_inferidos) = 'object'),
  ADD CONSTRAINT "ingresos_id_organizacion_unico"
    UNIQUE (id, organizacion_id),
  ADD CONSTRAINT "ingresos_fila_organizacion_unico"
    UNIQUE (organizacion_id, fila_importacion_id),
  ADD CONSTRAINT "ingreso_sucursal_organizacion_fk"
    FOREIGN KEY (sucursal_id, organizacion_id)
    REFERENCES "sucursales"(id, organizacion_id),
  ADD CONSTRAINT "ingreso_fila_organizacion_fk"
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES "filas_importacion"(id, organizacion_id),
  ADD CONSTRAINT "ingreso_cobrador_organizacion_fk"
    FOREIGN KEY (cobrado_por_personal_id, organizacion_id)
    REFERENCES "personal"(id, organizacion_id),
  ADD CONSTRAINT "ingreso_cuenta_organizacion_fk"
    FOREIGN KEY (cuenta_caja_id, organizacion_id)
    REFERENCES "cuentas_caja"(id, organizacion_id);

DROP INDEX IF EXISTS "ingresos_sucursal_fecha_indice";
CREATE INDEX "ingresos_sucursal_fecha_indice"
  ON "ingresos" (sucursal_id, fecha_ingreso DESC);
DROP INDEX IF EXISTS "ingresos_cuenta_fecha_indice";
CREATE INDEX "ingresos_cuenta_fecha_indice"
  ON "ingresos" (cuenta_caja_id, fecha_ingreso DESC)
  WHERE cuenta_caja_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS "polizas_seguros" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "sucursal_id" UUID NOT NULL,
  "fila_importacion_id" UUID NOT NULL,
  "cliente_id" UUID,
  "operacion_id" UUID,
  "unidad_vehiculo_id" UUID,
  "fecha_poliza" DATE NOT NULL,
  "aseguradora" TEXT,
  "referencia_documento_cliente" VARCHAR(30),
  "referencia_nombre_cliente" VARCHAR(180),
  "referencia_vehiculo" TEXT,
  "importe" NUMERIC(18, 2) NOT NULL,
  "estado_registro" VARCHAR(60) NOT NULL DEFAULT 'HISTORICA_SIN_VIGENCIA_CONFIRMADA',
  "datos_inferidos" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "creado_en" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "polizas_seguros"
  DROP CONSTRAINT IF EXISTS "polizas_seguros_organizacion_id_fkey",
  DROP CONSTRAINT IF EXISTS "polizas_seguros_sucursal_id_fkey",
  DROP CONSTRAINT IF EXISTS "polizas_seguros_fila_importacion_id_fkey",
  DROP CONSTRAINT IF EXISTS "polizas_seguros_cliente_id_fkey",
  DROP CONSTRAINT IF EXISTS "polizas_seguros_operacion_id_fkey",
  DROP CONSTRAINT IF EXISTS "polizas_seguros_unidad_vehiculo_id_fkey",
  DROP CONSTRAINT IF EXISTS "poliza_importe_valido",
  DROP CONSTRAINT IF EXISTS "poliza_estado_registro_valido",
  DROP CONSTRAINT IF EXISTS "polizas_seguros_datos_inferidos_objeto",
  DROP CONSTRAINT IF EXISTS "polizas_seguros_id_organizacion_unico",
  DROP CONSTRAINT IF EXISTS "polizas_seguros_fila_organizacion_unico",
  DROP CONSTRAINT IF EXISTS "poliza_sucursal_organizacion_fk",
  DROP CONSTRAINT IF EXISTS "poliza_fila_organizacion_fk",
  DROP CONSTRAINT IF EXISTS "poliza_cliente_organizacion_fk",
  DROP CONSTRAINT IF EXISTS "poliza_operacion_organizacion_fk",
  DROP CONSTRAINT IF EXISTS "poliza_unidad_organizacion_fk";

ALTER TABLE "polizas_seguros"
  ADD CONSTRAINT "polizas_seguros_organizacion_id_fkey"
    FOREIGN KEY (organizacion_id) REFERENCES "organizaciones"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "polizas_seguros_sucursal_id_fkey"
    FOREIGN KEY (sucursal_id) REFERENCES "sucursales"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "polizas_seguros_fila_importacion_id_fkey"
    FOREIGN KEY (fila_importacion_id) REFERENCES "filas_importacion"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "polizas_seguros_cliente_id_fkey"
    FOREIGN KEY (cliente_id) REFERENCES "clientes"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "polizas_seguros_operacion_id_fkey"
    FOREIGN KEY (operacion_id) REFERENCES "operaciones"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "polizas_seguros_unidad_vehiculo_id_fkey"
    FOREIGN KEY (unidad_vehiculo_id) REFERENCES "unidades_vehiculos"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "poliza_importe_valido" CHECK (importe > 0),
  ADD CONSTRAINT "poliza_estado_registro_valido" CHECK (
    estado_registro IN (
      'HISTORICA_SIN_VIGENCIA_CONFIRMADA', 'VIGENTE', 'VENCIDA', 'CANCELADA'
    )
  ),
  ADD CONSTRAINT "polizas_seguros_datos_inferidos_objeto"
    CHECK (jsonb_typeof(datos_inferidos) = 'object'),
  ADD CONSTRAINT "polizas_seguros_id_organizacion_unico"
    UNIQUE (id, organizacion_id),
  ADD CONSTRAINT "polizas_seguros_fila_organizacion_unico"
    UNIQUE (organizacion_id, fila_importacion_id),
  ADD CONSTRAINT "poliza_sucursal_organizacion_fk"
    FOREIGN KEY (sucursal_id, organizacion_id)
    REFERENCES "sucursales"(id, organizacion_id),
  ADD CONSTRAINT "poliza_fila_organizacion_fk"
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES "filas_importacion"(id, organizacion_id),
  ADD CONSTRAINT "poliza_cliente_organizacion_fk"
    FOREIGN KEY (cliente_id, organizacion_id)
    REFERENCES "clientes"(id, organizacion_id),
  ADD CONSTRAINT "poliza_operacion_organizacion_fk"
    FOREIGN KEY (operacion_id, organizacion_id)
    REFERENCES "operaciones"(id, organizacion_id),
  ADD CONSTRAINT "poliza_unidad_organizacion_fk"
    FOREIGN KEY (unidad_vehiculo_id, organizacion_id)
    REFERENCES "unidades_vehiculos"(id, organizacion_id);

DROP INDEX IF EXISTS "polizas_seguros_sucursal_fecha_indice";
CREATE INDEX "polizas_seguros_sucursal_fecha_indice"
  ON "polizas_seguros" (sucursal_id, fecha_poliza DESC);
DROP INDEX IF EXISTS "polizas_seguros_cliente_indice";
CREATE INDEX "polizas_seguros_cliente_indice"
  ON "polizas_seguros" (cliente_id) WHERE cliente_id IS NOT NULL;
DROP INDEX IF EXISTS "polizas_seguros_unidad_indice";
CREATE INDEX "polizas_seguros_unidad_indice"
  ON "polizas_seguros" (unidad_vehiculo_id) WHERE unidad_vehiculo_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS "prospectos" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "sucursal_id" UUID NOT NULL,
  "fila_importacion_id" UUID NOT NULL,
  "bloque_origen" VARCHAR(40) NOT NULL,
  "nombre_completo" VARCHAR(180),
  "documento_mostrado" VARCHAR(40),
  "documento_normalizado" VARCHAR(30),
  "telefono" VARCHAR(40),
  "estado_original" VARCHAR(160),
  "comision_referido" NUMERIC(18, 2),
  "comision_referido_original" TEXT,
  "datos_inferidos" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "creado_en" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "prospectos"
  DROP CONSTRAINT IF EXISTS "prospectos_organizacion_id_fkey",
  DROP CONSTRAINT IF EXISTS "prospectos_sucursal_id_fkey",
  DROP CONSTRAINT IF EXISTS "prospectos_fila_importacion_id_fkey",
  DROP CONSTRAINT IF EXISTS "prospectos_identidad_origen_presente",
  DROP CONSTRAINT IF EXISTS "prospectos_comision_valida",
  DROP CONSTRAINT IF EXISTS "prospectos_datos_inferidos_objeto",
  DROP CONSTRAINT IF EXISTS "prospectos_id_organizacion_unico",
  DROP CONSTRAINT IF EXISTS "prospectos_fila_bloque_organizacion_unico",
  DROP CONSTRAINT IF EXISTS "prospecto_sucursal_organizacion_fk",
  DROP CONSTRAINT IF EXISTS "prospecto_fila_organizacion_fk";

ALTER TABLE "prospectos"
  ADD CONSTRAINT "prospectos_organizacion_id_fkey"
    FOREIGN KEY (organizacion_id) REFERENCES "organizaciones"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "prospectos_sucursal_id_fkey"
    FOREIGN KEY (sucursal_id) REFERENCES "sucursales"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "prospectos_fila_importacion_id_fkey"
    FOREIGN KEY (fila_importacion_id) REFERENCES "filas_importacion"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "prospectos_identidad_origen_presente" CHECK (
    nombre_completo IS NOT NULL
    OR documento_mostrado IS NOT NULL
    OR telefono IS NOT NULL
  ),
  ADD CONSTRAINT "prospectos_comision_valida"
    CHECK (comision_referido IS NULL OR comision_referido >= 0),
  ADD CONSTRAINT "prospectos_datos_inferidos_objeto"
    CHECK (jsonb_typeof(datos_inferidos) = 'object'),
  ADD CONSTRAINT "prospectos_id_organizacion_unico"
    UNIQUE (id, organizacion_id),
  ADD CONSTRAINT "prospectos_fila_bloque_organizacion_unico"
    UNIQUE (organizacion_id, fila_importacion_id, bloque_origen),
  ADD CONSTRAINT "prospecto_sucursal_organizacion_fk"
    FOREIGN KEY (sucursal_id, organizacion_id)
    REFERENCES "sucursales"(id, organizacion_id),
  ADD CONSTRAINT "prospecto_fila_organizacion_fk"
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES "filas_importacion"(id, organizacion_id);

DROP INDEX IF EXISTS "prospectos_sucursal_estado_indice";
CREATE INDEX "prospectos_sucursal_estado_indice"
  ON "prospectos" (sucursal_id, estado_original);
DROP INDEX IF EXISTS "prospectos_documento_indice";
CREATE INDEX "prospectos_documento_indice"
  ON "prospectos" (organizacion_id, documento_normalizado)
  WHERE documento_normalizado IS NOT NULL;

CREATE TABLE IF NOT EXISTS "registros_inventario_importados" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "sucursal_id" UUID NOT NULL,
  "fila_importacion_id" UUID NOT NULL,
  "hoja_origen" VARCHAR(20) NOT NULL,
  "fecha_registro" DATE,
  "descripcion" TEXT,
  "vin_mostrado" VARCHAR(40),
  "vin_normalizado" VARCHAR(32),
  "unidad_vehiculo_id" UUID,
  "estado_original" VARCHAR(120),
  "importe" NUMERIC(18, 2),
  "costo" NUMERIC(18, 2),
  "datos_inferidos" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "creado_en" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "registros_inventario_importados"
  DROP CONSTRAINT IF EXISTS "registros_inventario_importados_organizacion_id_fkey",
  DROP CONSTRAINT IF EXISTS "registros_inventario_importados_sucursal_id_fkey",
  DROP CONSTRAINT IF EXISTS "registros_inventario_importados_fila_importacion_id_fkey",
  DROP CONSTRAINT IF EXISTS "registros_inventario_importados_unidad_vehiculo_id_fkey",
  DROP CONSTRAINT IF EXISTS "registros_inventario_hoja_origen_valida",
  DROP CONSTRAINT IF EXISTS "registros_inventario_vin_formato",
  DROP CONSTRAINT IF EXISTS "registros_inventario_importe_valido",
  DROP CONSTRAINT IF EXISTS "registros_inventario_costo_valido",
  DROP CONSTRAINT IF EXISTS "registros_inventario_datos_inferidos_objeto",
  DROP CONSTRAINT IF EXISTS "registros_inventario_importados_id_organizacion_unico",
  DROP CONSTRAINT IF EXISTS "registros_inventario_importados_fila_organizacion_unico",
  DROP CONSTRAINT IF EXISTS "registro_inventario_sucursal_organizacion_fk",
  DROP CONSTRAINT IF EXISTS "registro_inventario_fila_organizacion_fk",
  DROP CONSTRAINT IF EXISTS "registro_inventario_unidad_organizacion_fk";

ALTER TABLE "registros_inventario_importados"
  ADD CONSTRAINT "registros_inventario_importados_organizacion_id_fkey"
    FOREIGN KEY (organizacion_id) REFERENCES "organizaciones"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "registros_inventario_importados_sucursal_id_fkey"
    FOREIGN KEY (sucursal_id) REFERENCES "sucursales"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "registros_inventario_importados_fila_importacion_id_fkey"
    FOREIGN KEY (fila_importacion_id) REFERENCES "filas_importacion"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "registros_inventario_importados_unidad_vehiculo_id_fkey"
    FOREIGN KEY (unidad_vehiculo_id) REFERENCES "unidades_vehiculos"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "registros_inventario_hoja_origen_valida"
    CHECK (hoja_origen IN ('SERGIO', 'SIAM')),
  ADD CONSTRAINT "registros_inventario_vin_formato" CHECK (
    vin_normalizado IS NULL OR vin_normalizado ~ '^[A-Z0-9]{6,32}$'
  ),
  ADD CONSTRAINT "registros_inventario_importe_valido"
    CHECK (importe IS NULL OR importe >= 0),
  ADD CONSTRAINT "registros_inventario_costo_valido"
    CHECK (costo IS NULL OR costo >= 0),
  ADD CONSTRAINT "registros_inventario_datos_inferidos_objeto"
    CHECK (jsonb_typeof(datos_inferidos) = 'object'),
  ADD CONSTRAINT "registros_inventario_importados_id_organizacion_unico"
    UNIQUE (id, organizacion_id),
  ADD CONSTRAINT "registros_inventario_importados_fila_organizacion_unico"
    UNIQUE (organizacion_id, fila_importacion_id),
  ADD CONSTRAINT "registro_inventario_sucursal_organizacion_fk"
    FOREIGN KEY (sucursal_id, organizacion_id)
    REFERENCES "sucursales"(id, organizacion_id),
  ADD CONSTRAINT "registro_inventario_fila_organizacion_fk"
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES "filas_importacion"(id, organizacion_id),
  ADD CONSTRAINT "registro_inventario_unidad_organizacion_fk"
    FOREIGN KEY (unidad_vehiculo_id, organizacion_id)
    REFERENCES "unidades_vehiculos"(id, organizacion_id);

DROP INDEX IF EXISTS "registros_inventario_importados_sucursal_fecha_indice";
CREATE INDEX "registros_inventario_importados_sucursal_fecha_indice"
  ON "registros_inventario_importados" (sucursal_id, fecha_registro DESC);
DROP INDEX IF EXISTS "registros_inventario_importados_vin_indice";
CREATE INDEX "registros_inventario_importados_vin_indice"
  ON "registros_inventario_importados" (organizacion_id, vin_normalizado)
  WHERE vin_normalizado IS NOT NULL;

ALTER TABLE "movimientos_caja"
  ADD COLUMN IF NOT EXISTS "ingreso_id" UUID,
  ADD COLUMN IF NOT EXISTS "es_importado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "fila_importacion_id" UUID,
  ADD COLUMN IF NOT EXISTS "datos_inferidos" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "movimientos_caja"
  DROP CONSTRAINT IF EXISTS "caja_movimiento_origen_contrato",
  DROP CONSTRAINT IF EXISTS "movimientos_caja_datos_inferidos_objeto",
  DROP CONSTRAINT IF EXISTS "movimientos_caja_importado_linea_origen",
  DROP CONSTRAINT IF EXISTS "movimiento_caja_ingreso_contrato",
  DROP CONSTRAINT IF EXISTS "movimiento_caja_ingreso_organizacion_fk",
  DROP CONSTRAINT IF EXISTS "movimiento_caja_importacion_fila_organizacion_fk";

ALTER TABLE "movimientos_caja"
  ADD CONSTRAINT "caja_movimiento_origen_contrato" CHECK (
    tipo_movimiento = 'AJUSTE'
    OR (
      (cobranza_id IS NOT NULL)::integer
      + (transferencia_id IS NOT NULL)::integer
      + (gasto_id IS NOT NULL)::integer
      + (compra_proveedor_id IS NOT NULL)::integer
      + (liquidacion_comision_id IS NOT NULL)::integer
      + (ingreso_id IS NOT NULL)::integer
      + (revierte_a_id IS NOT NULL)::integer = 1
    )
  ),
  ADD CONSTRAINT "movimientos_caja_datos_inferidos_objeto"
    CHECK (jsonb_typeof(datos_inferidos) = 'object'),
  ADD CONSTRAINT "movimientos_caja_importado_linea_origen"
    CHECK (NOT es_importado OR fila_importacion_id IS NOT NULL),
  ADD CONSTRAINT "movimiento_caja_ingreso_contrato"
    CHECK (
      ingreso_id IS NULL
      OR (tipo_movimiento = 'INGRESO' AND direccion = 'CREDITO')
    ),
  ADD CONSTRAINT "movimiento_caja_ingreso_organizacion_fk"
    FOREIGN KEY (ingreso_id, organizacion_id)
    REFERENCES "ingresos"(id, organizacion_id),
  ADD CONSTRAINT "movimiento_caja_importacion_fila_organizacion_fk"
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES "filas_importacion"(id, organizacion_id)
    ON DELETE RESTRICT;

DROP INDEX IF EXISTS "movimientos_caja_ingreso_unico";
CREATE UNIQUE INDEX "movimientos_caja_ingreso_unico"
  ON "movimientos_caja" (ingreso_id)
  WHERE ingreso_id IS NOT NULL;
DROP INDEX IF EXISTS "movimientos_caja_importados_fila_unica";
CREATE UNIQUE INDEX "movimientos_caja_importados_fila_unica"
  ON "movimientos_caja" (organizacion_id, fila_importacion_id)
  WHERE fila_importacion_id IS NOT NULL;

CREATE OR REPLACE FUNCTION "luma_validar_operacion_invariantes"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  total_planificado NUMERIC(18, 2);
BEGIN
  IF NEW.estado_operacion IN ('APROBADA', 'CERRADA')
    AND NEW.precios_referencia_completos
    AND NEW.precio_acordado < NEW.precio_minimo
    AND NOT EXISTS (
      SELECT 1
      FROM aprobaciones_operacion aprobacion
      WHERE aprobacion.operacion_id = NEW.id
        AND aprobacion.decision = 'APROBADA'
        AND aprobacion.precio_acordado_referencia = NEW.precio_acordado
        AND aprobacion.precio_minimo_referencia = NEW.precio_minimo
    )
  THEN
    RAISE EXCEPTION
      'La operacion % esta por debajo del precio minimo y requiere una aprobacion correspondiente',
      NEW.id;
  END IF;

  IF NEW.estado_entrega = 'ENTREGADO'
    AND (
      NEW.unidad_vehiculo_id IS NULL
      OR NEW.estado_operacion NOT IN ('APROBADA', 'CERRADA')
    )
  THEN
    RAISE EXCEPTION
      'La operacion entregada % requiere una unidad asignada y estado aprobado',
      NEW.id;
  END IF;

  IF NEW.estado_operacion = 'CERRADA' THEN
    SELECT coalesce(sum(importe_esperado), 0)
    INTO total_planificado
    FROM componentes_pago_operacion
    WHERE operacion_id = NEW.id
      AND estado_pago <> 'CANCELADA';

    IF total_planificado <> NEW.precio_acordado THEN
      RAISE EXCEPTION
        'La operacion cerrada % tiene un total planificado de pagos %, esperado %',
        NEW.id,
        total_planificado,
        NEW.precio_acordado;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "disparador_ingresos_actualizado_en" ON "ingresos";
CREATE TRIGGER "disparador_ingresos_actualizado_en"
BEFORE UPDATE ON "ingresos"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

DROP TRIGGER IF EXISTS "disparador_polizas_seguros_actualizado_en" ON "polizas_seguros";
CREATE TRIGGER "disparador_polizas_seguros_actualizado_en"
BEFORE UPDATE ON "polizas_seguros"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

DROP TRIGGER IF EXISTS "disparador_prospectos_actualizado_en" ON "prospectos";
CREATE TRIGGER "disparador_prospectos_actualizado_en"
BEFORE UPDATE ON "prospectos"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

DROP TRIGGER IF EXISTS "disparador_registros_inventario_importados_actualizado_en"
  ON "registros_inventario_importados";
CREATE TRIGGER "disparador_registros_inventario_importados_actualizado_en"
BEFORE UPDATE ON "registros_inventario_importados"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

ALTER TABLE "ingresos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ingresos" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_ingresos_organizacion" ON "ingresos";
CREATE POLICY "politica_ingresos_organizacion" ON "ingresos"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

ALTER TABLE "polizas_seguros" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "polizas_seguros" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_polizas_seguros_organizacion" ON "polizas_seguros";
CREATE POLICY "politica_polizas_seguros_organizacion" ON "polizas_seguros"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

ALTER TABLE "prospectos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospectos" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_prospectos_organizacion" ON "prospectos";
CREATE POLICY "politica_prospectos_organizacion" ON "prospectos"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

ALTER TABLE "registros_inventario_importados" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "registros_inventario_importados" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_registros_inventario_importados_organizacion"
  ON "registros_inventario_importados";
CREATE POLICY "politica_registros_inventario_importados_organizacion"
ON "registros_inventario_importados"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

-- Fail instead of silently accepting an incompatible pre-existing table or
-- column. Typmods are intentionally ignored because manual 003 used the
-- equivalent unqualified timestamptz spelling.
DO $$
DECLARE
  expected RECORD;
  actual_type OID;
  actual_not_null BOOLEAN;
BEGIN
  FOR expected IN
    SELECT *
    FROM (VALUES
      ('personal', 'es_actor_sistema_importado', 'boolean', true),
      ('personal', 'datos_inferidos', 'jsonb', true),
      ('clientes', 'es_importado', 'boolean', true),
      ('clientes', 'fila_importacion_id', 'uuid', false),
      ('clientes', 'datos_inferidos', 'jsonb', true),
      ('cuentas_caja', 'es_importada', 'boolean', true),
      ('cuentas_caja', 'datos_inferidos', 'jsonb', true),
      ('unidades_vehiculos', 'es_importada', 'boolean', true),
      ('unidades_vehiculos', 'fila_importacion_id', 'uuid', false),
      ('unidades_vehiculos', 'datos_inferidos', 'jsonb', true),
      ('operaciones', 'precio_lista', 'numeric', false),
      ('operaciones', 'precio_minimo', 'numeric', false),
      ('operaciones', 'es_importada', 'boolean', true),
      ('operaciones', 'precios_referencia_completos', 'boolean', true),
      ('operaciones', 'fila_importacion_id', 'uuid', false),
      ('operaciones', 'datos_inferidos', 'jsonb', true),
      ('componentes_pago_operacion', 'es_importado', 'boolean', true),
      ('componentes_pago_operacion', 'fila_importacion_id', 'uuid', false),
      ('componentes_pago_operacion', 'datos_inferidos', 'jsonb', true),
      ('gastos', 'es_importado', 'boolean', true),
      ('gastos', 'fila_importacion_id', 'uuid', false),
      ('gastos', 'pagador_original', 'text', false),
      ('gastos', 'recuperable_original', 'text', false),
      ('gastos', 'referencia_origen', 'text', false),
      ('gastos', 'vin_origen_mostrado', 'character varying', false),
      ('gastos', 'vin_origen_normalizado', 'character varying', false),
      ('gastos', 'datos_inferidos', 'jsonb', true),
      ('ingresos', 'id', 'uuid', true),
      ('ingresos', 'organizacion_id', 'uuid', true),
      ('ingresos', 'sucursal_id', 'uuid', true),
      ('ingresos', 'fila_importacion_id', 'uuid', true),
      ('ingresos', 'fecha_ingreso', 'date', true),
      ('ingresos', 'tipo_original', 'character varying', true),
      ('ingresos', 'descripcion', 'text', true),
      ('ingresos', 'importe', 'numeric', true),
      ('ingresos', 'estado_registro', 'character varying', true),
      ('ingresos', 'datos_inferidos', 'jsonb', true),
      ('polizas_seguros', 'id', 'uuid', true),
      ('polizas_seguros', 'organizacion_id', 'uuid', true),
      ('polizas_seguros', 'sucursal_id', 'uuid', true),
      ('polizas_seguros', 'fila_importacion_id', 'uuid', true),
      ('polizas_seguros', 'fecha_poliza', 'date', true),
      ('polizas_seguros', 'importe', 'numeric', true),
      ('polizas_seguros', 'datos_inferidos', 'jsonb', true),
      ('prospectos', 'id', 'uuid', true),
      ('prospectos', 'organizacion_id', 'uuid', true),
      ('prospectos', 'sucursal_id', 'uuid', true),
      ('prospectos', 'fila_importacion_id', 'uuid', true),
      ('prospectos', 'bloque_origen', 'character varying', true),
      ('prospectos', 'datos_inferidos', 'jsonb', true),
      ('registros_inventario_importados', 'id', 'uuid', true),
      ('registros_inventario_importados', 'organizacion_id', 'uuid', true),
      ('registros_inventario_importados', 'sucursal_id', 'uuid', true),
      ('registros_inventario_importados', 'fila_importacion_id', 'uuid', true),
      ('registros_inventario_importados', 'hoja_origen', 'character varying', true),
      ('registros_inventario_importados', 'datos_inferidos', 'jsonb', true),
      ('movimientos_caja', 'ingreso_id', 'uuid', false),
      ('movimientos_caja', 'es_importado', 'boolean', true),
      ('movimientos_caja', 'fila_importacion_id', 'uuid', false),
      ('movimientos_caja', 'datos_inferidos', 'jsonb', true)
    ) AS definitions(table_name, column_name, type_name, not_null)
  LOOP
    SELECT attribute.atttypid, attribute.attnotnull
    INTO actual_type, actual_not_null
    FROM pg_attribute attribute
    WHERE attribute.attrelid = format('public.%I', expected.table_name)::regclass
      AND attribute.attname = expected.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF actual_type IS NULL THEN
      RAISE EXCEPTION 'Missing expected column %.%',
        expected.table_name, expected.column_name;
    END IF;

    IF actual_type <> expected.type_name::regtype
      OR actual_not_null IS DISTINCT FROM expected.not_null
    THEN
      RAISE EXCEPTION
        'Incompatible column %.%: expected type % and not_null %, got type % and not_null %',
        expected.table_name,
        expected.column_name,
        expected.type_name,
        expected.not_null,
        actual_type::regtype,
        actual_not_null;
    END IF;
  END LOOP;
END
$$;

COMMIT;

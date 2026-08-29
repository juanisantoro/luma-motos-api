BEGIN;

-- Superficies de trazabilidad para importar el libro historico como datos de
-- prueba. No reemplazan la carga original de filas_importacion.

ALTER TABLE personal
  ADD COLUMN IF NOT EXISTS es_actor_sistema_importado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS datos_inferidos jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE personal
  ADD CONSTRAINT personal_datos_inferidos_objeto CHECK (
    jsonb_typeof(datos_inferidos) = 'object'
  ),
  ADD CONSTRAINT personal_actor_sistema_importado_sin_acceso CHECK (
    NOT es_actor_sistema_importado
    OR (NOT puede_iniciar_sesion AND usuario_id IS NULL)
  );

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS es_importado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fila_importacion_id uuid,
  ADD COLUMN IF NOT EXISTS datos_inferidos jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE clientes
  ADD CONSTRAINT clientes_datos_inferidos_objeto CHECK (
    jsonb_typeof(datos_inferidos) = 'object'
  ),
  ADD CONSTRAINT clientes_importado_linea_origen CHECK (
    NOT es_importado OR fila_importacion_id IS NOT NULL
  ),
  ADD CONSTRAINT cliente_importacion_fila_organizacion_fk
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES filas_importacion(id, organizacion_id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX clientes_importados_fila_unica
  ON clientes (organizacion_id, fila_importacion_id)
  WHERE fila_importacion_id IS NOT NULL;

ALTER TABLE cuentas_caja
  ADD COLUMN IF NOT EXISTS es_importada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS datos_inferidos jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE cuentas_caja
  ADD CONSTRAINT cuentas_caja_datos_inferidos_objeto CHECK (
    jsonb_typeof(datos_inferidos) = 'object'
  );

ALTER TABLE unidades_vehiculos
  ADD COLUMN IF NOT EXISTS es_importada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fila_importacion_id uuid,
  ADD COLUMN IF NOT EXISTS datos_inferidos jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE unidades_vehiculos
  ADD CONSTRAINT unidades_vehiculos_datos_inferidos_objeto CHECK (
    jsonb_typeof(datos_inferidos) = 'object'
  ),
  ADD CONSTRAINT unidades_vehiculos_importada_linea_origen CHECK (
    NOT es_importada OR fila_importacion_id IS NOT NULL
  ),
  ADD CONSTRAINT unidad_importacion_fila_organizacion_fk
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES filas_importacion(id, organizacion_id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX unidades_vehiculos_importadas_fila_unica
  ON unidades_vehiculos (organizacion_id, fila_importacion_id)
  WHERE fila_importacion_id IS NOT NULL;

ALTER TABLE operaciones
  ADD COLUMN IF NOT EXISTS es_importada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS precios_referencia_completos boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS fila_importacion_id uuid,
  ADD COLUMN IF NOT EXISTS datos_inferidos jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE operaciones
  ALTER COLUMN precio_lista DROP NOT NULL,
  ALTER COLUMN precio_minimo DROP NOT NULL;

ALTER TABLE operaciones
  DROP CONSTRAINT IF EXISTS operacion_precios_valido;

ALTER TABLE operaciones
  ADD CONSTRAINT operacion_precios_valido CHECK (
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
  ADD CONSTRAINT operaciones_datos_inferidos_objeto CHECK (
    jsonb_typeof(datos_inferidos) = 'object'
  ),
  ADD CONSTRAINT operaciones_importada_linea_origen CHECK (
    NOT es_importada OR fila_importacion_id IS NOT NULL
  ),
  ADD CONSTRAINT operacion_importacion_fila_organizacion_fk
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES filas_importacion(id, organizacion_id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX operaciones_importadas_fila_unica
  ON operaciones (organizacion_id, fila_importacion_id)
  WHERE fila_importacion_id IS NOT NULL;

ALTER TABLE componentes_pago_operacion
  ADD COLUMN IF NOT EXISTS es_importado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fila_importacion_id uuid,
  ADD COLUMN IF NOT EXISTS datos_inferidos jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE componentes_pago_operacion
  ADD CONSTRAINT componentes_pago_datos_inferidos_objeto CHECK (
    jsonb_typeof(datos_inferidos) = 'object'
  ),
  ADD CONSTRAINT componentes_pago_importado_linea_origen CHECK (
    NOT es_importado OR fila_importacion_id IS NOT NULL
  ),
  ADD CONSTRAINT componente_pago_importacion_fila_organizacion_fk
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES filas_importacion(id, organizacion_id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX componentes_pago_importados_fila_unica
  ON componentes_pago_operacion (organizacion_id, fila_importacion_id)
  WHERE fila_importacion_id IS NOT NULL;

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS es_importado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fila_importacion_id uuid,
  ADD COLUMN IF NOT EXISTS pagador_original text,
  ADD COLUMN IF NOT EXISTS recuperable_original text,
  ADD COLUMN IF NOT EXISTS referencia_origen text,
  ADD COLUMN IF NOT EXISTS vin_origen_mostrado varchar(40),
  ADD COLUMN IF NOT EXISTS vin_origen_normalizado varchar(32),
  ADD COLUMN IF NOT EXISTS datos_inferidos jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE gastos
  ADD CONSTRAINT gastos_datos_inferidos_objeto CHECK (
    jsonb_typeof(datos_inferidos) = 'object'
  ),
  ADD CONSTRAINT gastos_importado_linea_origen CHECK (
    NOT es_importado OR fila_importacion_id IS NOT NULL
  ),
  ADD CONSTRAINT gasto_vin_origen_formato CHECK (
    vin_origen_normalizado IS NULL
    OR vin_origen_normalizado ~ '^[A-Z0-9]{6,32}$'
  ),
  ADD CONSTRAINT gasto_importacion_fila_organizacion_fk
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES filas_importacion(id, organizacion_id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX gastos_importados_fila_unica
  ON gastos (organizacion_id, fila_importacion_id)
  WHERE fila_importacion_id IS NOT NULL;

CREATE TABLE ingresos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacion_id uuid NOT NULL REFERENCES organizaciones(id) ON DELETE RESTRICT,
  sucursal_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  fila_importacion_id uuid NOT NULL REFERENCES filas_importacion(id) ON DELETE RESTRICT,
  fecha_ingreso date NOT NULL,
  tipo_original varchar(120) NOT NULL,
  descripcion text NOT NULL,
  importe numeric(18, 2) NOT NULL,
  estado_registro varchar(40) NOT NULL,
  estado_original varchar(120),
  observaciones text,
  cobrado_por_original text,
  cobrado_por_personal_id uuid REFERENCES personal(id) ON DELETE RESTRICT,
  cuenta_caja_id uuid REFERENCES cuentas_caja(id) ON DELETE RESTRICT,
  es_transferencia boolean NOT NULL DEFAULT false,
  requiere_conciliacion boolean NOT NULL DEFAULT false,
  datos_inferidos jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingresos_importe_valido CHECK (importe > 0),
  CONSTRAINT ingresos_estado_registro_valido CHECK (
    estado_registro IN (
      'COBRADO',
      'PENDIENTE',
      'PENDIENTE_CONCILIACION',
      'ANULADO'
    )
  ),
  CONSTRAINT ingresos_conciliacion_estado_valido CHECK (
    (requiere_conciliacion AND estado_registro = 'PENDIENTE_CONCILIACION')
    OR NOT requiere_conciliacion
  ),
  CONSTRAINT ingresos_datos_inferidos_objeto CHECK (
    jsonb_typeof(datos_inferidos) = 'object'
  ),
  CONSTRAINT ingresos_id_organizacion_unico UNIQUE (id, organizacion_id),
  CONSTRAINT ingresos_fila_organizacion_unico
    UNIQUE (organizacion_id, fila_importacion_id),
  CONSTRAINT ingreso_sucursal_organizacion_fk
    FOREIGN KEY (sucursal_id, organizacion_id)
    REFERENCES sucursales(id, organizacion_id),
  CONSTRAINT ingreso_fila_organizacion_fk
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES filas_importacion(id, organizacion_id),
  CONSTRAINT ingreso_cobrador_organizacion_fk
    FOREIGN KEY (cobrado_por_personal_id, organizacion_id)
    REFERENCES personal(id, organizacion_id),
  CONSTRAINT ingreso_cuenta_organizacion_fk
    FOREIGN KEY (cuenta_caja_id, organizacion_id)
    REFERENCES cuentas_caja(id, organizacion_id)
);

CREATE INDEX ingresos_sucursal_fecha_indice
  ON ingresos (sucursal_id, fecha_ingreso DESC);

CREATE INDEX ingresos_cuenta_fecha_indice
  ON ingresos (cuenta_caja_id, fecha_ingreso DESC)
  WHERE cuenta_caja_id IS NOT NULL;

CREATE TABLE polizas_seguros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacion_id uuid NOT NULL REFERENCES organizaciones(id) ON DELETE RESTRICT,
  sucursal_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  fila_importacion_id uuid NOT NULL REFERENCES filas_importacion(id) ON DELETE RESTRICT,
  cliente_id uuid REFERENCES clientes(id) ON DELETE RESTRICT,
  operacion_id uuid REFERENCES operaciones(id) ON DELETE RESTRICT,
  unidad_vehiculo_id uuid REFERENCES unidades_vehiculos(id) ON DELETE RESTRICT,
  fecha_poliza date NOT NULL,
  aseguradora text,
  referencia_documento_cliente varchar(30),
  referencia_nombre_cliente varchar(180),
  referencia_vehiculo text,
  importe numeric(18, 2) NOT NULL,
  estado_registro varchar(60) NOT NULL DEFAULT 'HISTORICA_SIN_VIGENCIA_CONFIRMADA',
  datos_inferidos jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT poliza_importe_valido CHECK (importe > 0),
  CONSTRAINT poliza_estado_registro_valido CHECK (
    estado_registro IN (
      'HISTORICA_SIN_VIGENCIA_CONFIRMADA',
      'VIGENTE',
      'VENCIDA',
      'CANCELADA'
    )
  ),
  CONSTRAINT polizas_seguros_datos_inferidos_objeto CHECK (
    jsonb_typeof(datos_inferidos) = 'object'
  ),
  CONSTRAINT polizas_seguros_id_organizacion_unico UNIQUE (id, organizacion_id),
  CONSTRAINT polizas_seguros_fila_organizacion_unico
    UNIQUE (organizacion_id, fila_importacion_id),
  CONSTRAINT poliza_sucursal_organizacion_fk
    FOREIGN KEY (sucursal_id, organizacion_id)
    REFERENCES sucursales(id, organizacion_id),
  CONSTRAINT poliza_fila_organizacion_fk
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES filas_importacion(id, organizacion_id),
  CONSTRAINT poliza_cliente_organizacion_fk
    FOREIGN KEY (cliente_id, organizacion_id)
    REFERENCES clientes(id, organizacion_id),
  CONSTRAINT poliza_operacion_organizacion_fk
    FOREIGN KEY (operacion_id, organizacion_id)
    REFERENCES operaciones(id, organizacion_id),
  CONSTRAINT poliza_unidad_organizacion_fk
    FOREIGN KEY (unidad_vehiculo_id, organizacion_id)
    REFERENCES unidades_vehiculos(id, organizacion_id)
);

CREATE INDEX polizas_seguros_sucursal_fecha_indice
  ON polizas_seguros (sucursal_id, fecha_poliza DESC);

CREATE INDEX polizas_seguros_cliente_indice
  ON polizas_seguros (cliente_id)
  WHERE cliente_id IS NOT NULL;

CREATE INDEX polizas_seguros_unidad_indice
  ON polizas_seguros (unidad_vehiculo_id)
  WHERE unidad_vehiculo_id IS NOT NULL;

CREATE TABLE prospectos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacion_id uuid NOT NULL REFERENCES organizaciones(id) ON DELETE RESTRICT,
  sucursal_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  fila_importacion_id uuid NOT NULL REFERENCES filas_importacion(id) ON DELETE RESTRICT,
  bloque_origen varchar(40) NOT NULL,
  nombre_completo varchar(180),
  documento_mostrado varchar(40),
  documento_normalizado varchar(30),
  telefono varchar(40),
  estado_original varchar(160),
  comision_referido numeric(18, 2),
  comision_referido_original text,
  datos_inferidos jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospectos_identidad_origen_presente CHECK (
    nombre_completo IS NOT NULL
    OR documento_mostrado IS NOT NULL
    OR telefono IS NOT NULL
  ),
  CONSTRAINT prospectos_comision_valida CHECK (
    comision_referido IS NULL OR comision_referido >= 0
  ),
  CONSTRAINT prospectos_datos_inferidos_objeto CHECK (
    jsonb_typeof(datos_inferidos) = 'object'
  ),
  CONSTRAINT prospectos_id_organizacion_unico UNIQUE (id, organizacion_id),
  CONSTRAINT prospectos_fila_bloque_organizacion_unico
    UNIQUE (organizacion_id, fila_importacion_id, bloque_origen),
  CONSTRAINT prospecto_sucursal_organizacion_fk
    FOREIGN KEY (sucursal_id, organizacion_id)
    REFERENCES sucursales(id, organizacion_id),
  CONSTRAINT prospecto_fila_organizacion_fk
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES filas_importacion(id, organizacion_id)
);

CREATE INDEX prospectos_sucursal_estado_indice
  ON prospectos (sucursal_id, estado_original);

CREATE INDEX prospectos_documento_indice
  ON prospectos (organizacion_id, documento_normalizado)
  WHERE documento_normalizado IS NOT NULL;

CREATE TABLE registros_inventario_importados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacion_id uuid NOT NULL REFERENCES organizaciones(id) ON DELETE RESTRICT,
  sucursal_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  fila_importacion_id uuid NOT NULL REFERENCES filas_importacion(id) ON DELETE RESTRICT,
  hoja_origen varchar(20) NOT NULL,
  fecha_registro date,
  descripcion text,
  vin_mostrado varchar(40),
  vin_normalizado varchar(32),
  unidad_vehiculo_id uuid REFERENCES unidades_vehiculos(id) ON DELETE RESTRICT,
  estado_original varchar(120),
  importe numeric(18, 2),
  costo numeric(18, 2),
  datos_inferidos jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registros_inventario_hoja_origen_valida CHECK (
    hoja_origen IN ('SERGIO', 'SIAM')
  ),
  CONSTRAINT registros_inventario_vin_formato CHECK (
    vin_normalizado IS NULL
    OR vin_normalizado ~ '^[A-Z0-9]{6,32}$'
  ),
  CONSTRAINT registros_inventario_importe_valido CHECK (
    importe IS NULL OR importe >= 0
  ),
  CONSTRAINT registros_inventario_costo_valido CHECK (
    costo IS NULL OR costo >= 0
  ),
  CONSTRAINT registros_inventario_datos_inferidos_objeto CHECK (
    jsonb_typeof(datos_inferidos) = 'object'
  ),
  CONSTRAINT registros_inventario_importados_id_organizacion_unico
    UNIQUE (id, organizacion_id),
  CONSTRAINT registros_inventario_importados_fila_organizacion_unico
    UNIQUE (organizacion_id, fila_importacion_id),
  CONSTRAINT registro_inventario_sucursal_organizacion_fk
    FOREIGN KEY (sucursal_id, organizacion_id)
    REFERENCES sucursales(id, organizacion_id),
  CONSTRAINT registro_inventario_fila_organizacion_fk
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES filas_importacion(id, organizacion_id),
  CONSTRAINT registro_inventario_unidad_organizacion_fk
    FOREIGN KEY (unidad_vehiculo_id, organizacion_id)
    REFERENCES unidades_vehiculos(id, organizacion_id)
);

CREATE INDEX registros_inventario_importados_sucursal_fecha_indice
  ON registros_inventario_importados (sucursal_id, fecha_registro DESC);

CREATE INDEX registros_inventario_importados_vin_indice
  ON registros_inventario_importados (organizacion_id, vin_normalizado)
  WHERE vin_normalizado IS NOT NULL;

ALTER TABLE movimientos_caja
  ADD COLUMN IF NOT EXISTS ingreso_id uuid,
  ADD COLUMN IF NOT EXISTS es_importado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fila_importacion_id uuid,
  ADD COLUMN IF NOT EXISTS datos_inferidos jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE movimientos_caja
  DROP CONSTRAINT IF EXISTS caja_movimiento_origen_contrato;

ALTER TABLE movimientos_caja
  ADD CONSTRAINT caja_movimiento_origen_contrato CHECK (
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
  ADD CONSTRAINT movimientos_caja_datos_inferidos_objeto CHECK (
    jsonb_typeof(datos_inferidos) = 'object'
  ),
  ADD CONSTRAINT movimientos_caja_importado_linea_origen CHECK (
    NOT es_importado OR fila_importacion_id IS NOT NULL
  ),
  ADD CONSTRAINT movimiento_caja_ingreso_contrato CHECK (
    ingreso_id IS NULL
    OR (tipo_movimiento = 'INGRESO' AND direccion = 'CREDITO')
  ),
  ADD CONSTRAINT movimiento_caja_ingreso_organizacion_fk
    FOREIGN KEY (ingreso_id, organizacion_id)
    REFERENCES ingresos(id, organizacion_id),
  ADD CONSTRAINT movimiento_caja_importacion_fila_organizacion_fk
    FOREIGN KEY (fila_importacion_id, organizacion_id)
    REFERENCES filas_importacion(id, organizacion_id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX movimientos_caja_ingreso_unico
  ON movimientos_caja (ingreso_id)
  WHERE ingreso_id IS NOT NULL;

CREATE UNIQUE INDEX movimientos_caja_importados_fila_unica
  ON movimientos_caja (organizacion_id, fila_importacion_id)
  WHERE fila_importacion_id IS NOT NULL;

CREATE OR REPLACE FUNCTION luma_validar_operacion_invariantes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  total_planificado numeric(18, 2);
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

DROP TRIGGER IF EXISTS disparador_ingresos_actualizado_en ON ingresos;
CREATE TRIGGER disparador_ingresos_actualizado_en
BEFORE UPDATE ON ingresos
FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

DROP TRIGGER IF EXISTS disparador_polizas_seguros_actualizado_en ON polizas_seguros;
CREATE TRIGGER disparador_polizas_seguros_actualizado_en
BEFORE UPDATE ON polizas_seguros
FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

DROP TRIGGER IF EXISTS disparador_prospectos_actualizado_en ON prospectos;
CREATE TRIGGER disparador_prospectos_actualizado_en
BEFORE UPDATE ON prospectos
FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

DROP TRIGGER IF EXISTS disparador_registros_inventario_importados_actualizado_en
  ON registros_inventario_importados;
CREATE TRIGGER disparador_registros_inventario_importados_actualizado_en
BEFORE UPDATE ON registros_inventario_importados
FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

ALTER TABLE ingresos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingresos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_ingresos_organizacion ON ingresos;
CREATE POLICY politica_ingresos_organizacion
ON ingresos
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

ALTER TABLE polizas_seguros ENABLE ROW LEVEL SECURITY;
ALTER TABLE polizas_seguros FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_polizas_seguros_organizacion ON polizas_seguros;
CREATE POLICY politica_polizas_seguros_organizacion
ON polizas_seguros
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

ALTER TABLE prospectos ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospectos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_prospectos_organizacion ON prospectos;
CREATE POLICY politica_prospectos_organizacion
ON prospectos
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

ALTER TABLE registros_inventario_importados ENABLE ROW LEVEL SECURITY;
ALTER TABLE registros_inventario_importados FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_registros_inventario_importados_organizacion
  ON registros_inventario_importados;
CREATE POLICY politica_registros_inventario_importados_organizacion
ON registros_inventario_importados
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

COMMIT;

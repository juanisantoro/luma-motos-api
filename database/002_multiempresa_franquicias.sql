BEGIN;

-- Migracion no destructiva: todos los registros existentes pasan a la casa central.
-- La aplicacion NestJS/Prisma debe abrir una transaccion interactiva por request y
-- ejecutar set_config('app.organizacion_id', <uuid>, true) y
-- set_config('app.acceso_global', 'true|false', true). El rol de la aplicacion no
-- debe tener BYPASSRLS.

CREATE TYPE tipo_organizacion_luma AS ENUM ('CASA_CENTRAL', 'FRANQUICIA');
CREATE TYPE alcance_catalogo_luma AS ENUM ('GLOBAL', 'RESTRINGIDO');

CREATE TABLE organizaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo varchar(40) NOT NULL UNIQUE,
  nombre varchar(180) NOT NULL,
  tipo tipo_organizacion_luma NOT NULL,
  activa boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

INSERT INTO organizaciones (codigo, nombre, tipo)
VALUES ('LUMA_CENTRAL', 'Luma Motos Central', 'CASA_CENTRAL')
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo, activa = true, actualizado_en = now();

CREATE TRIGGER disparador_organizaciones_actualizado_en
BEFORE UPDATE ON organizaciones FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

ALTER TABLE usuarios ADD COLUMN acceso_global boolean NOT NULL DEFAULT false;
ALTER TABLE versiones_vehiculos
  ADD COLUMN alcance alcance_catalogo_luma NOT NULL DEFAULT 'RESTRINGIDO',
  ADD COLUMN organizacion_propietaria_id uuid REFERENCES organizaciones(id) ON DELETE RESTRICT;

-- Corrige el nombre historico creado por 001 sin perder movimientos.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'movimientos_caja'
      AND column_name = 'transferenciaencia_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'movimientos_caja'
      AND column_name = 'transferencia_id'
  ) THEN
    ALTER TABLE movimientos_caja
      RENAME COLUMN transferenciaencia_id TO transferencia_id;
  END IF;
END $$;

-- Incluye las asociaciones, aunque no fueran parte del minimo, para evitar que
-- una asignacion de personal atraviese organizaciones.
DO $$
DECLARE
  tabla text;
  organizacion_central uuid;
BEGIN
  SELECT id INTO organizacion_central
  FROM organizaciones WHERE codigo = 'LUMA_CENTRAL';

  FOREACH tabla IN ARRAY ARRAY[
    'sucursales', 'usuarios', 'registros_auditoria', 'personal',
    'acceso_personal_sucursal', 'clientes', 'politicas_precios_vehiculos',
    'proveedores', 'disponibilidad_proveedor', 'unidades_vehiculos',
    'operaciones', 'asignaciones_personal_operacion', 'aprobaciones_operacion',
    'obligaciones_operacion', 'vehiculos_tomados_parte_pago',
    'consultas_crediticias', 'reservas_stock', 'solicitudes_abastecimiento',
    'movimientos_inventario', 'compras_proveedor',
    'componentes_pago_operacion', 'cuentas_caja', 'cobranzas', 'gastos',
    'liquidaciones_comisiones', 'operaciones_liquidacion_comision',
    'transferencias_caja', 'movimientos_caja', 'lotes_importacion',
    'filas_importacion'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN organizacion_id uuid', tabla);
    EXECUTE format('UPDATE %I SET organizacion_id = $1 WHERE organizacion_id IS NULL', tabla)
      USING organizacion_central;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organizacion_id SET NOT NULL', tabla);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organizacion_id) REFERENCES organizaciones(id) ON DELETE RESTRICT',
      tabla, tabla || '_organizacion_fk'
    );
  END LOOP;
END $$;

-- Los usuarios preexistentes pertenecen a la central y conservan su alcance
-- operativo central. En altas posteriores acceso_global se concede explicitamente.
UPDATE usuarios
SET acceso_global = true
WHERE organizacion_id = (SELECT id FROM organizaciones WHERE codigo = 'LUMA_CENTRAL');

UPDATE versiones_vehiculos
SET alcance = 'RESTRINGIDO',
    organizacion_propietaria_id = (SELECT id FROM organizaciones WHERE codigo = 'LUMA_CENTRAL');

ALTER TABLE versiones_vehiculos
  DROP CONSTRAINT versiones_vehiculos_modelo_id_nombre_normalizado_key,
  ADD CONSTRAINT versiones_vehiculos_alcance_propietario_valido CHECK (
    (alcance = 'GLOBAL' AND organizacion_propietaria_id IS NULL)
    OR
    (alcance = 'RESTRINGIDO' AND organizacion_propietaria_id IS NOT NULL)
  );

CREATE UNIQUE INDEX versiones_vehiculos_global_unica
  ON versiones_vehiculos (modelo_id, nombre_normalizado)
  WHERE alcance = 'GLOBAL';

CREATE UNIQUE INDEX versiones_vehiculos_restringida_unica
  ON versiones_vehiculos (
    modelo_id,
    nombre_normalizado,
    organizacion_propietaria_id
  )
  WHERE alcance = 'RESTRINGIDO';

CREATE TABLE catalogo_organizaciones (
  organizacion_id uuid NOT NULL REFERENCES organizaciones(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES versiones_vehiculos(id) ON DELETE RESTRICT,
  puede_vender boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacion_id, version_id)
);

INSERT INTO catalogo_organizaciones (organizacion_id, version_id, puede_vender)
SELECT o.id, v.id, true
FROM organizaciones o
CROSS JOIN versiones_vehiculos v
WHERE o.codigo = 'LUMA_CENTRAL' AND v.alcance = 'RESTRINGIDO'
ON CONFLICT DO NOTHING;

CREATE TRIGGER disparador_catalogo_organizaciones_actualizado_en
BEFORE UPDATE ON catalogo_organizaciones FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

-- Las claves previas eran globales; se reemplazan sin borrar datos.
ALTER TABLE sucursales DROP CONSTRAINT sucursales_codigo_key;
ALTER TABLE sucursales DROP CONSTRAINT sucursales_nombre_key;
ALTER TABLE sucursales ADD CONSTRAINT sucursales_organizacion_codigo_unico UNIQUE (organizacion_id, codigo);
ALTER TABLE sucursales ADD CONSTRAINT sucursales_organizacion_nombre_unico UNIQUE (organizacion_id, nombre);

DROP INDEX clientes_documento_unico;
CREATE UNIQUE INDEX clientes_organizacion_documento_unico
  ON clientes (organizacion_id, tipo_documento, documento_normalizado)
  WHERE documento_normalizado IS NOT NULL;

ALTER TABLE personal DROP CONSTRAINT personal_codigo_empleado_key;
CREATE UNIQUE INDEX personal_organizacion_codigo_empleado_unico
  ON personal (organizacion_id, codigo_empleado)
  WHERE codigo_empleado IS NOT NULL;
DROP INDEX personal_correo_normalizado_unico;
CREATE UNIQUE INDEX personal_organizacion_correo_normalizado_unico
  ON personal (organizacion_id, correo_normalizado)
  WHERE correo_normalizado IS NOT NULL;

DROP INDEX proveedores_identificacion_fiscal_unico;
DROP INDEX proveedores_nombre_normalizado_unico;
CREATE UNIQUE INDEX proveedores_organizacion_identificacion_fiscal_unico
  ON proveedores (organizacion_id, identificacion_fiscal)
  WHERE identificacion_fiscal IS NOT NULL;
CREATE UNIQUE INDEX proveedores_organizacion_nombre_normalizado_unico
  ON proveedores (organizacion_id, nombre_normalizado);

DROP INDEX politicas_precios_vehiculos_vigente_unico;
CREATE UNIQUE INDEX politicas_precios_organizacion_vigente_unico
  ON politicas_precios_vehiculos (
    organizacion_id, version_id,
    coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE vigente_hasta IS NULL;

ALTER TABLE cuentas_caja DROP CONSTRAINT cuentas_caja_codigo_key;
ALTER TABLE cuentas_caja ADD CONSTRAINT cuentas_caja_organizacion_codigo_unico UNIQUE (organizacion_id, codigo);

ALTER TABLE lotes_importacion DROP CONSTRAINT lotes_importacion_sha256_origen_key;
ALTER TABLE lotes_importacion ADD CONSTRAINT lotes_importacion_organizacion_sha256_unico
  UNIQUE (organizacion_id, sha256_origen);

-- Estas claves candidatas permiten FKs compuestas sin cambiar los FKs historicos.
DO $$
DECLARE
  tabla text;
BEGIN
  FOREACH tabla IN ARRAY ARRAY[
    'sucursales', 'usuarios', 'registros_auditoria', 'personal', 'clientes',
    'politicas_precios_vehiculos', 'proveedores', 'disponibilidad_proveedor',
    'unidades_vehiculos', 'operaciones', 'aprobaciones_operacion',
    'obligaciones_operacion', 'vehiculos_tomados_parte_pago',
    'consultas_crediticias', 'reservas_stock', 'solicitudes_abastecimiento',
    'movimientos_inventario', 'compras_proveedor',
    'componentes_pago_operacion', 'cuentas_caja', 'cobranzas', 'gastos',
    'liquidaciones_comisiones', 'transferencias_caja', 'movimientos_caja',
    'lotes_importacion', 'filas_importacion'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (id, organizacion_id)',
      tabla, tabla || '_id_organizacion_unico'
    );
  END LOOP;
END $$;

-- Padres de negocio: cada FK compuesta impide mezclar filas de organizaciones.
ALTER TABLE usuarios ADD CONSTRAINT usuarios_sucursal_organizacion_fk
  FOREIGN KEY (sucursal_id, organizacion_id) REFERENCES sucursales(id, organizacion_id);
ALTER TABLE registros_auditoria ADD CONSTRAINT auditoria_usuario_organizacion_fk
  FOREIGN KEY (usuario_id, organizacion_id) REFERENCES usuarios(id, organizacion_id);
ALTER TABLE personal ADD CONSTRAINT personal_usuario_organizacion_fk
  FOREIGN KEY (usuario_id, organizacion_id) REFERENCES usuarios(id, organizacion_id);
ALTER TABLE personal ADD CONSTRAINT personal_sucursal_organizacion_fk
  FOREIGN KEY (sucursal_principal_id, organizacion_id) REFERENCES sucursales(id, organizacion_id);
ALTER TABLE acceso_personal_sucursal ADD CONSTRAINT acceso_personal_organizacion_fk
  FOREIGN KEY (personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE acceso_personal_sucursal ADD CONSTRAINT acceso_sucursal_organizacion_fk
  FOREIGN KEY (sucursal_id, organizacion_id) REFERENCES sucursales(id, organizacion_id);
ALTER TABLE politicas_precios_vehiculos ADD CONSTRAINT precio_sucursal_organizacion_fk
  FOREIGN KEY (sucursal_id, organizacion_id) REFERENCES sucursales(id, organizacion_id);
ALTER TABLE politicas_precios_vehiculos ADD CONSTRAINT precio_personal_organizacion_fk
  FOREIGN KEY (creado_por_personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE disponibilidad_proveedor ADD CONSTRAINT disponibilidad_proveedor_proveedor_organizacion_fk
  FOREIGN KEY (proveedor_id, organizacion_id) REFERENCES proveedores(id, organizacion_id);
ALTER TABLE unidades_vehiculos ADD CONSTRAINT unidad_sucursal_organizacion_fk
  FOREIGN KEY (sucursal_id, organizacion_id) REFERENCES sucursales(id, organizacion_id);
ALTER TABLE unidades_vehiculos ADD CONSTRAINT unidad_proveedor_organizacion_fk
  FOREIGN KEY (proveedor_id, organizacion_id) REFERENCES proveedores(id, organizacion_id);
ALTER TABLE operaciones ADD CONSTRAINT operacion_sucursal_organizacion_fk
  FOREIGN KEY (sucursal_id, organizacion_id) REFERENCES sucursales(id, organizacion_id);
ALTER TABLE operaciones ADD CONSTRAINT operacion_cliente_organizacion_fk
  FOREIGN KEY (cliente_id, organizacion_id) REFERENCES clientes(id, organizacion_id);
ALTER TABLE operaciones ADD CONSTRAINT operacion_unidad_organizacion_fk
  FOREIGN KEY (unidad_vehiculo_id, organizacion_id) REFERENCES unidades_vehiculos(id, organizacion_id);
ALTER TABLE operaciones ADD CONSTRAINT operacion_personal_organizacion_fk
  FOREIGN KEY (creado_por_personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE asignaciones_personal_operacion ADD CONSTRAINT asignacion_operacion_organizacion_fk
  FOREIGN KEY (operacion_id, organizacion_id) REFERENCES operaciones(id, organizacion_id);
ALTER TABLE asignaciones_personal_operacion ADD CONSTRAINT asignacion_personal_organizacion_fk
  FOREIGN KEY (personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE aprobaciones_operacion ADD CONSTRAINT aprobacion_operacion_organizacion_fk
  FOREIGN KEY (operacion_id, organizacion_id) REFERENCES operaciones(id, organizacion_id);
ALTER TABLE aprobaciones_operacion ADD CONSTRAINT aprobacion_solicitante_organizacion_fk
  FOREIGN KEY (solicitado_por_personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE aprobaciones_operacion ADD CONSTRAINT aprobacion_decisor_organizacion_fk
  FOREIGN KEY (decidido_por_personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE obligaciones_operacion ADD CONSTRAINT obligacion_operacion_organizacion_fk
  FOREIGN KEY (operacion_id, organizacion_id) REFERENCES operaciones(id, organizacion_id);
ALTER TABLE vehiculos_tomados_parte_pago ADD CONSTRAINT toma_operacion_organizacion_fk
  FOREIGN KEY (operacion_id, organizacion_id) REFERENCES operaciones(id, organizacion_id);
ALTER TABLE vehiculos_tomados_parte_pago ADD CONSTRAINT toma_unidad_organizacion_fk
  FOREIGN KEY (unidad_vehiculo_resultante_id, organizacion_id) REFERENCES unidades_vehiculos(id, organizacion_id);
ALTER TABLE consultas_crediticias ADD CONSTRAINT consulta_cliente_organizacion_fk
  FOREIGN KEY (cliente_id, organizacion_id) REFERENCES clientes(id, organizacion_id);
ALTER TABLE consultas_crediticias ADD CONSTRAINT consulta_operacion_organizacion_fk
  FOREIGN KEY (operacion_id, organizacion_id) REFERENCES operaciones(id, organizacion_id);
ALTER TABLE consultas_crediticias ADD CONSTRAINT consulta_personal_organizacion_fk
  FOREIGN KEY (consultado_por_personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE reservas_stock ADD CONSTRAINT reserva_operacion_organizacion_fk
  FOREIGN KEY (operacion_id, organizacion_id) REFERENCES operaciones(id, organizacion_id);
ALTER TABLE reservas_stock ADD CONSTRAINT reserva_unidad_organizacion_fk
  FOREIGN KEY (unidad_vehiculo_id, organizacion_id) REFERENCES unidades_vehiculos(id, organizacion_id);
ALTER TABLE reservas_stock ADD CONSTRAINT reserva_disponibilidad_organizacion_fk
  FOREIGN KEY (disponibilidad_proveedor_id, organizacion_id) REFERENCES disponibilidad_proveedor(id, organizacion_id);
ALTER TABLE reservas_stock ADD CONSTRAINT reserva_personal_organizacion_fk
  FOREIGN KEY (creado_por_personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE solicitudes_abastecimiento ADD CONSTRAINT abastecimiento_operacion_organizacion_fk
  FOREIGN KEY (operacion_id, organizacion_id) REFERENCES operaciones(id, organizacion_id);
ALTER TABLE solicitudes_abastecimiento ADD CONSTRAINT abastecimiento_proveedor_organizacion_fk
  FOREIGN KEY (proveedor_id, organizacion_id) REFERENCES proveedores(id, organizacion_id);
ALTER TABLE solicitudes_abastecimiento ADD CONSTRAINT abastecimiento_disponibilidad_organizacion_fk
  FOREIGN KEY (disponibilidad_proveedor_id, organizacion_id) REFERENCES disponibilidad_proveedor(id, organizacion_id);
ALTER TABLE solicitudes_abastecimiento ADD CONSTRAINT abastecimiento_sucursal_organizacion_fk
  FOREIGN KEY (sucursal_llegada_id, organizacion_id) REFERENCES sucursales(id, organizacion_id);
ALTER TABLE solicitudes_abastecimiento ADD CONSTRAINT abastecimiento_unidad_organizacion_fk
  FOREIGN KEY (unidad_vehiculo_recibida_id, organizacion_id) REFERENCES unidades_vehiculos(id, organizacion_id);
ALTER TABLE solicitudes_abastecimiento ADD CONSTRAINT abastecimiento_personal_organizacion_fk
  FOREIGN KEY (creado_por_personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE movimientos_inventario ADD CONSTRAINT movimiento_inventario_unidad_organizacion_fk
  FOREIGN KEY (unidad_vehiculo_id, organizacion_id) REFERENCES unidades_vehiculos(id, organizacion_id);
ALTER TABLE movimientos_inventario ADD CONSTRAINT movimiento_inventario_origen_organizacion_fk
  FOREIGN KEY (sucursal_origen_id, organizacion_id) REFERENCES sucursales(id, organizacion_id);
ALTER TABLE movimientos_inventario ADD CONSTRAINT movimiento_inventario_destino_organizacion_fk
  FOREIGN KEY (sucursal_destino_id, organizacion_id) REFERENCES sucursales(id, organizacion_id);
ALTER TABLE movimientos_inventario ADD CONSTRAINT movimiento_inventario_operacion_organizacion_fk
  FOREIGN KEY (operacion_id, organizacion_id) REFERENCES operaciones(id, organizacion_id);
ALTER TABLE movimientos_inventario ADD CONSTRAINT movimiento_inventario_abastecimiento_organizacion_fk
  FOREIGN KEY (solicitud_abastecimiento_id, organizacion_id) REFERENCES solicitudes_abastecimiento(id, organizacion_id);
ALTER TABLE movimientos_inventario ADD CONSTRAINT movimiento_inventario_personal_organizacion_fk
  FOREIGN KEY (realizado_por_personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE compras_proveedor ADD CONSTRAINT compra_proveedor_referencia_organizacion_fk
  FOREIGN KEY (proveedor_id, organizacion_id) REFERENCES proveedores(id, organizacion_id);
ALTER TABLE compras_proveedor ADD CONSTRAINT compra_unidad_organizacion_fk
  FOREIGN KEY (unidad_vehiculo_id, organizacion_id) REFERENCES unidades_vehiculos(id, organizacion_id);
ALTER TABLE compras_proveedor ADD CONSTRAINT compra_abastecimiento_organizacion_fk
  FOREIGN KEY (solicitud_abastecimiento_id, organizacion_id) REFERENCES solicitudes_abastecimiento(id, organizacion_id);
ALTER TABLE componentes_pago_operacion ADD CONSTRAINT componente_operacion_organizacion_fk
  FOREIGN KEY (operacion_id, organizacion_id) REFERENCES operaciones(id, organizacion_id);
ALTER TABLE componentes_pago_operacion ADD CONSTRAINT componente_consulta_organizacion_fk
  FOREIGN KEY (consulta_crediticia_id, organizacion_id) REFERENCES consultas_crediticias(id, organizacion_id);
ALTER TABLE componentes_pago_operacion ADD CONSTRAINT componente_toma_organizacion_fk
  FOREIGN KEY (vehiculo_tomado_id, organizacion_id) REFERENCES vehiculos_tomados_parte_pago(id, organizacion_id);
ALTER TABLE cuentas_caja ADD CONSTRAINT cuenta_sucursal_organizacion_fk
  FOREIGN KEY (sucursal_id, organizacion_id) REFERENCES sucursales(id, organizacion_id);
ALTER TABLE cuentas_caja ADD CONSTRAINT cuenta_personal_organizacion_fk
  FOREIGN KEY (personal_responsable_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE cobranzas ADD CONSTRAINT cobranza_componente_organizacion_fk
  FOREIGN KEY (componente_pago_id, organizacion_id) REFERENCES componentes_pago_operacion(id, organizacion_id);
ALTER TABLE cobranzas ADD CONSTRAINT cobranza_cuenta_organizacion_fk
  FOREIGN KEY (cuenta_caja_id, organizacion_id) REFERENCES cuentas_caja(id, organizacion_id);
ALTER TABLE cobranzas ADD CONSTRAINT cobranza_reversion_organizacion_fk
  FOREIGN KEY (revierte_a_id, organizacion_id) REFERENCES cobranzas(id, organizacion_id);
ALTER TABLE cobranzas ADD CONSTRAINT cobranza_personal_organizacion_fk
  FOREIGN KEY (registrado_por_personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE gastos ADD CONSTRAINT gasto_sucursal_organizacion_fk
  FOREIGN KEY (sucursal_id, organizacion_id) REFERENCES sucursales(id, organizacion_id);
ALTER TABLE gastos ADD CONSTRAINT gasto_operacion_organizacion_fk
  FOREIGN KEY (operacion_id, organizacion_id) REFERENCES operaciones(id, organizacion_id);
ALTER TABLE gastos ADD CONSTRAINT gasto_unidad_organizacion_fk
  FOREIGN KEY (unidad_vehiculo_id, organizacion_id) REFERENCES unidades_vehiculos(id, organizacion_id);
ALTER TABLE gastos ADD CONSTRAINT gasto_personal_organizacion_fk
  FOREIGN KEY (creado_por_personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE liquidaciones_comisiones ADD CONSTRAINT liquidacion_personal_organizacion_fk
  FOREIGN KEY (personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE liquidaciones_comisiones ADD CONSTRAINT liquidacion_sucursal_organizacion_fk
  FOREIGN KEY (sucursal_id, organizacion_id) REFERENCES sucursales(id, organizacion_id);
ALTER TABLE liquidaciones_comisiones ADD CONSTRAINT liquidacion_acordador_organizacion_fk
  FOREIGN KEY (acordado_por_personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE operaciones_liquidacion_comision ADD CONSTRAINT liquidacion_operacion_organizacion_fk
  FOREIGN KEY (liquidacion_id, organizacion_id) REFERENCES liquidaciones_comisiones(id, organizacion_id);
ALTER TABLE operaciones_liquidacion_comision ADD CONSTRAINT operacion_liquidacion_organizacion_fk
  FOREIGN KEY (operacion_id, organizacion_id) REFERENCES operaciones(id, organizacion_id);
ALTER TABLE transferencias_caja ADD CONSTRAINT transferencia_origen_organizacion_fk
  FOREIGN KEY (cuenta_origen_id, organizacion_id) REFERENCES cuentas_caja(id, organizacion_id);
ALTER TABLE transferencias_caja ADD CONSTRAINT transferencia_destino_organizacion_fk
  FOREIGN KEY (cuenta_destino_id, organizacion_id) REFERENCES cuentas_caja(id, organizacion_id);
ALTER TABLE transferencias_caja ADD CONSTRAINT transferencia_personal_organizacion_fk
  FOREIGN KEY (creado_por_personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE movimientos_caja ADD CONSTRAINT movimiento_caja_cuenta_organizacion_fk
  FOREIGN KEY (cuenta_caja_id, organizacion_id) REFERENCES cuentas_caja(id, organizacion_id);
ALTER TABLE movimientos_caja ADD CONSTRAINT movimiento_caja_cobranza_organizacion_fk
  FOREIGN KEY (cobranza_id, organizacion_id) REFERENCES cobranzas(id, organizacion_id);
ALTER TABLE movimientos_caja ADD CONSTRAINT movimiento_caja_transferencia_organizacion_fk
  FOREIGN KEY (transferencia_id, organizacion_id) REFERENCES transferencias_caja(id, organizacion_id);
ALTER TABLE movimientos_caja ADD CONSTRAINT movimiento_caja_gasto_organizacion_fk
  FOREIGN KEY (gasto_id, organizacion_id) REFERENCES gastos(id, organizacion_id);
ALTER TABLE movimientos_caja ADD CONSTRAINT movimiento_caja_compra_organizacion_fk
  FOREIGN KEY (compra_proveedor_id, organizacion_id) REFERENCES compras_proveedor(id, organizacion_id);
ALTER TABLE movimientos_caja ADD CONSTRAINT movimiento_caja_liquidacion_organizacion_fk
  FOREIGN KEY (liquidacion_comision_id, organizacion_id) REFERENCES liquidaciones_comisiones(id, organizacion_id);
ALTER TABLE movimientos_caja ADD CONSTRAINT movimiento_caja_reversion_organizacion_fk
  FOREIGN KEY (revierte_a_id, organizacion_id) REFERENCES movimientos_caja(id, organizacion_id);
ALTER TABLE movimientos_caja ADD CONSTRAINT movimiento_caja_personal_organizacion_fk
  FOREIGN KEY (registrado_por_personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE lotes_importacion ADD CONSTRAINT lote_personal_organizacion_fk
  FOREIGN KEY (creado_por_personal_id, organizacion_id) REFERENCES personal(id, organizacion_id);
ALTER TABLE filas_importacion ADD CONSTRAINT fila_lote_organizacion_fk
  FOREIGN KEY (lote_id, organizacion_id) REFERENCES lotes_importacion(id, organizacion_id);

CREATE OR REPLACE FUNCTION luma_validar_acceso_global_usuario()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.acceso_global AND NOT EXISTS (
    SELECT 1 FROM organizaciones
    WHERE id = NEW.organizacion_id AND tipo = 'CASA_CENTRAL'
  ) THEN
    RAISE EXCEPTION 'El acceso global solo puede otorgarse a usuarios de la casa central';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER disparador_usuarios_acceso_global
BEFORE INSERT OR UPDATE OF acceso_global, organizacion_id ON usuarios
FOR EACH ROW EXECUTE FUNCTION luma_validar_acceso_global_usuario();

CREATE OR REPLACE FUNCTION luma_proteger_catalogo_compartido()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.acceso_global', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION
      'Solo un usuario central con acceso global puede modificar marcas o modelos compartidos';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER disparador_marcas_catalogo_compartido
BEFORE INSERT OR UPDATE OR DELETE ON marcas_vehiculos
FOR EACH ROW EXECUTE FUNCTION luma_proteger_catalogo_compartido();

CREATE TRIGGER disparador_modelos_catalogo_compartido
BEFORE INSERT OR UPDATE OR DELETE ON modelos_vehiculos
FOR EACH ROW EXECUTE FUNCTION luma_proteger_catalogo_compartido();

CREATE OR REPLACE FUNCTION luma_version_visible_para_organizacion(
  version_objetivo_id uuid,
  organizacion_objetivo_id uuid,
  exigir_venta boolean DEFAULT false
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.acceso_global', true) = 'true', false)
  OR EXISTS (
    SELECT 1
    FROM versiones_vehiculos v
    WHERE v.id = version_objetivo_id
      AND (
        v.alcance = 'GLOBAL'
        OR EXISTS (
          SELECT 1 FROM catalogo_organizaciones co
          WHERE co.version_id = v.id
            AND co.organizacion_id = organizacion_objetivo_id
            AND (NOT exigir_venta OR co.puede_vender)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION luma_validar_asignacion_catalogo()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  alcance_version alcance_catalogo_luma;
  organizacion_propietaria uuid;
BEGIN
  IF current_setting('app.acceso_global', true) = 'true' THEN
    RETURN NEW;
  END IF;

  SELECT alcance, organizacion_propietaria_id
  INTO alcance_version, organizacion_propietaria
  FROM versiones_vehiculos
  WHERE id = NEW.version_id;

  IF NOT FOUND
    OR NEW.organizacion_id IS DISTINCT FROM luma_organizacion_actual()
    OR alcance_version <> 'RESTRINGIDO'
    OR organizacion_propietaria IS DISTINCT FROM NEW.organizacion_id
  THEN
    RAISE EXCEPTION
      'La organizacion % no puede habilitar la version %',
      NEW.organizacion_id,
      NEW.version_id;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER disparador_catalogo_organizacion_valido
BEFORE INSERT OR UPDATE OF organizacion_id, version_id
ON catalogo_organizaciones
FOR EACH ROW EXECUTE FUNCTION luma_validar_asignacion_catalogo();

CREATE OR REPLACE FUNCTION luma_validar_version_organizacion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  version_objetivo_id uuid;
  exigir_venta boolean := TG_ARGV[1]::boolean;
BEGIN
  version_objetivo_id := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  IF version_objetivo_id IS NOT NULL
    AND NOT luma_version_visible_para_organizacion(
      version_objetivo_id, NEW.organizacion_id, exigir_venta
    )
  THEN
    RAISE EXCEPTION 'La version de vehiculo % no esta habilitada para la organizacion %',
      version_objetivo_id, NEW.organizacion_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER disparador_precio_version_organizacion
BEFORE INSERT OR UPDATE OF version_id, organizacion_id ON politicas_precios_vehiculos
FOR EACH ROW EXECUTE FUNCTION luma_validar_version_organizacion('version_id', 'true');
CREATE TRIGGER disparador_disponibilidad_version_organizacion
BEFORE INSERT OR UPDATE OF version_id, organizacion_id ON disponibilidad_proveedor
FOR EACH ROW EXECUTE FUNCTION luma_validar_version_organizacion('version_id', 'false');
CREATE TRIGGER disparador_unidad_version_organizacion
BEFORE INSERT OR UPDATE OF version_id, organizacion_id ON unidades_vehiculos
FOR EACH ROW EXECUTE FUNCTION luma_validar_version_organizacion('version_id', 'false');
CREATE TRIGGER disparador_operacion_version_organizacion
BEFORE INSERT OR UPDATE OF version_id, organizacion_id ON operaciones
FOR EACH ROW EXECUTE FUNCTION luma_validar_version_organizacion('version_id', 'true');
CREATE TRIGGER disparador_toma_version_organizacion
BEFORE INSERT OR UPDATE OF version_id, organizacion_id ON vehiculos_tomados_parte_pago
FOR EACH ROW EXECUTE FUNCTION luma_validar_version_organizacion('version_id', 'false');
CREATE TRIGGER disparador_abastecimiento_version_organizacion
BEFORE INSERT OR UPDATE OF version_id, organizacion_id ON solicitudes_abastecimiento
FOR EACH ROW EXECUTE FUNCTION luma_validar_version_organizacion('version_id', 'true');

CREATE OR REPLACE FUNCTION luma_organizacion_actual()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.organizacion_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION luma_tiene_acceso_organizacion(organizacion_objetivo_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.acceso_global', true) = 'true'
      OR organizacion_objetivo_id = luma_organizacion_actual();
$$;

CREATE OR REPLACE FUNCTION luma_versiones_visibles_actuales()
RETURNS TABLE (
  id uuid, modelo_id uuid, nombre varchar, nombre_normalizado varchar,
  es_marcador boolean, activo boolean, alcance alcance_catalogo_luma,
  organizacion_propietaria_id uuid
) LANGUAGE sql STABLE AS $$
  SELECT v.id, v.modelo_id, v.nombre, v.nombre_normalizado, v.es_marcador,
         v.activo, v.alcance, v.organizacion_propietaria_id
  FROM versiones_vehiculos v
  WHERE luma_version_visible_para_organizacion(v.id, luma_organizacion_actual(), false);
$$;

-- RLS se habilita al final para que el backfill de esta migracion no dependa de
-- contexto de sesion. Casa central usa app.acceso_global=true; franquicias false.
DO $$
DECLARE
  tabla text;
  politica text;
BEGIN
  FOREACH tabla IN ARRAY ARRAY[
    'sucursales', 'usuarios', 'registros_auditoria', 'personal',
    'acceso_personal_sucursal', 'clientes', 'politicas_precios_vehiculos',
    'proveedores', 'disponibilidad_proveedor', 'unidades_vehiculos',
    'operaciones', 'asignaciones_personal_operacion', 'aprobaciones_operacion',
    'obligaciones_operacion', 'vehiculos_tomados_parte_pago',
    'consultas_crediticias', 'reservas_stock', 'solicitudes_abastecimiento',
    'movimientos_inventario', 'compras_proveedor',
    'componentes_pago_operacion', 'cuentas_caja', 'cobranzas', 'gastos',
    'liquidaciones_comisiones', 'operaciones_liquidacion_comision',
    'transferencias_caja', 'movimientos_caja', 'lotes_importacion',
    'filas_importacion', 'catalogo_organizaciones'
  ]
  LOOP
    politica := 'politica_' || tabla || '_organizacion';
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabla);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id))', politica, tabla);
  END LOOP;
END $$;

ALTER TABLE versiones_vehiculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE versiones_vehiculos FORCE ROW LEVEL SECURITY;

CREATE POLICY politica_versiones_lectura
ON versiones_vehiculos
FOR SELECT
USING (
  coalesce(current_setting('app.acceso_global', true) = 'true', false)
  OR alcance = 'GLOBAL'
  OR organizacion_propietaria_id = luma_organizacion_actual()
  OR EXISTS (
    SELECT 1
    FROM catalogo_organizaciones catalogo
    WHERE catalogo.version_id = versiones_vehiculos.id
      AND catalogo.organizacion_id = luma_organizacion_actual()
  )
);

CREATE POLICY politica_versiones_insertar
ON versiones_vehiculos
FOR INSERT
WITH CHECK (
  coalesce(current_setting('app.acceso_global', true) = 'true', false)
  OR (
    alcance = 'RESTRINGIDO'
    AND organizacion_propietaria_id = luma_organizacion_actual()
  )
);

CREATE POLICY politica_versiones_actualizar
ON versiones_vehiculos
FOR UPDATE
USING (
  coalesce(current_setting('app.acceso_global', true) = 'true', false)
  OR organizacion_propietaria_id = luma_organizacion_actual()
)
WITH CHECK (
  coalesce(current_setting('app.acceso_global', true) = 'true', false)
  OR (
    alcance = 'RESTRINGIDO'
    AND organizacion_propietaria_id = luma_organizacion_actual()
  )
);

CREATE POLICY politica_versiones_eliminar
ON versiones_vehiculos
FOR DELETE
USING (
  coalesce(current_setting('app.acceso_global', true) = 'true', false)
  OR organizacion_propietaria_id = luma_organizacion_actual()
);

COMMIT;

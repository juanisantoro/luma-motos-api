BEGIN;

-- Reinicio intencional: descomente la linea siguiente unicamente para una base Luma descartable.
-- SET app.confirmar_reinicio_luma = 'RECREAR_BASE_LUMA';
DO $$
BEGIN
  IF current_setting('app.confirmar_reinicio_luma', true) IS DISTINCT FROM 'RECREAR_BASE_LUMA' THEN
    RAISE EXCEPTION 'Reinicio bloqueado. Configure app.confirmar_reinicio_luma en RECREAR_BASE_LUMA antes de ejecutar este script.';
  END IF;
END $$;
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE luma_personal_estado AS ENUM (
  'ACTIVO',
  'INACTIVO'
);

CREATE TYPE tipo_documento_luma AS ENUM (
  'DNI',
  'CUIT',
  'CI',
  'PASAPORTE',
  'OTRO'
);

CREATE TYPE resultado_crediticio_luma AS ENUM (
  'PENDIENTE',
  'APROBADA',
  'RECHAZADA'
);

CREATE TYPE tipo_vehiculo_luma AS ENUM (
  'MOTO',
  'AUTO'
);

CREATE TYPE condicion_vehiculo_luma AS ENUM (
  'NUEVO',
  'USADO'
);

CREATE TYPE luma_estado_inventario AS ENUM (
  'EN_STOCK',
  'RESERVADO',
  'EN_TRASLADO',
  'EN_ACONDICIONAMIENTO',
  'VENDIDO',
  'ENTREGADO',
  'BLOQUEADO',
  'DADO_DE_BAJA'
);

CREATE TYPE origen_adquisicion_luma AS ENUM (
  'PROVEEDOR',
  'TOMA_PARTE_PAGO',
  'OTRO'
);

CREATE TYPE tipo_movimiento_inventario_luma AS ENUM (
  'RECEPCION',
  'RESERVA',
  'LIBERACION',
  'TRASLADO',
  'VENTA',
  'ENTREGA',
  'DEVOLUCION',
  'AJUSTE',
  'TOMA_PARTE_PAGO'
);

CREATE TYPE estado_reserva_luma AS ENUM (
  'ACTIVO',
  'LIBERADA',
  'VENCIDA',
  'CONSUMIDA'
);

CREATE TYPE estado_abastecimiento_luma AS ENUM (
  'PENDIENTE_APROBACION',
  'PENDIENTE_CONFIRMACION',
  'CONFIRMADO',
  'PEDIDO',
  'EN_TRANSITO',
  'RECIBIDO',
  'ASIGNADO',
  'CANCELADA'
);

CREATE TYPE luma_estado_operacion AS ENUM (
  'BORRADOR',
  'PENDIENTE_APROBACION',
  'APROBADA',
  'RECHAZADA',
  'CANCELADA',
  'CERRADA'
);

CREATE TYPE rol_asignacion_luma AS ENUM (
  'VENDEDOR',
  'CONTACTO'
);

CREATE TYPE decision_aprobacion_luma AS ENUM (
  'PENDIENTE',
  'APROBADA',
  'RECHAZADA'
);

CREATE TYPE luma_estado_entrega AS ENUM (
  'NO_PROGRAMADA',
  'PROGRAMADA',
  'LISTA',
  'ENTREGADO',
  'CANCELADA'
);

CREATE TYPE estado_documentacion_luma AS ENUM (
  'NO_INICIADA',
  'PENDIENTE',
  'PARCIAL',
  'COMPLETA',
  'NO_APLICA'
);

CREATE TYPE tipo_obligacion_luma AS ENUM (
  'PAGO',
  'DOCUMENTACION',
  'ACCESORIO',
  'OTRO'
);

CREATE TYPE estado_obligacion_luma AS ENUM (
  'ABIERTA',
  'RESUELTA',
  'CANCELADA'
);

CREATE TYPE estado_toma_parte_pago_luma AS ENUM (
  'OFRECIDO',
  'ACEPTADO',
  'RECHAZADA',
  'RECIBIDO'
);

CREATE TYPE tipo_componente_pago_luma AS ENUM (
  'EFECTIVO',
  'TRANSFERENCIA_BANCARIA',
  'TARJETA',
  'FINANCIACION',
  'TOMA_PARTE_PAGO',
  'OTRO'
);

CREATE TYPE luma_estado_pago AS ENUM (
  'NO_EXIGIBLE',
  'PENDIENTE',
  'PAGO_PARCIAL',
  'PAGADO',
  'VENCIDO',
  'CANCELADA',
  'REINTEGRADO'
);

CREATE TYPE metodo_cobranza_luma AS ENUM (
  'EFECTIVO',
  'TRANSFERENCIA_BANCARIA',
  'TARJETA',
  'DESEMBOLSO_FINANCIERA',
  'PAGARE',
  'OTRO'
);

CREATE TYPE luma_cobranza_estado AS ENUM (
  'PENDIENTE',
  'CONTABILIZADA',
  'REVERSADA',
  'CANCELADA'
);

CREATE TYPE tipo_cuenta_caja_luma AS ENUM (
  'CAJA',
  'BANCO',
  'SOCIO',
  'PROCESADORA_TARJETA',
  'FINANCIERA',
  'OTRO'
);

CREATE TYPE estado_transferencia_caja_luma AS ENUM (
  'PENDIENTE',
  'CONTABILIZADA',
  'CANCELADA'
);

CREATE TYPE tipo_movimiento_caja_luma AS ENUM (
  'INGRESO',
  'EGRESO',
  'TRANSFERENCIA_ENTRANTE',
  'TRANSFERENCIA_SALIENTE',
  'REINTEGRO',
  'AJUSTE'
);

CREATE TYPE direccion_caja_luma AS ENUM (
  'CREDITO',
  'DEBITO'
);

CREATE TYPE estado_lote_importacion_luma AS ENUM (
  'PENDIENTE',
  'PROCESANDO',
  'COMPLETADO',
  'FALLIDO'
);

CREATE TYPE estado_fila_importacion_luma AS ENUM (
  'PENDIENTE',
  'NORMALIZADA',
  'IMPORTADA',
  'EN_CUARENTENA',
  'OMITIDA'
);

CREATE TABLE sucursales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo varchar(40) NOT NULL UNIQUE, nombre varchar(140) NOT NULL UNIQUE, direccion text, activa boolean NOT NULL DEFAULT true, creado_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now());
CREATE TABLE roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo varchar(50) NOT NULL UNIQUE, nombre varchar(100) NOT NULL UNIQUE, descripcion varchar(240) NOT NULL, activo boolean NOT NULL DEFAULT true, creado_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now());
CREATE TABLE usuarios (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rol_id uuid REFERENCES roles(id) ON DELETE RESTRICT, sucursal_id uuid REFERENCES sucursales(id) ON DELETE RESTRICT, correo varchar(254) NOT NULL, correo_normalizado varchar(254) NOT NULL UNIQUE, hash_contrasena varchar(255) NOT NULL, activo boolean NOT NULL DEFAULT true, ultimo_inicio_sesion_en timestamptz, creado_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now());
CREATE TABLE registros_auditoria (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), usuario_id uuid REFERENCES usuarios(id) ON DELETE SET NULL, entidad varchar(100) NOT NULL, entidad_id uuid, accion varchar(100) NOT NULL, datos_anteriores jsonb, datos_nuevos jsonb, direccion_ip inet, creado_en timestamptz NOT NULL DEFAULT now());
CREATE INDEX registros_auditoria_entidad_indice ON registros_auditoria (entidad, entidad_id, creado_en DESC);
INSERT INTO sucursales (codigo, nombre) VALUES ('SAN_MIGUEL', 'San Miguel'), ('DEL_VISO', 'Del Viso');
INSERT INTO roles (codigo, nombre, descripcion) VALUES ('VENDEDOR', 'Vendedor', 'Personal de ventas'), ('ADMINISTRATIVA', 'Administrativa', 'Personal administrativo'), ('ADMINISTRADOR', 'Administrador', 'Administracion integral del sistema'), ('GERENTE', 'Gerente', 'Gestion comercial y operativa');
CREATE OR REPLACE FUNCTION luma_establecer_actualizado_en() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.actualizado_en = now(); RETURN NEW; END $$;
CREATE TRIGGER disparador_sucursales_actualizado_en BEFORE UPDATE ON sucursales FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();
CREATE TRIGGER disparador_roles_actualizado_en BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();
CREATE TRIGGER disparador_usuarios_actualizado_en BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TABLE permisos (
  codigo varchar(100) PRIMARY KEY,
  modulo varchar(80) NOT NULL,
  descripcion varchar(240) NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permisos_rol (
  rol_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  codigo_permiso varchar(100) NOT NULL REFERENCES permisos(codigo) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rol_id, codigo_permiso)
);

INSERT INTO permisos (codigo, modulo, descripcion)
VALUES
  ('operaciones.crear', 'operaciones', 'Crear operaciones comerciales'),
  ('operaciones.consultar.propias', 'operaciones', 'Consultar operaciones propias'),
  ('operaciones.consultar.todas', 'operaciones', 'Consultar todas las operaciones'),
  ('operaciones.aprobar', 'operaciones', 'Aprobar o rechazar excepciones de precio'),
  ('credito.gestionar', 'credito', 'Registrar antecedentes y consultas crediticias'),
  ('stock.consultar', 'stock', 'Consultar inventario'),
  ('stock.reservar', 'stock', 'Reservar unidades o disponibilidad de proveedor'),
  ('stock.trasladar', 'stock', 'Trasladar unidades entre sucursales'),
  ('stock.abastecer', 'stock', 'Gestionar abastecimiento desde proveedores'),
  ('stock.recibir', 'stock', 'Registrar recepciones y asignar chasis'),
  ('stock.etiquetas', 'stock', 'Generar etiquetas de inventario'),
  ('proveedores.gestionar', 'proveedores', 'Gestionar proveedores y compras'),
  ('cobranzas.gestionar', 'finanzas', 'Registrar y consultar cobranzas'),
  ('gastos.gestionar', 'finanzas', 'Gestionar gastos'),
  ('caja.gestionar', 'finanzas', 'Gestionar cajas, cuentas y transferencias'),
  ('precios.gestionar', 'precios', 'Definir precios sugeridos y minimos'),
  ('comisiones.consultar', 'comisiones', 'Consultar comisiones sugeridas'),
  ('comisiones.acordar', 'comisiones', 'Registrar comisiones acordadas'),
  ('comisiones.historial', 'comisiones', 'Consultar comisiones y pagos')
ON CONFLICT (codigo) DO UPDATE SET modulo = EXCLUDED.modulo, descripcion = EXCLUDED.descripcion;
WITH mapa_permiso(nombre_rol, codigo_permiso) AS (
  VALUES
    ('vendedor', 'operaciones.crear'), ('vendedor', 'operaciones.consultar.propias'), ('vendedor', 'credito.gestionar'), ('vendedor', 'stock.consultar'),
    ('administrativa', 'operaciones.crear'), ('administrativa', 'operaciones.consultar.todas'), ('administrativa', 'credito.gestionar'), ('administrativa', 'stock.consultar'), ('administrativa', 'stock.reservar'), ('administrativa', 'stock.abastecer'), ('administrativa', 'stock.recibir'), ('administrativa', 'proveedores.gestionar'), ('administrativa', 'cobranzas.gestionar'), ('administrativa', 'gastos.gestionar'),
    ('gerente', 'operaciones.crear'), ('gerente', 'operaciones.consultar.todas'), ('gerente', 'credito.gestionar'), ('gerente', 'stock.consultar'), ('gerente', 'comisiones.consultar'), ('gerente', 'comisiones.acordar'), ('gerente', 'comisiones.historial'), ('gerente', 'precios.gestionar')
)
INSERT INTO permisos_rol (rol_id, codigo_permiso)
SELECT r.id, mapa_permiso.codigo_permiso FROM roles r JOIN mapa_permiso ON lower(trim(r.nombre)) = mapa_permiso.nombre_rol
ON CONFLICT DO NOTHING;
INSERT INTO permisos_rol (rol_id, codigo_permiso)
SELECT r.id, p.codigo FROM roles r CROSS JOIN permisos p WHERE lower(trim(r.nombre)) = 'administrador'
ON CONFLICT DO NOTHING;

CREATE TABLE personal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid UNIQUE REFERENCES usuarios(id) ON DELETE RESTRICT,
  codigo_empleado varchar(40) UNIQUE,
  nombre_completo varchar(160) NOT NULL,
  nombre_normalizado varchar(160) NOT NULL,
  correo_normalizado varchar(254),
  telefono varchar(40),
  direccion text,
  sucursal_principal_id uuid REFERENCES sucursales(id) ON DELETE RESTRICT,
  rol_id uuid REFERENCES roles(id) ON DELETE RESTRICT,
  puede_iniciar_sesion boolean NOT NULL DEFAULT false,
  estado luma_personal_estado NOT NULL DEFAULT 'ACTIVO',
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_iniciar_sesion_contrato CHECK (
    NOT puede_iniciar_sesion OR (usuario_id IS NOT NULL AND rol_id IS NOT NULL)
  ),
  CONSTRAINT personal_nombre_normalizado_presente CHECK (length(trim(nombre_normalizado)) > 0)
);

CREATE UNIQUE INDEX personal_correo_normalizado_unico
  ON personal (correo_normalizado)
  WHERE correo_normalizado IS NOT NULL;

CREATE INDEX personal_nombre_trgm_indice
  ON personal USING gin (nombre_normalizado gin_trgm_ops);

CREATE TABLE acceso_personal_sucursal (
  personal_id uuid NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  sucursal_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (personal_id, sucursal_id)
);

CREATE TABLE clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_documento tipo_documento_luma,
  numero_documento varchar(30),
  documento_normalizado varchar(30),
  nombre_completo varchar(180) NOT NULL,
  nombre_normalizado varchar(180) NOT NULL,
  telefono varchar(40),
  correo varchar(254),
  direccion text,
  notas text,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cliente_documento_todo_o_nada CHECK (
    (tipo_documento IS NULL AND numero_documento IS NULL AND documento_normalizado IS NULL)
    OR
    (tipo_documento IS NOT NULL AND numero_documento IS NOT NULL AND documento_normalizado IS NOT NULL)
  ),
  CONSTRAINT cliente_nombre_normalizado_presente CHECK (length(trim(nombre_normalizado)) > 0)
);

CREATE UNIQUE INDEX clientes_documento_unico
  ON clientes (tipo_documento, documento_normalizado)
  WHERE documento_normalizado IS NOT NULL;

CREATE INDEX clientes_nombre_trgm_indice
  ON clientes USING gin (nombre_normalizado gin_trgm_ops);

CREATE INDEX clientes_telefono_indice
  ON clientes (telefono)
  WHERE telefono IS NOT NULL;

CREATE TABLE financieras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razon_social varchar(180) NOT NULL,
  nombre_normalizado varchar(180) NOT NULL,
  identificacion_fiscal varchar(30),
  datos_contacto jsonb,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX financieras_identificacion_fiscal_unico
  ON financieras (identificacion_fiscal)
  WHERE identificacion_fiscal IS NOT NULL;

CREATE UNIQUE INDEX financieras_nombre_normalizado_unico
  ON financieras (nombre_normalizado);

CREATE TABLE marcas_vehiculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre varchar(120) NOT NULL,
  nombre_normalizado varchar(120) NOT NULL UNIQUE,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE modelos_vehiculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marca_id uuid NOT NULL REFERENCES marcas_vehiculos(id) ON DELETE RESTRICT,
  tipo_vehiculo tipo_vehiculo_luma NOT NULL,
  nombre varchar(140) NOT NULL,
  nombre_normalizado varchar(140) NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (marca_id, tipo_vehiculo, nombre_normalizado)
);

CREATE INDEX modelos_vehiculos_busqueda_indice
  ON modelos_vehiculos USING gin (nombre_normalizado gin_trgm_ops);

CREATE TABLE versiones_vehiculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id uuid NOT NULL REFERENCES modelos_vehiculos(id) ON DELETE RESTRICT,
  nombre varchar(140) NOT NULL,
  nombre_normalizado varchar(140) NOT NULL,
  es_marcador boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (modelo_id, nombre_normalizado)
);

CREATE TABLE politicas_precios_vehiculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES versiones_vehiculos(id) ON DELETE RESTRICT,
  sucursal_id uuid REFERENCES sucursales(id) ON DELETE RESTRICT,
  moneda char(3) NOT NULL DEFAULT 'ARS',
  precio_lista numeric(18, 2) NOT NULL,
  precio_minimo numeric(18, 2) NOT NULL,
  vigente_desde date NOT NULL,
  vigente_hasta date,
  creado_por_personal_id uuid NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT politica_precio_importes_valido CHECK (
    precio_lista >= 0 AND precio_minimo >= 0 AND precio_minimo <= precio_lista
  ),
  CONSTRAINT politica_precio_rango_valido CHECK (
    vigente_hasta IS NULL OR vigente_hasta > vigente_desde
  )
);

CREATE UNIQUE INDEX politicas_precios_vehiculos_vigente_unico
  ON politicas_precios_vehiculos (version_id, coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE vigente_hasta IS NULL;

CREATE INDEX politicas_precios_vehiculos_consulta_indice
  ON politicas_precios_vehiculos (version_id, sucursal_id, vigente_desde DESC);

CREATE TABLE proveedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razon_social varchar(180) NOT NULL,
  nombre_normalizado varchar(180) NOT NULL,
  identificacion_fiscal varchar(30),
  direccion text,
  nombre_contacto varchar(160),
  telefono varchar(40),
  notas text,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX proveedores_identificacion_fiscal_unico
  ON proveedores (identificacion_fiscal)
  WHERE identificacion_fiscal IS NOT NULL;

CREATE UNIQUE INDEX proveedores_nombre_normalizado_unico
  ON proveedores (nombre_normalizado);

CREATE TABLE disponibilidad_proveedor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id uuid NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES versiones_vehiculos(id) ON DELETE RESTRICT,
  condicion condicion_vehiculo_luma NOT NULL,
  cantidad_informada integer NOT NULL,
  informado_en timestamptz NOT NULL,
  vence_en timestamptz,
  notas text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT disponibilidad_proveedor_cantidad_valido CHECK (cantidad_informada >= 0),
  CONSTRAINT disponibilidad_proveedor_vencimiento_valido CHECK (
    vence_en IS NULL OR vence_en > informado_en
  ),
  UNIQUE (proveedor_id, version_id, condicion)
);

CREATE INDEX disponibilidad_proveedor_consulta_indice
  ON disponibilidad_proveedor (version_id, condicion, informado_en DESC);

CREATE TABLE unidades_vehiculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES versiones_vehiculos(id) ON DELETE RESTRICT,
  condicion condicion_vehiculo_luma NOT NULL,
  vin_mostrado varchar(40) NOT NULL,
  vin_normalizado varchar(32) NOT NULL UNIQUE,
  numero_motor varchar(60),
  motor_normalizado varchar(60),
  patente varchar(20),
  patente_normalizada varchar(20),
  anio_fabricacion smallint,
  kilometraje_km integer NOT NULL DEFAULT 0,
  color varchar(80),
  sucursal_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  proveedor_id uuid REFERENCES proveedores(id) ON DELETE RESTRICT,
  origen_adquisicion origen_adquisicion_luma NOT NULL,
  costo_compra numeric(18, 2),
  estado_inventario luma_estado_inventario NOT NULL DEFAULT 'EN_STOCK',
  recibido_en timestamptz NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unidad_vehiculo_vin_formato CHECK (vin_normalizado ~ '^[A-Z0-9]{6,32}$'),
  CONSTRAINT vehiculo_unidad_vin_normalizado CHECK (
    vin_normalizado = upper(regexp_replace(vin_mostrado, '[^A-Za-z0-9]', '', 'g'))
  ),
  CONSTRAINT unidad_vehiculo_motor_todo_o_nada CHECK (
    (numero_motor IS NULL AND motor_normalizado IS NULL)
    OR
    (numero_motor IS NOT NULL AND motor_normalizado IS NOT NULL)
  ),
  CONSTRAINT unidad_vehiculo_patente_todo_o_nada CHECK (
    (patente IS NULL AND patente_normalizada IS NULL)
    OR
    (patente IS NOT NULL AND patente_normalizada IS NOT NULL)
  ),
  CONSTRAINT vehiculo_unidad_anio_valido CHECK (
    anio_fabricacion IS NULL OR anio_fabricacion BETWEEN 1886 AND 2100
  ),
  CONSTRAINT vehiculo_unidad_kilometraje_valido CHECK (kilometraje_km >= 0),
  CONSTRAINT vehiculo_unidad_costo_compra_valido CHECK (
    costo_compra IS NULL OR costo_compra >= 0
  )
);

CREATE UNIQUE INDEX unidades_vehiculos_numero_motor_unico
  ON unidades_vehiculos (motor_normalizado)
  WHERE motor_normalizado IS NOT NULL;

CREATE UNIQUE INDEX unidades_vehiculos_patente_unico
  ON unidades_vehiculos (patente_normalizada)
  WHERE patente_normalizada IS NOT NULL;

CREATE INDEX unidades_vehiculos_inventario_consulta_indice
  ON unidades_vehiculos (sucursal_id, estado_inventario, version_id);

CREATE INDEX unidades_vehiculos_vin_trgm_indice
  ON unidades_vehiculos USING gin (vin_normalizado gin_trgm_ops);

CREATE TABLE operaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_operacion bigint GENERATED BY DEFAULT AS IDENTITY UNIQUE,
  sucursal_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES versiones_vehiculos(id) ON DELETE RESTRICT,
  condicion condicion_vehiculo_luma NOT NULL,
  unidad_vehiculo_id uuid REFERENCES unidades_vehiculos(id) ON DELETE RESTRICT,
  fecha_operacion date NOT NULL,
  estado_operacion luma_estado_operacion NOT NULL DEFAULT 'BORRADOR',
  precio_lista numeric(18, 2) NOT NULL,
  precio_minimo numeric(18, 2) NOT NULL,
  precio_acordado numeric(18, 2) NOT NULL,
  moneda char(3) NOT NULL DEFAULT 'ARS',
  estado_entrega luma_estado_entrega NOT NULL DEFAULT 'NO_PROGRAMADA',
  entrega_programada_en timestamptz,
  entregado_en timestamptz,
  estado_documentacion estado_documentacion_luma NOT NULL DEFAULT 'NO_INICIADA',
  documentacion_entregada_en timestamptz,
  creado_por_personal_id uuid NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  notas text,
  version_fila integer NOT NULL DEFAULT 0,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operacion_precios_valido CHECK (
    precio_lista >= 0
    AND precio_minimo >= 0
    AND precio_acordado > 0
    AND precio_minimo <= precio_lista
  ),
  CONSTRAINT operacion_entrega_programacion_valido CHECK (
    estado_entrega <> 'PROGRAMADA' OR entrega_programada_en IS NOT NULL
  ),
  CONSTRAINT operacion_entregado_en_valido CHECK (
    estado_entrega <> 'ENTREGADO' OR entregado_en IS NOT NULL
  ),
  CONSTRAINT operacion_documentacion_entregada_en_valido CHECK (
    estado_documentacion <> 'COMPLETA' OR documentacion_entregada_en IS NOT NULL
  ),
  CONSTRAINT operacion_version_fila_valido CHECK (version_fila >= 0)
);

CREATE UNIQUE INDEX operaciones_activo_vehiculo_unico
  ON operaciones (unidad_vehiculo_id)
  WHERE unidad_vehiculo_id IS NOT NULL
    AND estado_operacion IN ('APROBADA', 'CERRADA');

CREATE INDEX operaciones_sucursal_fecha_indice
  ON operaciones (sucursal_id, fecha_operacion DESC);

CREATE INDEX operaciones_estado_fecha_indice
  ON operaciones (estado_operacion, fecha_operacion DESC);

CREATE INDEX operaciones_cliente_fecha_indice
  ON operaciones (cliente_id, fecha_operacion DESC);

CREATE TABLE asignaciones_personal_operacion (
  operacion_id uuid NOT NULL REFERENCES operaciones(id) ON DELETE RESTRICT,
  personal_id uuid NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  rol_asignacion rol_asignacion_luma NOT NULL,
  porcentaje_comision numeric(5, 2),
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operacion_id, personal_id, rol_asignacion),
  CONSTRAINT operacion_personal_porcentaje_comision_valido CHECK (
    porcentaje_comision IS NULL OR porcentaje_comision BETWEEN 0 AND 100
  )
);

CREATE INDEX asignaciones_personal_operacion_personal_indice
  ON asignaciones_personal_operacion (personal_id, rol_asignacion, operacion_id);

CREATE TABLE aprobaciones_operacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id uuid NOT NULL REFERENCES operaciones(id) ON DELETE RESTRICT,
  decision decision_aprobacion_luma NOT NULL DEFAULT 'PENDIENTE',
  solicitado_por_personal_id uuid NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  decidido_por_personal_id uuid REFERENCES personal(id) ON DELETE RESTRICT,
  solicitado_en timestamptz NOT NULL DEFAULT now(),
  decidido_en timestamptz,
  precio_lista_referencia numeric(18, 2) NOT NULL,
  precio_minimo_referencia numeric(18, 2) NOT NULL,
  precio_acordado_referencia numeric(18, 2) NOT NULL,
  motivo text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operacion_aprobacion_decision_contrato CHECK (
    (
      decision = 'PENDIENTE'
      AND decidido_por_personal_id IS NULL
      AND decidido_en IS NULL
    )
    OR
    (
      decision IN ('APROBADA', 'RECHAZADA')
      AND decidido_por_personal_id IS NOT NULL
      AND decidido_en IS NOT NULL
    )
  ),
  CONSTRAINT operacion_aprobacion_rechazo_motivo CHECK (
    decision <> 'RECHAZADA'
    OR (motivo IS NOT NULL AND length(trim(motivo)) > 0)
  ),
  CONSTRAINT operacion_aprobacion_precios_valido CHECK (
    precio_lista_referencia >= 0
    AND precio_minimo_referencia >= 0
    AND precio_acordado_referencia > 0
    AND precio_minimo_referencia <= precio_lista_referencia
  )
);

CREATE UNIQUE INDEX aprobaciones_operacion_pendiente_unico
  ON aprobaciones_operacion (operacion_id)
  WHERE decision = 'PENDIENTE';

CREATE INDEX aprobaciones_operacion_operacion_indice
  ON aprobaciones_operacion (operacion_id, solicitado_en DESC);

CREATE TABLE obligaciones_operacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id uuid NOT NULL REFERENCES operaciones(id) ON DELETE RESTRICT,
  tipo_obligacion tipo_obligacion_luma NOT NULL,
  descripcion text NOT NULL,
  importe numeric(18, 2),
  fecha_vencimiento date,
  estado estado_obligacion_luma NOT NULL DEFAULT 'ABIERTA',
  resuelto_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operacion_obligacion_importe_valido CHECK (importe IS NULL OR importe >= 0),
  CONSTRAINT operacion_obligacion_resolucion_valido CHECK (
    estado <> 'RESUELTA' OR resuelto_en IS NOT NULL
  )
);

CREATE INDEX obligaciones_operacion_abierta_indice
  ON obligaciones_operacion (operacion_id, fecha_vencimiento)
  WHERE estado = 'ABIERTA';

CREATE TABLE vehiculos_tomados_parte_pago (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id uuid NOT NULL REFERENCES operaciones(id) ON DELETE RESTRICT,
  version_id uuid REFERENCES versiones_vehiculos(id) ON DELETE RESTRICT,
  descripcion_original text NOT NULL,
  vin_mostrado varchar(40),
  vin_normalizado varchar(32),
  numero_motor varchar(60),
  patente varchar(20),
  anio_fabricacion smallint,
  kilometraje_km integer,
  importe_tasado numeric(18, 2) NOT NULL,
  importe_aceptado numeric(18, 2),
  estado estado_toma_parte_pago_luma NOT NULL DEFAULT 'OFRECIDO',
  unidad_vehiculo_resultante_id uuid UNIQUE REFERENCES unidades_vehiculos(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT toma_parte_pago_vin_formato CHECK (
    vin_normalizado IS NULL OR vin_normalizado ~ '^[A-Z0-9]{6,32}$'
  ),
  CONSTRAINT toma_parte_pago_anio_valido CHECK (
    anio_fabricacion IS NULL OR anio_fabricacion BETWEEN 1886 AND 2100
  ),
  CONSTRAINT toma_parte_pago_kilometraje_valido CHECK (kilometraje_km IS NULL OR kilometraje_km >= 0),
  CONSTRAINT toma_parte_pago_importes_valido CHECK (
    importe_tasado >= 0 AND (importe_aceptado IS NULL OR importe_aceptado >= 0)
  ),
  CONSTRAINT toma_parte_pago_aceptacion_valido CHECK (
    estado NOT IN ('ACEPTADO', 'RECIBIDO') OR importe_aceptado IS NOT NULL
  ),
  CONSTRAINT toma_parte_pago_recepcion_valido CHECK (
    estado <> 'RECIBIDO' OR unidad_vehiculo_resultante_id IS NOT NULL
  )
);

CREATE TABLE consultas_crediticias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  financiera_id uuid NOT NULL REFERENCES financieras(id) ON DELETE RESTRICT,
  operacion_id uuid REFERENCES operaciones(id) ON DELETE RESTRICT,
  consultado_en timestamptz NOT NULL,
  resultado resultado_crediticio_luma NOT NULL,
  motivo text,
  consultado_por_personal_id uuid NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  referencia_externa varchar(120),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consulta_crediticia_rechazo_motivo CHECK (
    resultado <> 'RECHAZADA'
    OR (motivo IS NOT NULL AND length(trim(motivo)) > 0)
  )
);

CREATE INDEX consultas_crediticias_cliente_fecha_indice
  ON consultas_crediticias (cliente_id, consultado_en DESC);

CREATE INDEX consultas_crediticias_operacion_indice
  ON consultas_crediticias (operacion_id)
  WHERE operacion_id IS NOT NULL;

CREATE TABLE reservas_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id uuid NOT NULL REFERENCES operaciones(id) ON DELETE RESTRICT,
  unidad_vehiculo_id uuid REFERENCES unidades_vehiculos(id) ON DELETE RESTRICT,
  disponibilidad_proveedor_id uuid REFERENCES disponibilidad_proveedor(id) ON DELETE RESTRICT,
  cantidad smallint NOT NULL DEFAULT 1,
  estado estado_reserva_luma NOT NULL DEFAULT 'ACTIVO',
  vence_en timestamptz NOT NULL,
  creado_por_personal_id uuid NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  liberado_en timestamptz,
  motivo_liberacion text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reserva_stock_destino_exclusivo CHECK (
    (unidad_vehiculo_id IS NOT NULL)::integer
    + (disponibilidad_proveedor_id IS NOT NULL)::integer = 1
  ),
  CONSTRAINT stock_reserva_cantidad_valido CHECK (cantidad > 0),
  CONSTRAINT stock_reserva_unidad_cantidad CHECK (
    unidad_vehiculo_id IS NULL OR cantidad = 1
  ),
  CONSTRAINT stock_reserva_liberacion_contrato CHECK (
    estado = 'ACTIVO'
    OR liberado_en IS NOT NULL
    OR estado = 'CONSUMIDA'
  )
);

CREATE UNIQUE INDEX reservas_stock_activo_unidad_unico
  ON reservas_stock (unidad_vehiculo_id)
  WHERE unidad_vehiculo_id IS NOT NULL AND estado = 'ACTIVO';

CREATE INDEX reservas_stock_operacion_indice
  ON reservas_stock (operacion_id, estado);

CREATE INDEX reservas_stock_proveedor_indice
  ON reservas_stock (disponibilidad_proveedor_id, estado, vence_en)
  WHERE disponibilidad_proveedor_id IS NOT NULL;

CREATE TABLE solicitudes_abastecimiento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id uuid REFERENCES operaciones(id) ON DELETE RESTRICT,
  proveedor_id uuid NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
  disponibilidad_proveedor_id uuid REFERENCES disponibilidad_proveedor(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES versiones_vehiculos(id) ON DELETE RESTRICT,
  condicion condicion_vehiculo_luma NOT NULL,
  sucursal_llegada_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  estado estado_abastecimiento_luma NOT NULL DEFAULT 'PENDIENTE_CONFIRMACION',
  referencia_proveedor varchar(120),
  costo_estimado numeric(18, 2),
  solicitado_en timestamptz NOT NULL DEFAULT now(),
  confirmado_en timestamptz,
  pedido_en timestamptz,
  despachado_en timestamptz,
  recibido_en timestamptz,
  asignado_en timestamptz,
  unidad_vehiculo_recibida_id uuid UNIQUE REFERENCES unidades_vehiculos(id) ON DELETE RESTRICT,
  creado_por_personal_id uuid NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  notas text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solicitud_abastecimiento_costo_estimado_valido CHECK (
    costo_estimado IS NULL OR costo_estimado >= 0
  ),
  CONSTRAINT solicitud_abastecimiento_unidad_recibida_valido CHECK (
    estado NOT IN ('RECIBIDO', 'ASIGNADO') OR unidad_vehiculo_recibida_id IS NOT NULL
  )
);

CREATE INDEX solicitudes_abastecimiento_estado_proveedor_indice
  ON solicitudes_abastecimiento (estado, proveedor_id, solicitado_en);

CREATE INDEX solicitudes_abastecimiento_operacion_indice
  ON solicitudes_abastecimiento (operacion_id)
  WHERE operacion_id IS NOT NULL;

CREATE TABLE movimientos_inventario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidad_vehiculo_id uuid NOT NULL REFERENCES unidades_vehiculos(id) ON DELETE RESTRICT,
  tipo_movimiento tipo_movimiento_inventario_luma NOT NULL,
  sucursal_origen_id uuid REFERENCES sucursales(id) ON DELETE RESTRICT,
  sucursal_destino_id uuid REFERENCES sucursales(id) ON DELETE RESTRICT,
  operacion_id uuid REFERENCES operaciones(id) ON DELETE RESTRICT,
  solicitud_abastecimiento_id uuid REFERENCES solicitudes_abastecimiento(id) ON DELETE RESTRICT,
  ocurrido_en timestamptz NOT NULL DEFAULT now(),
  realizado_por_personal_id uuid NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  notas text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventario_transferencia_sucursales_valido CHECK (
    tipo_movimiento <> 'TRASLADO'
    OR (
      sucursal_origen_id IS NOT NULL
      AND sucursal_destino_id IS NOT NULL
      AND sucursal_origen_id <> sucursal_destino_id
    )
  )
);

CREATE INDEX movimientos_inventario_unidad_fecha_indice
  ON movimientos_inventario (unidad_vehiculo_id, ocurrido_en DESC);

CREATE INDEX movimientos_inventario_operacion_indice
  ON movimientos_inventario (operacion_id)
  WHERE operacion_id IS NOT NULL;

CREATE TABLE compras_proveedor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id uuid NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
  unidad_vehiculo_id uuid REFERENCES unidades_vehiculos(id) ON DELETE RESTRICT,
  solicitud_abastecimiento_id uuid REFERENCES solicitudes_abastecimiento(id) ON DELETE RESTRICT,
  fecha_compra date NOT NULL,
  numero_documento varchar(120),
  importe_base numeric(18, 2) NOT NULL,
  importe_adicional numeric(18, 2) NOT NULL DEFAULT 0,
  importe_total numeric(18, 2) NOT NULL,
  moneda char(3) NOT NULL DEFAULT 'ARS',
  estado_pago luma_estado_pago NOT NULL DEFAULT 'PENDIENTE',
  notas text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proveedor_compra_importes_valido CHECK (
    importe_base >= 0
    AND importe_adicional >= 0
    AND importe_total = importe_base + importe_adicional
  )
);

CREATE UNIQUE INDEX compras_proveedor_documento_unico
  ON compras_proveedor (proveedor_id, numero_documento)
  WHERE numero_documento IS NOT NULL;

CREATE INDEX compras_proveedor_proveedor_fecha_indice
  ON compras_proveedor (proveedor_id, fecha_compra DESC);

CREATE TABLE componentes_pago_operacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id uuid NOT NULL REFERENCES operaciones(id) ON DELETE RESTRICT,
  tipo_componente tipo_componente_pago_luma NOT NULL,
  importe_esperado numeric(18, 2) NOT NULL,
  fecha_vencimiento date,
  financiera_id uuid REFERENCES financieras(id) ON DELETE RESTRICT,
  consulta_crediticia_id uuid REFERENCES consultas_crediticias(id) ON DELETE RESTRICT,
  vehiculo_tomado_id uuid UNIQUE REFERENCES vehiculos_tomados_parte_pago(id) ON DELETE RESTRICT,
  estado_pago luma_estado_pago NOT NULL DEFAULT 'PENDIENTE',
  notas text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pago_componente_importe_valido CHECK (importe_esperado > 0),
  CONSTRAINT componente_pago_financiacion_contrato CHECK (
    tipo_componente <> 'FINANCIACION' OR financiera_id IS NOT NULL
  ),
  CONSTRAINT pago_componente_toma_parte_pago_contrato CHECK (
    (tipo_componente = 'TOMA_PARTE_PAGO' AND vehiculo_tomado_id IS NOT NULL)
    OR
    (tipo_componente <> 'TOMA_PARTE_PAGO' AND vehiculo_tomado_id IS NULL)
  )
);

CREATE INDEX componentes_pago_operacion_operacion_indice
  ON componentes_pago_operacion (operacion_id, estado_pago);

CREATE TABLE cuentas_caja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo varchar(40) NOT NULL UNIQUE,
  nombre varchar(140) NOT NULL,
  tipo_cuenta tipo_cuenta_caja_luma NOT NULL,
  sucursal_id uuid REFERENCES sucursales(id) ON DELETE RESTRICT,
  personal_responsable_id uuid REFERENCES personal(id) ON DELETE RESTRICT,
  moneda char(3) NOT NULL DEFAULT 'ARS',
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cobranzas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  componente_pago_id uuid NOT NULL REFERENCES componentes_pago_operacion(id) ON DELETE RESTRICT,
  importe numeric(18, 2) NOT NULL,
  metodo metodo_cobranza_luma NOT NULL,
  recibido_en timestamptz NOT NULL,
  cuenta_caja_id uuid REFERENCES cuentas_caja(id) ON DELETE RESTRICT,
  referencia_externa varchar(160),
  estado luma_cobranza_estado NOT NULL DEFAULT 'PENDIENTE',
  revierte_a_id uuid UNIQUE REFERENCES cobranzas(id) ON DELETE RESTRICT,
  registrado_por_personal_id uuid NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  notas text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cobranza_importe_valido CHECK (importe > 0),
  CONSTRAINT cobranza_contabilizado_cuenta_valido CHECK (
    estado NOT IN ('CONTABILIZADA', 'REVERSADA') OR cuenta_caja_id IS NOT NULL
  ),
  CONSTRAINT cobranza_revierte_valido CHECK (
    estado <> 'REVERSADA' OR revierte_a_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX cobranzas_referencia_externa_unico
  ON cobranzas (cuenta_caja_id, referencia_externa)
  WHERE referencia_externa IS NOT NULL;

CREATE INDEX cobranzas_componente_fecha_indice
  ON cobranzas (componente_pago_id, recibido_en DESC);

CREATE TABLE gastos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid REFERENCES sucursales(id) ON DELETE RESTRICT,
  operacion_id uuid REFERENCES operaciones(id) ON DELETE RESTRICT,
  unidad_vehiculo_id uuid REFERENCES unidades_vehiculos(id) ON DELETE RESTRICT,
  categoria varchar(100) NOT NULL,
  detalle text NOT NULL,
  fecha_generacion date NOT NULL,
  fecha_vencimiento date,
  importe numeric(18, 2) NOT NULL,
  moneda char(3) NOT NULL DEFAULT 'ARS',
  recuperable boolean NOT NULL DEFAULT false,
  estado_pago luma_estado_pago NOT NULL DEFAULT 'PENDIENTE',
  creado_por_personal_id uuid NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gasto_importe_valido CHECK (importe > 0),
  CONSTRAINT gasto_fecha_vencimiento_valido CHECK (fecha_vencimiento IS NULL OR fecha_vencimiento >= fecha_generacion)
);

CREATE INDEX gastos_sucursal_fecha_indice
  ON gastos (sucursal_id, fecha_generacion DESC);

CREATE INDEX gastos_operacion_indice
  ON gastos (operacion_id)
  WHERE operacion_id IS NOT NULL;

CREATE TABLE liquidaciones_comisiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_id uuid NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  sucursal_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  periodo_desde date NOT NULL,
  periodo_hasta date NOT NULL,
  cantidad_ventas integer NOT NULL,
  importe_sugerido numeric(18, 2) NOT NULL,
  importe_acordado numeric(18, 2),
  acordado_en timestamptz,
  acordado_por_personal_id uuid REFERENCES personal(id) ON DELETE RESTRICT,
  estado_pago luma_estado_pago NOT NULL DEFAULT 'PENDIENTE',
  notas text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comision_periodo_valido CHECK (periodo_hasta >= periodo_desde),
  CONSTRAINT comision_cantidad_ventas_valido CHECK (cantidad_ventas >= 0),
  CONSTRAINT comision_importes_valido CHECK (
    importe_sugerido >= 0 AND (importe_acordado IS NULL OR importe_acordado >= 0)
  ),
  CONSTRAINT comision_agreement_valido CHECK (
    importe_acordado IS NULL
    OR (acordado_en IS NOT NULL AND acordado_por_personal_id IS NOT NULL)
  ),
  UNIQUE (personal_id, sucursal_id, periodo_desde, periodo_hasta)
);

CREATE TABLE operaciones_liquidacion_comision (
  liquidacion_id uuid NOT NULL REFERENCES liquidaciones_comisiones(id) ON DELETE RESTRICT,
  operacion_id uuid NOT NULL REFERENCES operaciones(id) ON DELETE RESTRICT,
  base_comision numeric(18, 2) NOT NULL,
  importe_sugerido numeric(18, 2) NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (liquidacion_id, operacion_id),
  CONSTRAINT comision_operacion_importes_valido CHECK (
    base_comision >= 0 AND importe_sugerido >= 0
  )
);

CREATE INDEX operaciones_liquidacion_comision_operacion_indice
  ON operaciones_liquidacion_comision (operacion_id);

CREATE TABLE transferencias_caja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_origen_id uuid NOT NULL REFERENCES cuentas_caja(id) ON DELETE RESTRICT,
  cuenta_destino_id uuid NOT NULL REFERENCES cuentas_caja(id) ON DELETE RESTRICT,
  importe numeric(18, 2) NOT NULL,
  transferenciaido_en timestamptz NOT NULL,
  referencia varchar(160),
  estado estado_transferencia_caja_luma NOT NULL DEFAULT 'PENDIENTE',
  creado_por_personal_id uuid NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caja_transferencia_cuentas_valido CHECK (cuenta_origen_id <> cuenta_destino_id),
  CONSTRAINT caja_transferencia_importe_valido CHECK (importe > 0)
);

CREATE TABLE movimientos_caja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_caja_id uuid NOT NULL REFERENCES cuentas_caja(id) ON DELETE RESTRICT,
  tipo_movimiento tipo_movimiento_caja_luma NOT NULL,
  direccion direccion_caja_luma NOT NULL,
  importe numeric(18, 2) NOT NULL,
  contabilizado_en timestamptz NOT NULL,
  cobranza_id uuid REFERENCES cobranzas(id) ON DELETE RESTRICT,
  transferencia_id uuid REFERENCES transferencias_caja(id) ON DELETE RESTRICT,
  gasto_id uuid REFERENCES gastos(id) ON DELETE RESTRICT,
  compra_proveedor_id uuid REFERENCES compras_proveedor(id) ON DELETE RESTRICT,
  liquidacion_comision_id uuid REFERENCES liquidaciones_comisiones(id) ON DELETE RESTRICT,
  revierte_a_id uuid UNIQUE REFERENCES movimientos_caja(id) ON DELETE RESTRICT,
  referencia varchar(160),
  notas text,
  registrado_por_personal_id uuid NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caja_movimiento_importe_valido CHECK (importe > 0),
  CONSTRAINT caja_movimiento_direccion_valido CHECK (
    (tipo_movimiento IN ('INGRESO', 'TRANSFERENCIA_ENTRANTE') AND direccion = 'CREDITO')
    OR
    (tipo_movimiento IN ('EGRESO', 'TRANSFERENCIA_SALIENTE', 'REINTEGRO') AND direccion = 'DEBITO')
    OR
    tipo_movimiento = 'AJUSTE'
  ),
  CONSTRAINT caja_movimiento_origen_contrato CHECK (
    tipo_movimiento = 'AJUSTE'
    OR (
      (cobranza_id IS NOT NULL)::integer
      + (transferencia_id IS NOT NULL)::integer
      + (gasto_id IS NOT NULL)::integer
      + (compra_proveedor_id IS NOT NULL)::integer
      + (liquidacion_comision_id IS NOT NULL)::integer
      + (revierte_a_id IS NOT NULL)::integer = 1
    )
  ),
  CONSTRAINT caja_movimiento_transferencia_contrato CHECK (
    tipo_movimiento NOT IN ('TRANSFERENCIA_ENTRANTE', 'TRANSFERENCIA_SALIENTE') OR transferencia_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX movimientos_caja_cobranza_unico
  ON movimientos_caja (cobranza_id)
  WHERE cobranza_id IS NOT NULL;

CREATE INDEX movimientos_caja_cuenta_fecha_indice
  ON movimientos_caja (cuenta_caja_id, contabilizado_en DESC);

CREATE INDEX movimientos_caja_gasto_indice
  ON movimientos_caja (gasto_id)
  WHERE gasto_id IS NOT NULL;

CREATE INDEX movimientos_caja_compra_proveedor_indice
  ON movimientos_caja (compra_proveedor_id)
  WHERE compra_proveedor_id IS NOT NULL;

CREATE INDEX movimientos_caja_comision_indice
  ON movimientos_caja (liquidacion_comision_id)
  WHERE liquidacion_comision_id IS NOT NULL;

CREATE TABLE lotes_importacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_archivo_origen text NOT NULL,
  sha256_origen char(64) NOT NULL UNIQUE,
  estado estado_lote_importacion_luma NOT NULL DEFAULT 'PENDIENTE',
  total_filas integer NOT NULL DEFAULT 0,
  filas_importadas integer NOT NULL DEFAULT 0,
  filas_cuarentena integer NOT NULL DEFAULT 0,
  iniciado_en timestamptz,
  finalizado_en timestamptz,
  creado_por_personal_id uuid REFERENCES personal(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT importacion_lote_counts_valido CHECK (
    total_filas >= 0
    AND filas_importadas >= 0
    AND filas_cuarentena >= 0
    AND filas_importadas + filas_cuarentena <= total_filas
  )
);

CREATE TABLE filas_importacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL REFERENCES lotes_importacion(id) ON DELETE RESTRICT,
  nombre_hoja varchar(160) NOT NULL,
  nombre_bloque varchar(160) NOT NULL DEFAULT 'predeterminado',
  fila_origen integer NOT NULL,
  carga_original jsonb NOT NULL,
  hash_original char(64) NOT NULL,
  carga_normalizada jsonb,
  estado estado_fila_importacion_luma NOT NULL DEFAULT 'PENDIENTE',
  codigos_error jsonb NOT NULL DEFAULT '[]'::jsonb,
  referencias_destino jsonb NOT NULL DEFAULT '[]'::jsonb,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT importacion_fila_numero_valido CHECK (fila_origen > 0),
  CONSTRAINT importacion_fila_codigos_error_array CHECK (jsonb_typeof(codigos_error) = 'array'),
  CONSTRAINT fila_importacion_referencias_destino_arreglo CHECK (jsonb_typeof(referencias_destino) = 'array'),
  UNIQUE (lote_id, nombre_hoja, nombre_bloque, fila_origen)
);

CREATE INDEX filas_importacion_lote_estado_indice
  ON filas_importacion (lote_id, estado, nombre_hoja, fila_origen);

CREATE INDEX filas_importacion_hash_original_indice
  ON filas_importacion (hash_original);

DO $$
DECLARE
  nombre_tabla text;
BEGIN
  FOREACH nombre_tabla IN ARRAY ARRAY[
    'personal',
    'clientes',
    'financieras',
    'marcas_vehiculos',
    'modelos_vehiculos',
    'versiones_vehiculos',
    'politicas_precios_vehiculos',
    'proveedores',
    'disponibilidad_proveedor',
    'unidades_vehiculos',
    'operaciones',
    'aprobaciones_operacion',
    'obligaciones_operacion',
    'vehiculos_tomados_parte_pago',
    'consultas_crediticias',
    'reservas_stock',
    'solicitudes_abastecimiento',
    'compras_proveedor',
    'componentes_pago_operacion',
    'cuentas_caja',
    'cobranzas',
    'gastos',
    'liquidaciones_comisiones',
    'transferencias_caja',
    'lotes_importacion',
    'filas_importacion'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en()',
      'disparador_' || nombre_tabla || '_actualizado_en',
      nombre_tabla
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION luma_validar_reserva_capacidad()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  unidad_estado luma_estado_inventario;
  cantidad_disponible integer;
  cantidad_comprometida integer;
BEGIN
  IF NEW.estado <> 'ACTIVO' THEN
    RETURN NEW;
  END IF;

  IF NEW.unidad_vehiculo_id IS NOT NULL THEN
    SELECT estado_inventario
    INTO unidad_estado
    FROM unidades_vehiculos
    WHERE id = NEW.unidad_vehiculo_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La unidad de vehiculo % no existe', NEW.unidad_vehiculo_id;
    END IF;

    IF unidad_estado NOT IN ('EN_STOCK', 'RESERVADO') THEN
      RAISE EXCEPTION 'La unidad de vehiculo % no puede reservarse desde el estado %',
        NEW.unidad_vehiculo_id,
        unidad_estado;
    END IF;

    RETURN NEW;
  END IF;

  SELECT cantidad_informada
  INTO cantidad_disponible
  FROM disponibilidad_proveedor
  WHERE id = NEW.disponibilidad_proveedor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La disponibilidad del proveedor % no existe',
      NEW.disponibilidad_proveedor_id;
  END IF;

  SELECT coalesce(sum(cantidad), 0)
  INTO cantidad_comprometida
  FROM reservas_stock
  WHERE disponibilidad_proveedor_id = NEW.disponibilidad_proveedor_id
    AND estado = 'ACTIVO'
    AND id <> NEW.id;

  IF cantidad_comprometida + NEW.cantidad > cantidad_disponible THEN
    RAISE EXCEPTION
      'La disponibilidad del proveedor % tiene % unidades y % ya estan comprometidas',
      NEW.disponibilidad_proveedor_id,
      cantidad_disponible,
      cantidad_comprometida;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER disparador_reservas_stock_capacidad
BEFORE INSERT OR UPDATE OF
  unidad_vehiculo_id,
  disponibilidad_proveedor_id,
  cantidad,
  estado
ON reservas_stock
FOR EACH ROW
EXECUTE FUNCTION luma_validar_reserva_capacidad();

CREATE OR REPLACE FUNCTION luma_proteger_cantidad_disponibilidad_proveedor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cantidad_comprometida integer;
BEGIN
  IF NEW.cantidad_informada = OLD.cantidad_informada THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(sum(cantidad), 0)
  INTO cantidad_comprometida
  FROM reservas_stock
  WHERE disponibilidad_proveedor_id = NEW.id
    AND estado = 'ACTIVO';

  IF NEW.cantidad_informada < cantidad_comprometida THEN
    RAISE EXCEPTION
      'La cantidad informada % no puede ser menor que las % unidades reservadas activamente',
      NEW.cantidad_informada,
      cantidad_comprometida;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER disparador_disponibilidad_proveedor_cantidad
BEFORE UPDATE OF cantidad_informada
ON disponibilidad_proveedor
FOR EACH ROW
EXECUTE FUNCTION luma_proteger_cantidad_disponibilidad_proveedor();

CREATE OR REPLACE FUNCTION luma_validar_operacion_invariantes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  total_planificado numeric(18, 2);
BEGIN
  IF NEW.estado_operacion IN ('APROBADA', 'CERRADA')
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

CREATE CONSTRAINT TRIGGER disparador_operaciones_invariantes
AFTER INSERT OR UPDATE
ON operaciones
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION luma_validar_operacion_invariantes();

CREATE OR REPLACE FUNCTION luma_validar_pago_plan_cambio()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  operacion_objetivo_id uuid;
  operacion_objetivo operaciones%ROWTYPE;
  total_planificado numeric(18, 2);
  anterior_operacion operaciones%ROWTYPE;
  anterior_total_planificado numeric(18, 2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    operacion_objetivo_id := OLD.operacion_id;
  ELSE
    operacion_objetivo_id := NEW.operacion_id;
  END IF;

  SELECT *
  INTO operacion_objetivo
  FROM operaciones
  WHERE id = operacion_objetivo_id;

  IF operacion_objetivo.estado_operacion = 'CERRADA' THEN
    SELECT coalesce(sum(importe_esperado), 0)
    INTO total_planificado
    FROM componentes_pago_operacion
    WHERE operacion_id = operacion_objetivo_id
      AND estado_pago <> 'CANCELADA';

    IF total_planificado <> operacion_objetivo.precio_acordado THEN
      RAISE EXCEPTION
        'La operacion cerrada % tiene un total planificado de pagos %, esperado %',
        operacion_objetivo_id,
        total_planificado,
        operacion_objetivo.precio_acordado;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.operacion_id IS DISTINCT FROM NEW.operacion_id
  THEN
    SELECT *
    INTO anterior_operacion
    FROM operaciones
    WHERE id = OLD.operacion_id;

    IF anterior_operacion.estado_operacion = 'CERRADA' THEN
      SELECT coalesce(sum(importe_esperado), 0)
      INTO anterior_total_planificado
      FROM componentes_pago_operacion
      WHERE operacion_id = OLD.operacion_id
        AND estado_pago <> 'CANCELADA';

      IF anterior_total_planificado <> anterior_operacion.precio_acordado THEN
        RAISE EXCEPTION
          'La operacion cerrada % tiene un total planificado de pagos %, esperado %',
          OLD.operacion_id,
          anterior_total_planificado,
          anterior_operacion.precio_acordado;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER disparador_componentes_pago_operacion_total
AFTER INSERT OR UPDATE OR DELETE
ON componentes_pago_operacion
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION luma_validar_pago_plan_cambio();

CREATE VIEW resumen_pagos_operacion AS
SELECT
  operacion.id AS operacion_id,
  operacion.precio_acordado,
  coalesce(sum(componente.importe_esperado)
    FILTER (WHERE componente.estado_pago <> 'CANCELADA'), 0)::numeric(18, 2)
    AS total_planificado,
  coalesce(sum(componente.importe_esperado)
    FILTER (
      WHERE componente.estado_pago <> 'CANCELADA'
        AND componente.tipo_componente <> 'TOMA_PARTE_PAGO'
    ), 0)::numeric(18, 2) AS total_monetario_planificado,
  coalesce(sum(componente.importe_esperado)
    FILTER (
      WHERE componente.estado_pago <> 'CANCELADA'
        AND componente.tipo_componente = 'TOMA_PARTE_PAGO'
    ), 0)::numeric(18, 2) AS total_toma_parte_pago_planificado,
  coalesce((
    SELECT sum(
      CASE cobranza.estado
        WHEN 'CONTABILIZADA' THEN cobranza.importe
        WHEN 'REVERSADA' THEN -cobranza.importe
        ELSE 0
      END
    )
    FROM componentes_pago_operacion componente_cobrado
    JOIN cobranzas cobranza
      ON cobranza.componente_pago_id = componente_cobrado.id
    WHERE componente_cobrado.operacion_id = operacion.id
      AND cobranza.estado IN ('CONTABILIZADA', 'REVERSADA')
  ), 0)::numeric(18, 2) AS cobrado_total,
  (
    coalesce(sum(componente.importe_esperado)
      FILTER (
        WHERE componente.estado_pago <> 'CANCELADA'
          AND componente.tipo_componente <> 'TOMA_PARTE_PAGO'
      ), 0)
    - coalesce((
      SELECT sum(
        CASE cobranza.estado
          WHEN 'CONTABILIZADA' THEN cobranza.importe
          WHEN 'REVERSADA' THEN -cobranza.importe
          ELSE 0
        END
      )
      FROM componentes_pago_operacion componente_cobrado
      JOIN cobranzas cobranza
        ON cobranza.componente_pago_id = componente_cobrado.id
      WHERE componente_cobrado.operacion_id = operacion.id
        AND cobranza.estado IN ('CONTABILIZADA', 'REVERSADA')
    ), 0)
  )::numeric(18, 2) AS saldo_monetario
FROM operaciones operacion
LEFT JOIN componentes_pago_operacion componente
  ON componente.operacion_id = operacion.id
GROUP BY operacion.id, operacion.precio_acordado;

CREATE VIEW saldos_cuentas_caja AS
SELECT
  cuenta.id AS cuenta_caja_id,
  cuenta.codigo,
  cuenta.nombre,
  cuenta.moneda,
  coalesce(sum(
    CASE movimiento.direccion
      WHEN 'CREDITO' THEN movimiento.importe
      WHEN 'DEBITO' THEN -movimiento.importe
    END
  ), 0)::numeric(18, 2) AS saldo
FROM cuentas_caja cuenta
LEFT JOIN movimientos_caja movimiento
  ON movimiento.cuenta_caja_id = cuenta.id
GROUP BY cuenta.id, cuenta.codigo, cuenta.nombre, cuenta.moneda;

COMMENT ON TABLE permisos_rol IS
  'Permisos base por rol.';

COMMENT ON TABLE unidades_vehiculos IS
  'Inventario fisico; la disponibilidad sin VIN pertenece a disponibilidad_proveedor.';

COMMENT ON TABLE reservas_stock IS
  'Reservas con bloqueo de concurrencia para unidades fisicas o disponibilidad de proveedor.';

COMMENT ON TABLE movimientos_caja IS
  'Libro de caja inmutable; las correcciones se representan con movimientos de reversion.';

COMMENT ON TABLE filas_importacion IS
  'Contiene datos originales potencialmente sensibles; restringir acceso y no emitir cargas en registros.';

COMMENT ON TABLE registros_auditoria IS
  'Registro de auditoria del esquema nuevo.';

COMMIT;

-- CreateEnum
CREATE TYPE "condicion_vehiculo_luma" AS ENUM ('NUEVO', 'USADO');

-- CreateEnum
CREATE TYPE "decision_aprobacion_luma" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "direccion_caja_luma" AS ENUM ('CREDITO', 'DEBITO');

-- CreateEnum
CREATE TYPE "estado_abastecimiento_luma" AS ENUM ('PENDIENTE_APROBACION', 'PENDIENTE_CONFIRMACION', 'CONFIRMADO', 'PEDIDO', 'EN_TRANSITO', 'RECIBIDO', 'ASIGNADO', 'CANCELADA');

-- CreateEnum
CREATE TYPE "estado_documentacion_luma" AS ENUM ('NO_INICIADA', 'PENDIENTE', 'PARCIAL', 'COMPLETA', 'NO_APLICA');

-- CreateEnum
CREATE TYPE "estado_fila_importacion_luma" AS ENUM ('PENDIENTE', 'NORMALIZADA', 'IMPORTADA', 'EN_CUARENTENA', 'OMITIDA');

-- CreateEnum
CREATE TYPE "estado_lote_importacion_luma" AS ENUM ('PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'FALLIDO');

-- CreateEnum
CREATE TYPE "estado_obligacion_luma" AS ENUM ('ABIERTA', 'RESUELTA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "estado_reserva_luma" AS ENUM ('ACTIVO', 'LIBERADA', 'VENCIDA', 'CONSUMIDA');

-- CreateEnum
CREATE TYPE "estado_toma_parte_pago_luma" AS ENUM ('OFRECIDO', 'ACEPTADO', 'RECHAZADA', 'RECIBIDO');

-- CreateEnum
CREATE TYPE "estado_transferencia_caja_luma" AS ENUM ('PENDIENTE', 'CONTABILIZADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "luma_cobranza_estado" AS ENUM ('PENDIENTE', 'CONTABILIZADA', 'REVERSADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "luma_estado_entrega" AS ENUM ('NO_PROGRAMADA', 'PROGRAMADA', 'LISTA', 'ENTREGADO', 'CANCELADA');

-- CreateEnum
CREATE TYPE "luma_estado_inventario" AS ENUM ('EN_STOCK', 'RESERVADO', 'EN_TRASLADO', 'EN_ACONDICIONAMIENTO', 'VENDIDO', 'ENTREGADO', 'BLOQUEADO', 'DADO_DE_BAJA');

-- CreateEnum
CREATE TYPE "luma_estado_operacion" AS ENUM ('BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'CERRADA');

-- CreateEnum
CREATE TYPE "luma_estado_pago" AS ENUM ('NO_EXIGIBLE', 'PENDIENTE', 'PAGO_PARCIAL', 'PAGADO', 'VENCIDO', 'CANCELADA', 'REINTEGRADO');

-- CreateEnum
CREATE TYPE "luma_personal_estado" AS ENUM ('ACTIVO', 'INACTIVO');

-- CreateEnum
CREATE TYPE "metodo_cobranza_luma" AS ENUM ('EFECTIVO', 'TRANSFERENCIA_BANCARIA', 'TARJETA', 'DESEMBOLSO_FINANCIERA', 'PAGARE', 'OTRO');

-- CreateEnum
CREATE TYPE "origen_adquisicion_luma" AS ENUM ('PROVEEDOR', 'TOMA_PARTE_PAGO', 'OTRO');

-- CreateEnum
CREATE TYPE "resultado_crediticio_luma" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "rol_asignacion_luma" AS ENUM ('VENDEDOR', 'CONTACTO');

-- CreateEnum
CREATE TYPE "tipo_componente_pago_luma" AS ENUM ('EFECTIVO', 'TRANSFERENCIA_BANCARIA', 'TARJETA', 'FINANCIACION', 'TOMA_PARTE_PAGO', 'OTRO');

-- CreateEnum
CREATE TYPE "tipo_cuenta_caja_luma" AS ENUM ('CAJA', 'BANCO', 'SOCIO', 'PROCESADORA_TARJETA', 'FINANCIERA', 'OTRO');

-- CreateEnum
CREATE TYPE "tipo_documento_luma" AS ENUM ('DNI', 'CUIT', 'CI', 'PASAPORTE', 'OTRO');

-- CreateEnum
CREATE TYPE "tipo_movimiento_caja_luma" AS ENUM ('INGRESO', 'EGRESO', 'TRANSFERENCIA_ENTRANTE', 'TRANSFERENCIA_SALIENTE', 'REINTEGRO', 'AJUSTE');

-- CreateEnum
CREATE TYPE "tipo_movimiento_inventario_luma" AS ENUM ('RECEPCION', 'RESERVA', 'LIBERACION', 'TRASLADO', 'VENTA', 'ENTREGA', 'DEVOLUCION', 'AJUSTE', 'TOMA_PARTE_PAGO');

-- CreateEnum
CREATE TYPE "tipo_obligacion_luma" AS ENUM ('PAGO', 'DOCUMENTACION', 'ACCESORIO', 'OTRO');

-- CreateEnum
CREATE TYPE "tipo_vehiculo_luma" AS ENUM ('MOTO', 'AUTO');

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" VARCHAR(50) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" VARCHAR(240) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acceso_personal_sucursal" (
    "personal_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acceso_personal_sucursal_pkey" PRIMARY KEY ("personal_id","sucursal_id")
);

-- CreateTable
CREATE TABLE "aprobaciones_operacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operacion_id" UUID NOT NULL,
    "decision" "decision_aprobacion_luma" NOT NULL DEFAULT 'PENDIENTE',
    "solicitado_por_personal_id" UUID NOT NULL,
    "decidido_por_personal_id" UUID,
    "solicitado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidido_en" TIMESTAMPTZ(6),
    "precio_lista_referencia" DECIMAL(18,2) NOT NULL,
    "precio_minimo_referencia" DECIMAL(18,2) NOT NULL,
    "precio_acordado_referencia" DECIMAL(18,2) NOT NULL,
    "motivo" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aprobaciones_operacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asignaciones_personal_operacion" (
    "operacion_id" UUID NOT NULL,
    "personal_id" UUID NOT NULL,
    "rol_asignacion" "rol_asignacion_luma" NOT NULL,
    "porcentaje_comision" DECIMAL(5,2),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asignaciones_personal_operacion_pkey" PRIMARY KEY ("operacion_id","personal_id","rol_asignacion")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo_documento" "tipo_documento_luma",
    "numero_documento" VARCHAR(30),
    "documento_normalizado" VARCHAR(30),
    "nombre_completo" VARCHAR(180) NOT NULL,
    "nombre_normalizado" VARCHAR(180) NOT NULL,
    "telefono" VARCHAR(40),
    "correo" VARCHAR(254),
    "direccion" TEXT,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cobranzas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "componente_pago_id" UUID NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "metodo" "metodo_cobranza_luma" NOT NULL,
    "recibido_en" TIMESTAMPTZ(6) NOT NULL,
    "cuenta_caja_id" UUID,
    "referencia_externa" VARCHAR(160),
    "estado" "luma_cobranza_estado" NOT NULL DEFAULT 'PENDIENTE',
    "revierte_a_id" UUID,
    "registrado_por_personal_id" UUID NOT NULL,
    "notas" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cobranzas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "componentes_pago_operacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operacion_id" UUID NOT NULL,
    "tipo_componente" "tipo_componente_pago_luma" NOT NULL,
    "importe_esperado" DECIMAL(18,2) NOT NULL,
    "fecha_vencimiento" DATE,
    "financiera_id" UUID,
    "consulta_crediticia_id" UUID,
    "vehiculo_tomado_id" UUID,
    "estado_pago" "luma_estado_pago" NOT NULL DEFAULT 'PENDIENTE',
    "notas" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "componentes_pago_operacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compras_proveedor" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "proveedor_id" UUID NOT NULL,
    "unidad_vehiculo_id" UUID,
    "solicitud_abastecimiento_id" UUID,
    "fecha_compra" DATE NOT NULL,
    "numero_documento" VARCHAR(120),
    "importe_base" DECIMAL(18,2) NOT NULL,
    "importe_adicional" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "importe_total" DECIMAL(18,2) NOT NULL,
    "moneda" CHAR(3) NOT NULL DEFAULT 'ARS',
    "estado_pago" "luma_estado_pago" NOT NULL DEFAULT 'PENDIENTE',
    "notas" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compras_proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultas_crediticias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cliente_id" UUID NOT NULL,
    "financiera_id" UUID NOT NULL,
    "operacion_id" UUID,
    "consultado_en" TIMESTAMPTZ(6) NOT NULL,
    "resultado" "resultado_crediticio_luma" NOT NULL,
    "motivo" TEXT,
    "consultado_por_personal_id" UUID NOT NULL,
    "referencia_externa" VARCHAR(120),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultas_crediticias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuentas_caja" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" VARCHAR(40) NOT NULL,
    "nombre" VARCHAR(140) NOT NULL,
    "tipo_cuenta" "tipo_cuenta_caja_luma" NOT NULL,
    "sucursal_id" UUID,
    "personal_responsable_id" UUID,
    "moneda" CHAR(3) NOT NULL DEFAULT 'ARS',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cuentas_caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disponibilidad_proveedor" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "proveedor_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "condicion" "condicion_vehiculo_luma" NOT NULL,
    "cantidad_informada" INTEGER NOT NULL,
    "informado_en" TIMESTAMPTZ(6) NOT NULL,
    "vence_en" TIMESTAMPTZ(6),
    "notas" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disponibilidad_proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filas_importacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lote_id" UUID NOT NULL,
    "nombre_hoja" VARCHAR(160) NOT NULL,
    "nombre_bloque" VARCHAR(160) NOT NULL DEFAULT 'predeterminado',
    "fila_origen" INTEGER NOT NULL,
    "carga_original" JSONB NOT NULL,
    "hash_original" CHAR(64) NOT NULL,
    "carga_normalizada" JSONB,
    "estado" "estado_fila_importacion_luma" NOT NULL DEFAULT 'PENDIENTE',
    "codigos_error" JSONB NOT NULL DEFAULT '[]',
    "referencias_destino" JSONB NOT NULL DEFAULT '[]',
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "filas_importacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financieras" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "razon_social" VARCHAR(180) NOT NULL,
    "nombre_normalizado" VARCHAR(180) NOT NULL,
    "identificacion_fiscal" VARCHAR(30),
    "datos_contacto" JSONB,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financieras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gastos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sucursal_id" UUID,
    "operacion_id" UUID,
    "unidad_vehiculo_id" UUID,
    "categoria" VARCHAR(100) NOT NULL,
    "detalle" TEXT NOT NULL,
    "fecha_generacion" DATE NOT NULL,
    "fecha_vencimiento" DATE,
    "importe" DECIMAL(18,2) NOT NULL,
    "moneda" CHAR(3) NOT NULL DEFAULT 'ARS',
    "recuperable" BOOLEAN NOT NULL DEFAULT false,
    "estado_pago" "luma_estado_pago" NOT NULL DEFAULT 'PENDIENTE',
    "creado_por_personal_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gastos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidaciones_comisiones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "personal_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "periodo_desde" DATE NOT NULL,
    "periodo_hasta" DATE NOT NULL,
    "cantidad_ventas" INTEGER NOT NULL,
    "importe_sugerido" DECIMAL(18,2) NOT NULL,
    "importe_acordado" DECIMAL(18,2),
    "acordado_en" TIMESTAMPTZ(6),
    "acordado_por_personal_id" UUID,
    "estado_pago" "luma_estado_pago" NOT NULL DEFAULT 'PENDIENTE',
    "notas" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidaciones_comisiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lotes_importacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre_archivo_origen" TEXT NOT NULL,
    "sha256_origen" CHAR(64) NOT NULL,
    "estado" "estado_lote_importacion_luma" NOT NULL DEFAULT 'PENDIENTE',
    "total_filas" INTEGER NOT NULL DEFAULT 0,
    "filas_importadas" INTEGER NOT NULL DEFAULT 0,
    "filas_cuarentena" INTEGER NOT NULL DEFAULT 0,
    "iniciado_en" TIMESTAMPTZ(6),
    "finalizado_en" TIMESTAMPTZ(6),
    "creado_por_personal_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lotes_importacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marcas_vehiculos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" VARCHAR(120) NOT NULL,
    "nombre_normalizado" VARCHAR(120) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marcas_vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modelos_vehiculos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "marca_id" UUID NOT NULL,
    "tipo_vehiculo" "tipo_vehiculo_luma" NOT NULL,
    "nombre" VARCHAR(140) NOT NULL,
    "nombre_normalizado" VARCHAR(140) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modelos_vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_caja" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cuenta_caja_id" UUID NOT NULL,
    "tipo_movimiento" "tipo_movimiento_caja_luma" NOT NULL,
    "direccion" "direccion_caja_luma" NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "contabilizado_en" TIMESTAMPTZ(6) NOT NULL,
    "cobranza_id" UUID,
    "transferenciaencia_id" UUID,
    "gasto_id" UUID,
    "compra_proveedor_id" UUID,
    "liquidacion_comision_id" UUID,
    "revierte_a_id" UUID,
    "referencia" VARCHAR(160),
    "notas" TEXT,
    "registrado_por_personal_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_inventario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unidad_vehiculo_id" UUID NOT NULL,
    "tipo_movimiento" "tipo_movimiento_inventario_luma" NOT NULL,
    "sucursal_origen_id" UUID,
    "sucursal_destino_id" UUID,
    "operacion_id" UUID,
    "solicitud_abastecimiento_id" UUID,
    "ocurrido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "realizado_por_personal_id" UUID NOT NULL,
    "notas" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligaciones_operacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operacion_id" UUID NOT NULL,
    "tipo_obligacion" "tipo_obligacion_luma" NOT NULL,
    "descripcion" TEXT NOT NULL,
    "importe" DECIMAL(18,2),
    "fecha_vencimiento" DATE,
    "estado" "estado_obligacion_luma" NOT NULL DEFAULT 'ABIERTA',
    "resuelto_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obligaciones_operacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operaciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "numero_operacion" BIGSERIAL NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "condicion" "condicion_vehiculo_luma" NOT NULL,
    "unidad_vehiculo_id" UUID,
    "fecha_operacion" DATE NOT NULL,
    "estado_operacion" "luma_estado_operacion" NOT NULL DEFAULT 'BORRADOR',
    "precio_lista" DECIMAL(18,2) NOT NULL,
    "precio_minimo" DECIMAL(18,2) NOT NULL,
    "precio_acordado" DECIMAL(18,2) NOT NULL,
    "moneda" CHAR(3) NOT NULL DEFAULT 'ARS',
    "estado_entrega" "luma_estado_entrega" NOT NULL DEFAULT 'NO_PROGRAMADA',
    "entrega_programada_en" TIMESTAMPTZ(6),
    "entregado_en" TIMESTAMPTZ(6),
    "estado_documentacion" "estado_documentacion_luma" NOT NULL DEFAULT 'NO_INICIADA',
    "documentacion_entregada_en" TIMESTAMPTZ(6),
    "creado_por_personal_id" UUID NOT NULL,
    "notas" TEXT,
    "version_fila" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operaciones_liquidacion_comision" (
    "liquidacion_id" UUID NOT NULL,
    "operacion_id" UUID NOT NULL,
    "base_comision" DECIMAL(18,2) NOT NULL,
    "importe_sugerido" DECIMAL(18,2) NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operaciones_liquidacion_comision_pkey" PRIMARY KEY ("liquidacion_id","operacion_id")
);

-- CreateTable
CREATE TABLE "permisos" (
    "codigo" VARCHAR(100) NOT NULL,
    "modulo" VARCHAR(80) NOT NULL,
    "descripcion" VARCHAR(240) NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permisos_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "permisos_rol" (
    "rol_id" UUID NOT NULL,
    "codigo_permiso" VARCHAR(100) NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permisos_rol_pkey" PRIMARY KEY ("rol_id","codigo_permiso")
);

-- CreateTable
CREATE TABLE "personal" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID,
    "codigo_empleado" VARCHAR(40),
    "nombre_completo" VARCHAR(160) NOT NULL,
    "nombre_normalizado" VARCHAR(160) NOT NULL,
    "correo_normalizado" VARCHAR(254),
    "telefono" VARCHAR(40),
    "direccion" TEXT,
    "sucursal_principal_id" UUID,
    "rol_id" UUID,
    "puede_iniciar_sesion" BOOLEAN NOT NULL DEFAULT false,
    "estado" "luma_personal_estado" NOT NULL DEFAULT 'ACTIVO',
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "politicas_precios_vehiculos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version_id" UUID NOT NULL,
    "sucursal_id" UUID,
    "moneda" CHAR(3) NOT NULL DEFAULT 'ARS',
    "precio_lista" DECIMAL(18,2) NOT NULL,
    "precio_minimo" DECIMAL(18,2) NOT NULL,
    "vigente_desde" DATE NOT NULL,
    "vigente_hasta" DATE,
    "creado_por_personal_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "politicas_precios_vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proveedores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "razon_social" VARCHAR(180) NOT NULL,
    "nombre_normalizado" VARCHAR(180) NOT NULL,
    "identificacion_fiscal" VARCHAR(30),
    "direccion" TEXT,
    "nombre_contacto" VARCHAR(160),
    "telefono" VARCHAR(40),
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_auditoria" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID,
    "entidad" VARCHAR(100) NOT NULL,
    "entidad_id" UUID,
    "accion" VARCHAR(100) NOT NULL,
    "datos_anteriores" JSONB,
    "datos_nuevos" JSONB,
    "direccion_ip" INET,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registros_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservas_stock" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operacion_id" UUID NOT NULL,
    "unidad_vehiculo_id" UUID,
    "disponibilidad_proveedor_id" UUID,
    "cantidad" SMALLINT NOT NULL DEFAULT 1,
    "estado" "estado_reserva_luma" NOT NULL DEFAULT 'ACTIVO',
    "vence_en" TIMESTAMPTZ(6) NOT NULL,
    "creado_por_personal_id" UUID NOT NULL,
    "liberado_en" TIMESTAMPTZ(6),
    "motivo_liberacion" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservas_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes_abastecimiento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operacion_id" UUID,
    "proveedor_id" UUID NOT NULL,
    "disponibilidad_proveedor_id" UUID,
    "version_id" UUID NOT NULL,
    "condicion" "condicion_vehiculo_luma" NOT NULL,
    "sucursal_llegada_id" UUID NOT NULL,
    "estado" "estado_abastecimiento_luma" NOT NULL DEFAULT 'PENDIENTE_CONFIRMACION',
    "referencia_proveedor" VARCHAR(120),
    "costo_estimado" DECIMAL(18,2),
    "solicitado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmado_en" TIMESTAMPTZ(6),
    "pedido_en" TIMESTAMPTZ(6),
    "despachado_en" TIMESTAMPTZ(6),
    "recibido_en" TIMESTAMPTZ(6),
    "asignado_en" TIMESTAMPTZ(6),
    "unidad_vehiculo_recibida_id" UUID,
    "creado_por_personal_id" UUID NOT NULL,
    "notas" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_abastecimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sucursales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" VARCHAR(40) NOT NULL,
    "nombre" VARCHAR(140) NOT NULL,
    "direccion" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sucursales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transferencias_caja" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cuenta_origen_id" UUID NOT NULL,
    "cuenta_destino_id" UUID NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "transferenciaido_en" TIMESTAMPTZ(6) NOT NULL,
    "referencia" VARCHAR(160),
    "estado" "estado_transferencia_caja_luma" NOT NULL DEFAULT 'PENDIENTE',
    "creado_por_personal_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transferencias_caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidades_vehiculos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version_id" UUID NOT NULL,
    "condicion" "condicion_vehiculo_luma" NOT NULL,
    "vin_mostrado" VARCHAR(40) NOT NULL,
    "vin_normalizado" VARCHAR(32) NOT NULL,
    "numero_motor" VARCHAR(60),
    "motor_normalizado" VARCHAR(60),
    "patente" VARCHAR(20),
    "patente_normalizada" VARCHAR(20),
    "anio_fabricacion" SMALLINT,
    "kilometraje_km" INTEGER NOT NULL DEFAULT 0,
    "color" VARCHAR(80),
    "sucursal_id" UUID NOT NULL,
    "proveedor_id" UUID,
    "origen_adquisicion" "origen_adquisicion_luma" NOT NULL,
    "costo_compra" DECIMAL(18,2),
    "estado_inventario" "luma_estado_inventario" NOT NULL DEFAULT 'EN_STOCK',
    "recibido_en" TIMESTAMPTZ(6) NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unidades_vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rol_id" UUID,
    "sucursal_id" UUID,
    "correo" VARCHAR(254) NOT NULL,
    "correo_normalizado" VARCHAR(254) NOT NULL,
    "hash_contrasena" VARCHAR(255) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_inicio_sesion_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehiculos_tomados_parte_pago" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operacion_id" UUID NOT NULL,
    "version_id" UUID,
    "descripcion_original" TEXT NOT NULL,
    "vin_mostrado" VARCHAR(40),
    "vin_normalizado" VARCHAR(32),
    "numero_motor" VARCHAR(60),
    "patente" VARCHAR(20),
    "anio_fabricacion" SMALLINT,
    "kilometraje_km" INTEGER,
    "importe_tasado" DECIMAL(18,2) NOT NULL,
    "importe_aceptado" DECIMAL(18,2),
    "estado" "estado_toma_parte_pago_luma" NOT NULL DEFAULT 'OFRECIDO',
    "unidad_vehiculo_resultante_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehiculos_tomados_parte_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "versiones_vehiculos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "modelo_id" UUID NOT NULL,
    "nombre" VARCHAR(140) NOT NULL,
    "nombre_normalizado" VARCHAR(140) NOT NULL,
    "es_marcador" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "versiones_vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_codigo_key" ON "roles"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "roles_nombre_key" ON "roles"("nombre");

-- CreateIndex
CREATE INDEX "aprobaciones_operacion_operacion_indice" ON "aprobaciones_operacion"("operacion_id", "solicitado_en" DESC);

-- CreateIndex
CREATE INDEX "asignaciones_personal_operacion_personal_indice" ON "asignaciones_personal_operacion"("personal_id", "rol_asignacion", "operacion_id");

-- CreateIndex
CREATE INDEX "clientes_nombre_trgm_indice" ON "clientes" USING GIN ("nombre_normalizado" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "cobranzas_revierte_a_id_key" ON "cobranzas"("revierte_a_id");

-- CreateIndex
CREATE INDEX "cobranzas_componente_fecha_indice" ON "cobranzas"("componente_pago_id", "recibido_en" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "componentes_pago_operacion_vehiculo_tomado_id_key" ON "componentes_pago_operacion"("vehiculo_tomado_id");

-- CreateIndex
CREATE INDEX "componentes_pago_operacion_operacion_indice" ON "componentes_pago_operacion"("operacion_id", "estado_pago");

-- CreateIndex
CREATE INDEX "compras_proveedor_proveedor_fecha_indice" ON "compras_proveedor"("proveedor_id", "fecha_compra" DESC);

-- CreateIndex
CREATE INDEX "consultas_crediticias_cliente_fecha_indice" ON "consultas_crediticias"("cliente_id", "consultado_en" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "cuentas_caja_codigo_key" ON "cuentas_caja"("codigo");

-- CreateIndex
CREATE INDEX "disponibilidad_proveedor_consulta_indice" ON "disponibilidad_proveedor"("version_id", "condicion", "informado_en" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "disponibilidad_proveedor_proveedor_id_version_id_condicion_key" ON "disponibilidad_proveedor"("proveedor_id", "version_id", "condicion");

-- CreateIndex
CREATE INDEX "filas_importacion_hash_original_indice" ON "filas_importacion"("hash_original");

-- CreateIndex
CREATE INDEX "filas_importacion_lote_estado_indice" ON "filas_importacion"("lote_id", "estado", "nombre_hoja", "fila_origen");

-- CreateIndex
CREATE UNIQUE INDEX "filas_importacion_lote_id_nombre_hoja_nombre_bloque_fila_or_key" ON "filas_importacion"("lote_id", "nombre_hoja", "nombre_bloque", "fila_origen");

-- CreateIndex
CREATE UNIQUE INDEX "financieras_nombre_normalizado_unico" ON "financieras"("nombre_normalizado");

-- CreateIndex
CREATE INDEX "gastos_sucursal_fecha_indice" ON "gastos"("sucursal_id", "fecha_generacion" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "liquidaciones_comisiones_personal_id_sucursal_id_periodo_de_key" ON "liquidaciones_comisiones"("personal_id", "sucursal_id", "periodo_desde", "periodo_hasta");

-- CreateIndex
CREATE UNIQUE INDEX "lotes_importacion_sha256_origen_key" ON "lotes_importacion"("sha256_origen");

-- CreateIndex
CREATE UNIQUE INDEX "marcas_vehiculos_nombre_normalizado_key" ON "marcas_vehiculos"("nombre_normalizado");

-- CreateIndex
CREATE INDEX "modelos_vehiculos_busqueda_indice" ON "modelos_vehiculos" USING GIN ("nombre_normalizado" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "modelos_vehiculos_marca_id_tipo_vehiculo_nombre_normalizado_key" ON "modelos_vehiculos"("marca_id", "tipo_vehiculo", "nombre_normalizado");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_caja_revierte_a_id_key" ON "movimientos_caja"("revierte_a_id");

-- CreateIndex
CREATE INDEX "movimientos_caja_cuenta_fecha_indice" ON "movimientos_caja"("cuenta_caja_id", "contabilizado_en" DESC);

-- CreateIndex
CREATE INDEX "movimientos_inventario_unidad_fecha_indice" ON "movimientos_inventario"("unidad_vehiculo_id", "ocurrido_en" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "operaciones_numero_operacion_key" ON "operaciones"("numero_operacion");

-- CreateIndex
CREATE INDEX "operaciones_cliente_fecha_indice" ON "operaciones"("cliente_id", "fecha_operacion" DESC);

-- CreateIndex
CREATE INDEX "operaciones_estado_fecha_indice" ON "operaciones"("estado_operacion", "fecha_operacion" DESC);

-- CreateIndex
CREATE INDEX "operaciones_sucursal_fecha_indice" ON "operaciones"("sucursal_id", "fecha_operacion" DESC);

-- CreateIndex
CREATE INDEX "operaciones_liquidacion_comision_operacion_indice" ON "operaciones_liquidacion_comision"("operacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "personal_usuario_id_key" ON "personal"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "personal_codigo_empleado_key" ON "personal"("codigo_empleado");

-- CreateIndex
CREATE INDEX "personal_nombre_trgm_indice" ON "personal" USING GIN ("nombre_normalizado" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "politicas_precios_vehiculos_consulta_indice" ON "politicas_precios_vehiculos"("version_id", "sucursal_id", "vigente_desde" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_nombre_normalizado_unico" ON "proveedores"("nombre_normalizado");

-- CreateIndex
CREATE INDEX "registros_auditoria_entidad_indice" ON "registros_auditoria"("entidad", "entidad_id", "creado_en" DESC);

-- CreateIndex
CREATE INDEX "reservas_stock_operacion_indice" ON "reservas_stock"("operacion_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "solicitudes_abastecimiento_unidad_vehiculo_recibida_id_key" ON "solicitudes_abastecimiento"("unidad_vehiculo_recibida_id");

-- CreateIndex
CREATE INDEX "solicitudes_abastecimiento_estado_proveedor_indice" ON "solicitudes_abastecimiento"("estado", "proveedor_id", "solicitado_en");

-- CreateIndex
CREATE UNIQUE INDEX "sucursales_codigo_key" ON "sucursales"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "sucursales_nombre_key" ON "sucursales"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_vehiculos_vin_normalizado_key" ON "unidades_vehiculos"("vin_normalizado");

-- CreateIndex
CREATE INDEX "unidades_vehiculos_inventario_consulta_indice" ON "unidades_vehiculos"("sucursal_id", "estado_inventario", "version_id");

-- CreateIndex
CREATE INDEX "unidades_vehiculos_vin_trgm_indice" ON "unidades_vehiculos" USING GIN ("vin_normalizado" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_correo_normalizado_key" ON "usuarios"("correo_normalizado");

-- CreateIndex
CREATE UNIQUE INDEX "vehiculos_tomados_parte_pago_unidad_vehiculo_resultante_id_key" ON "vehiculos_tomados_parte_pago"("unidad_vehiculo_resultante_id");

-- CreateIndex
CREATE UNIQUE INDEX "versiones_vehiculos_modelo_id_nombre_normalizado_key" ON "versiones_vehiculos"("modelo_id", "nombre_normalizado");

-- AddForeignKey
ALTER TABLE "acceso_personal_sucursal" ADD CONSTRAINT "acceso_personal_sucursal_personal_id_fkey" FOREIGN KEY ("personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "acceso_personal_sucursal" ADD CONSTRAINT "acceso_personal_sucursal_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "aprobaciones_operacion" ADD CONSTRAINT "aprobaciones_operacion_decidido_por_personal_id_fkey" FOREIGN KEY ("decidido_por_personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "aprobaciones_operacion" ADD CONSTRAINT "aprobaciones_operacion_operacion_id_fkey" FOREIGN KEY ("operacion_id") REFERENCES "operaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "aprobaciones_operacion" ADD CONSTRAINT "aprobaciones_operacion_solicitado_por_personal_id_fkey" FOREIGN KEY ("solicitado_por_personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "asignaciones_personal_operacion" ADD CONSTRAINT "asignaciones_personal_operacion_operacion_id_fkey" FOREIGN KEY ("operacion_id") REFERENCES "operaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "asignaciones_personal_operacion" ADD CONSTRAINT "asignaciones_personal_operacion_personal_id_fkey" FOREIGN KEY ("personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cobranzas" ADD CONSTRAINT "cobranzas_componente_pago_id_fkey" FOREIGN KEY ("componente_pago_id") REFERENCES "componentes_pago_operacion"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cobranzas" ADD CONSTRAINT "cobranzas_cuenta_caja_id_fkey" FOREIGN KEY ("cuenta_caja_id") REFERENCES "cuentas_caja"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cobranzas" ADD CONSTRAINT "cobranzas_registrado_por_personal_id_fkey" FOREIGN KEY ("registrado_por_personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cobranzas" ADD CONSTRAINT "cobranzas_revierte_a_id_fkey" FOREIGN KEY ("revierte_a_id") REFERENCES "cobranzas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "componentes_pago_operacion" ADD CONSTRAINT "componentes_pago_operacion_consulta_crediticia_id_fkey" FOREIGN KEY ("consulta_crediticia_id") REFERENCES "consultas_crediticias"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "componentes_pago_operacion" ADD CONSTRAINT "componentes_pago_operacion_financiera_id_fkey" FOREIGN KEY ("financiera_id") REFERENCES "financieras"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "componentes_pago_operacion" ADD CONSTRAINT "componentes_pago_operacion_operacion_id_fkey" FOREIGN KEY ("operacion_id") REFERENCES "operaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "componentes_pago_operacion" ADD CONSTRAINT "componentes_pago_operacion_vehiculo_tomado_id_fkey" FOREIGN KEY ("vehiculo_tomado_id") REFERENCES "vehiculos_tomados_parte_pago"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compras_proveedor" ADD CONSTRAINT "compras_proveedor_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compras_proveedor" ADD CONSTRAINT "compras_proveedor_solicitud_abastecimiento_id_fkey" FOREIGN KEY ("solicitud_abastecimiento_id") REFERENCES "solicitudes_abastecimiento"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compras_proveedor" ADD CONSTRAINT "compras_proveedor_unidad_vehiculo_id_fkey" FOREIGN KEY ("unidad_vehiculo_id") REFERENCES "unidades_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consultas_crediticias" ADD CONSTRAINT "consultas_crediticias_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consultas_crediticias" ADD CONSTRAINT "consultas_crediticias_consultado_por_personal_id_fkey" FOREIGN KEY ("consultado_por_personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consultas_crediticias" ADD CONSTRAINT "consultas_crediticias_financiera_id_fkey" FOREIGN KEY ("financiera_id") REFERENCES "financieras"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consultas_crediticias" ADD CONSTRAINT "consultas_crediticias_operacion_id_fkey" FOREIGN KEY ("operacion_id") REFERENCES "operaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cuentas_caja" ADD CONSTRAINT "cuentas_caja_personal_responsable_id_fkey" FOREIGN KEY ("personal_responsable_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cuentas_caja" ADD CONSTRAINT "cuentas_caja_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "disponibilidad_proveedor" ADD CONSTRAINT "disponibilidad_proveedor_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "disponibilidad_proveedor" ADD CONSTRAINT "disponibilidad_proveedor_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "versiones_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "filas_importacion" ADD CONSTRAINT "filas_importacion_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes_importacion"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_creado_por_personal_id_fkey" FOREIGN KEY ("creado_por_personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_operacion_id_fkey" FOREIGN KEY ("operacion_id") REFERENCES "operaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_unidad_vehiculo_id_fkey" FOREIGN KEY ("unidad_vehiculo_id") REFERENCES "unidades_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidaciones_comisiones" ADD CONSTRAINT "liquidaciones_comisiones_acordado_por_personal_id_fkey" FOREIGN KEY ("acordado_por_personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidaciones_comisiones" ADD CONSTRAINT "liquidaciones_comisiones_personal_id_fkey" FOREIGN KEY ("personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidaciones_comisiones" ADD CONSTRAINT "liquidaciones_comisiones_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lotes_importacion" ADD CONSTRAINT "lotes_importacion_creado_por_personal_id_fkey" FOREIGN KEY ("creado_por_personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "modelos_vehiculos" ADD CONSTRAINT "modelos_vehiculos_marca_id_fkey" FOREIGN KEY ("marca_id") REFERENCES "marcas_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_cobranza_id_fkey" FOREIGN KEY ("cobranza_id") REFERENCES "cobranzas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_compra_proveedor_id_fkey" FOREIGN KEY ("compra_proveedor_id") REFERENCES "compras_proveedor"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_cuenta_caja_id_fkey" FOREIGN KEY ("cuenta_caja_id") REFERENCES "cuentas_caja"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_gasto_id_fkey" FOREIGN KEY ("gasto_id") REFERENCES "gastos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_liquidacion_comision_id_fkey" FOREIGN KEY ("liquidacion_comision_id") REFERENCES "liquidaciones_comisiones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_registrado_por_personal_id_fkey" FOREIGN KEY ("registrado_por_personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_revierte_a_id_fkey" FOREIGN KEY ("revierte_a_id") REFERENCES "movimientos_caja"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_transferenciaencia_id_fkey" FOREIGN KEY ("transferenciaencia_id") REFERENCES "transferencias_caja"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_operacion_id_fkey" FOREIGN KEY ("operacion_id") REFERENCES "operaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_realizado_por_personal_id_fkey" FOREIGN KEY ("realizado_por_personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_solicitud_abastecimiento_id_fkey" FOREIGN KEY ("solicitud_abastecimiento_id") REFERENCES "solicitudes_abastecimiento"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_sucursal_destino_id_fkey" FOREIGN KEY ("sucursal_destino_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_sucursal_origen_id_fkey" FOREIGN KEY ("sucursal_origen_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_unidad_vehiculo_id_fkey" FOREIGN KEY ("unidad_vehiculo_id") REFERENCES "unidades_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "obligaciones_operacion" ADD CONSTRAINT "obligaciones_operacion_operacion_id_fkey" FOREIGN KEY ("operacion_id") REFERENCES "operaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones" ADD CONSTRAINT "operaciones_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones" ADD CONSTRAINT "operaciones_creado_por_personal_id_fkey" FOREIGN KEY ("creado_por_personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones" ADD CONSTRAINT "operaciones_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones" ADD CONSTRAINT "operaciones_unidad_vehiculo_id_fkey" FOREIGN KEY ("unidad_vehiculo_id") REFERENCES "unidades_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones" ADD CONSTRAINT "operaciones_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "versiones_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones_liquidacion_comision" ADD CONSTRAINT "operaciones_liquidacion_comision_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones_comisiones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones_liquidacion_comision" ADD CONSTRAINT "operaciones_liquidacion_comision_operacion_id_fkey" FOREIGN KEY ("operacion_id") REFERENCES "operaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "permisos_rol" ADD CONSTRAINT "permisos_rol_codigo_permiso_fkey" FOREIGN KEY ("codigo_permiso") REFERENCES "permisos"("codigo") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "permisos_rol" ADD CONSTRAINT "permisos_rol_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "personal" ADD CONSTRAINT "personal_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "personal" ADD CONSTRAINT "personal_sucursal_principal_id_fkey" FOREIGN KEY ("sucursal_principal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "personal" ADD CONSTRAINT "personal_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "politicas_precios_vehiculos" ADD CONSTRAINT "politicas_precios_vehiculos_creado_por_personal_id_fkey" FOREIGN KEY ("creado_por_personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "politicas_precios_vehiculos" ADD CONSTRAINT "politicas_precios_vehiculos_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "politicas_precios_vehiculos" ADD CONSTRAINT "politicas_precios_vehiculos_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "versiones_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registros_auditoria" ADD CONSTRAINT "registros_auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservas_stock" ADD CONSTRAINT "reservas_stock_creado_por_personal_id_fkey" FOREIGN KEY ("creado_por_personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservas_stock" ADD CONSTRAINT "reservas_stock_disponibilidad_proveedor_id_fkey" FOREIGN KEY ("disponibilidad_proveedor_id") REFERENCES "disponibilidad_proveedor"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservas_stock" ADD CONSTRAINT "reservas_stock_operacion_id_fkey" FOREIGN KEY ("operacion_id") REFERENCES "operaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservas_stock" ADD CONSTRAINT "reservas_stock_unidad_vehiculo_id_fkey" FOREIGN KEY ("unidad_vehiculo_id") REFERENCES "unidades_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitudes_abastecimiento" ADD CONSTRAINT "solicitudes_abastecimiento_creado_por_personal_id_fkey" FOREIGN KEY ("creado_por_personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitudes_abastecimiento" ADD CONSTRAINT "solicitudes_abastecimiento_disponibilidad_proveedor_id_fkey" FOREIGN KEY ("disponibilidad_proveedor_id") REFERENCES "disponibilidad_proveedor"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitudes_abastecimiento" ADD CONSTRAINT "solicitudes_abastecimiento_operacion_id_fkey" FOREIGN KEY ("operacion_id") REFERENCES "operaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitudes_abastecimiento" ADD CONSTRAINT "solicitudes_abastecimiento_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitudes_abastecimiento" ADD CONSTRAINT "solicitudes_abastecimiento_sucursal_llegada_id_fkey" FOREIGN KEY ("sucursal_llegada_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitudes_abastecimiento" ADD CONSTRAINT "solicitudes_abastecimiento_unidad_vehiculo_recibida_id_fkey" FOREIGN KEY ("unidad_vehiculo_recibida_id") REFERENCES "unidades_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitudes_abastecimiento" ADD CONSTRAINT "solicitudes_abastecimiento_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "versiones_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transferencias_caja" ADD CONSTRAINT "transferencias_caja_creado_por_personal_id_fkey" FOREIGN KEY ("creado_por_personal_id") REFERENCES "personal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transferencias_caja" ADD CONSTRAINT "transferencias_caja_cuenta_destino_id_fkey" FOREIGN KEY ("cuenta_destino_id") REFERENCES "cuentas_caja"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transferencias_caja" ADD CONSTRAINT "transferencias_caja_cuenta_origen_id_fkey" FOREIGN KEY ("cuenta_origen_id") REFERENCES "cuentas_caja"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unidades_vehiculos" ADD CONSTRAINT "unidades_vehiculos_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unidades_vehiculos" ADD CONSTRAINT "unidades_vehiculos_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unidades_vehiculos" ADD CONSTRAINT "unidades_vehiculos_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "versiones_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vehiculos_tomados_parte_pago" ADD CONSTRAINT "vehiculos_tomados_parte_pago_operacion_id_fkey" FOREIGN KEY ("operacion_id") REFERENCES "operaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vehiculos_tomados_parte_pago" ADD CONSTRAINT "vehiculos_tomados_parte_pago_unidad_vehiculo_resultante_id_fkey" FOREIGN KEY ("unidad_vehiculo_resultante_id") REFERENCES "unidades_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vehiculos_tomados_parte_pago" ADD CONSTRAINT "vehiculos_tomados_parte_pago_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "versiones_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "versiones_vehiculos" ADD CONSTRAINT "versiones_vehiculos_modelo_id_fkey" FOREIGN KEY ("modelo_id") REFERENCES "modelos_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

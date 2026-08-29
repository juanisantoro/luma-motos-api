-- Application functions

CREATE OR REPLACE FUNCTION public.luma_establecer_actualizado_en()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN NEW.actualizado_en = now(); RETURN NEW; END $function$

CREATE OR REPLACE FUNCTION public.luma_proteger_cantidad_disponibilidad_proveedor()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$

CREATE OR REPLACE FUNCTION public.luma_validar_operacion_invariantes()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$

CREATE OR REPLACE FUNCTION public.luma_validar_pago_plan_cambio()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$

CREATE OR REPLACE FUNCTION public.luma_validar_reserva_capacidad()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$



-- Check constraints

ALTER TABLE public.aprobaciones_operacion ADD CONSTRAINT operacion_aprobacion_decision_contrato CHECK (decision = 'PENDIENTE'::decision_aprobacion_luma AND decidido_por_personal_id IS NULL AND decidido_en IS NULL OR (decision = ANY (ARRAY['APROBADA'::decision_aprobacion_luma, 'RECHAZADA'::decision_aprobacion_luma])) AND decidido_por_personal_id IS NOT NULL AND decidido_en IS NOT NULL);

ALTER TABLE public.aprobaciones_operacion ADD CONSTRAINT operacion_aprobacion_precios_valido CHECK (precio_lista_referencia >= 0::numeric AND precio_minimo_referencia >= 0::numeric AND precio_acordado_referencia > 0::numeric AND precio_minimo_referencia <= precio_lista_referencia);

ALTER TABLE public.aprobaciones_operacion ADD CONSTRAINT operacion_aprobacion_rechazo_motivo CHECK (decision <> 'RECHAZADA'::decision_aprobacion_luma OR motivo IS NOT NULL AND length(TRIM(BOTH FROM motivo)) > 0);

ALTER TABLE public.asignaciones_personal_operacion ADD CONSTRAINT operacion_personal_porcentaje_comision_valido CHECK (porcentaje_comision IS NULL OR porcentaje_comision >= 0::numeric AND porcentaje_comision <= 100::numeric);

ALTER TABLE public.clientes ADD CONSTRAINT cliente_documento_todo_o_nada CHECK (tipo_documento IS NULL AND numero_documento IS NULL AND documento_normalizado IS NULL OR tipo_documento IS NOT NULL AND numero_documento IS NOT NULL AND documento_normalizado IS NOT NULL);

ALTER TABLE public.clientes ADD CONSTRAINT cliente_nombre_normalizado_presente CHECK (length(TRIM(BOTH FROM nombre_normalizado)) > 0);

ALTER TABLE public.cobranzas ADD CONSTRAINT cobranza_contabilizado_cuenta_valido CHECK ((estado <> ALL (ARRAY['CONTABILIZADA'::luma_cobranza_estado, 'REVERSADA'::luma_cobranza_estado])) OR cuenta_caja_id IS NOT NULL);

ALTER TABLE public.cobranzas ADD CONSTRAINT cobranza_importe_valido CHECK (importe > 0::numeric);

ALTER TABLE public.cobranzas ADD CONSTRAINT cobranza_revierte_valido CHECK (estado <> 'REVERSADA'::luma_cobranza_estado OR revierte_a_id IS NOT NULL);

ALTER TABLE public.componentes_pago_operacion ADD CONSTRAINT componente_pago_financiacion_contrato CHECK (tipo_componente <> 'FINANCIACION'::tipo_componente_pago_luma OR financiera_id IS NOT NULL);

ALTER TABLE public.componentes_pago_operacion ADD CONSTRAINT pago_componente_importe_valido CHECK (importe_esperado > 0::numeric);

ALTER TABLE public.componentes_pago_operacion ADD CONSTRAINT pago_componente_toma_parte_pago_contrato CHECK (tipo_componente = 'TOMA_PARTE_PAGO'::tipo_componente_pago_luma AND vehiculo_tomado_id IS NOT NULL OR tipo_componente <> 'TOMA_PARTE_PAGO'::tipo_componente_pago_luma AND vehiculo_tomado_id IS NULL);

ALTER TABLE public.compras_proveedor ADD CONSTRAINT proveedor_compra_importes_valido CHECK (importe_base >= 0::numeric AND importe_adicional >= 0::numeric AND importe_total = (importe_base + importe_adicional));

ALTER TABLE public.consultas_crediticias ADD CONSTRAINT consulta_crediticia_rechazo_motivo CHECK (resultado <> 'RECHAZADA'::resultado_crediticio_luma OR motivo IS NOT NULL AND length(TRIM(BOTH FROM motivo)) > 0);

ALTER TABLE public.disponibilidad_proveedor ADD CONSTRAINT disponibilidad_proveedor_cantidad_valido CHECK (cantidad_informada >= 0);

ALTER TABLE public.disponibilidad_proveedor ADD CONSTRAINT disponibilidad_proveedor_vencimiento_valido CHECK (vence_en IS NULL OR vence_en > informado_en);

ALTER TABLE public.filas_importacion ADD CONSTRAINT fila_importacion_referencias_destino_arreglo CHECK (jsonb_typeof(referencias_destino) = 'array'::text);

ALTER TABLE public.filas_importacion ADD CONSTRAINT importacion_fila_codigos_error_array CHECK (jsonb_typeof(codigos_error) = 'array'::text);

ALTER TABLE public.filas_importacion ADD CONSTRAINT importacion_fila_numero_valido CHECK (fila_origen > 0);

ALTER TABLE public.gastos ADD CONSTRAINT gasto_fecha_vencimiento_valido CHECK (fecha_vencimiento IS NULL OR fecha_vencimiento >= fecha_generacion);

ALTER TABLE public.gastos ADD CONSTRAINT gasto_importe_valido CHECK (importe > 0::numeric);

ALTER TABLE public.liquidaciones_comisiones ADD CONSTRAINT comision_agreement_valido CHECK (importe_acordado IS NULL OR acordado_en IS NOT NULL AND acordado_por_personal_id IS NOT NULL);

ALTER TABLE public.liquidaciones_comisiones ADD CONSTRAINT comision_cantidad_ventas_valido CHECK (cantidad_ventas >= 0);

ALTER TABLE public.liquidaciones_comisiones ADD CONSTRAINT comision_importes_valido CHECK (importe_sugerido >= 0::numeric AND (importe_acordado IS NULL OR importe_acordado >= 0::numeric));

ALTER TABLE public.liquidaciones_comisiones ADD CONSTRAINT comision_periodo_valido CHECK (periodo_hasta >= periodo_desde);

ALTER TABLE public.lotes_importacion ADD CONSTRAINT importacion_lote_counts_valido CHECK (total_filas >= 0 AND filas_importadas >= 0 AND filas_cuarentena >= 0 AND (filas_importadas + filas_cuarentena) <= total_filas);

ALTER TABLE public.movimientos_caja ADD CONSTRAINT caja_movimiento_direccion_valido CHECK ((tipo_movimiento = ANY (ARRAY['INGRESO'::tipo_movimiento_caja_luma, 'TRANSFERENCIA_ENTRANTE'::tipo_movimiento_caja_luma])) AND direccion = 'CREDITO'::direccion_caja_luma OR (tipo_movimiento = ANY (ARRAY['EGRESO'::tipo_movimiento_caja_luma, 'TRANSFERENCIA_SALIENTE'::tipo_movimiento_caja_luma, 'REINTEGRO'::tipo_movimiento_caja_luma])) AND direccion = 'DEBITO'::direccion_caja_luma OR tipo_movimiento = 'AJUSTE'::tipo_movimiento_caja_luma);

ALTER TABLE public.movimientos_caja ADD CONSTRAINT caja_movimiento_importe_valido CHECK (importe > 0::numeric);

ALTER TABLE public.movimientos_caja ADD CONSTRAINT caja_movimiento_origen_contrato CHECK (tipo_movimiento = 'AJUSTE'::tipo_movimiento_caja_luma OR ((cobranza_id IS NOT NULL)::integer + (transferenciaencia_id IS NOT NULL)::integer + (gasto_id IS NOT NULL)::integer + (compra_proveedor_id IS NOT NULL)::integer + (liquidacion_comision_id IS NOT NULL)::integer + (revierte_a_id IS NOT NULL)::integer) = 1);

ALTER TABLE public.movimientos_caja ADD CONSTRAINT caja_movimiento_transferencia_contrato CHECK ((tipo_movimiento <> ALL (ARRAY['TRANSFERENCIA_ENTRANTE'::tipo_movimiento_caja_luma, 'TRANSFERENCIA_SALIENTE'::tipo_movimiento_caja_luma])) OR transferenciaencia_id IS NOT NULL);

ALTER TABLE public.movimientos_inventario ADD CONSTRAINT inventario_transferencia_sucursales_valido CHECK (tipo_movimiento <> 'TRASLADO'::tipo_movimiento_inventario_luma OR sucursal_origen_id IS NOT NULL AND sucursal_destino_id IS NOT NULL AND sucursal_origen_id <> sucursal_destino_id);

ALTER TABLE public.obligaciones_operacion ADD CONSTRAINT operacion_obligacion_importe_valido CHECK (importe IS NULL OR importe >= 0::numeric);

ALTER TABLE public.obligaciones_operacion ADD CONSTRAINT operacion_obligacion_resolucion_valido CHECK (estado <> 'RESUELTA'::estado_obligacion_luma OR resuelto_en IS NOT NULL);

ALTER TABLE public.operaciones ADD CONSTRAINT operacion_documentacion_entregada_en_valido CHECK (estado_documentacion <> 'COMPLETA'::estado_documentacion_luma OR documentacion_entregada_en IS NOT NULL);

ALTER TABLE public.operaciones ADD CONSTRAINT operacion_entrega_programacion_valido CHECK (estado_entrega <> 'PROGRAMADA'::luma_estado_entrega OR entrega_programada_en IS NOT NULL);

ALTER TABLE public.operaciones ADD CONSTRAINT operacion_entregado_en_valido CHECK (estado_entrega <> 'ENTREGADO'::luma_estado_entrega OR entregado_en IS NOT NULL);

ALTER TABLE public.operaciones ADD CONSTRAINT operacion_precios_valido CHECK (precio_lista >= 0::numeric AND precio_minimo >= 0::numeric AND precio_acordado > 0::numeric AND precio_minimo <= precio_lista);

ALTER TABLE public.operaciones ADD CONSTRAINT operacion_version_fila_valido CHECK (version_fila >= 0);

ALTER TABLE public.operaciones_liquidacion_comision ADD CONSTRAINT comision_operacion_importes_valido CHECK (base_comision >= 0::numeric AND importe_sugerido >= 0::numeric);

ALTER TABLE public.personal ADD CONSTRAINT personal_iniciar_sesion_contrato CHECK (NOT puede_iniciar_sesion OR usuario_id IS NOT NULL AND rol_id IS NOT NULL);

ALTER TABLE public.personal ADD CONSTRAINT personal_nombre_normalizado_presente CHECK (length(TRIM(BOTH FROM nombre_normalizado)) > 0);

ALTER TABLE public.politicas_precios_vehiculos ADD CONSTRAINT politica_precio_importes_valido CHECK (precio_lista >= 0::numeric AND precio_minimo >= 0::numeric AND precio_minimo <= precio_lista);

ALTER TABLE public.politicas_precios_vehiculos ADD CONSTRAINT politica_precio_rango_valido CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde);

ALTER TABLE public.reservas_stock ADD CONSTRAINT reserva_stock_destino_exclusivo CHECK (((unidad_vehiculo_id IS NOT NULL)::integer + (disponibilidad_proveedor_id IS NOT NULL)::integer) = 1);

ALTER TABLE public.reservas_stock ADD CONSTRAINT stock_reserva_cantidad_valido CHECK (cantidad > 0);

ALTER TABLE public.reservas_stock ADD CONSTRAINT stock_reserva_liberacion_contrato CHECK (estado = 'ACTIVO'::estado_reserva_luma OR liberado_en IS NOT NULL OR estado = 'CONSUMIDA'::estado_reserva_luma);

ALTER TABLE public.reservas_stock ADD CONSTRAINT stock_reserva_unidad_cantidad CHECK (unidad_vehiculo_id IS NULL OR cantidad = 1);

ALTER TABLE public.solicitudes_abastecimiento ADD CONSTRAINT solicitud_abastecimiento_costo_estimado_valido CHECK (costo_estimado IS NULL OR costo_estimado >= 0::numeric);

ALTER TABLE public.solicitudes_abastecimiento ADD CONSTRAINT solicitud_abastecimiento_unidad_recibida_valido CHECK ((estado <> ALL (ARRAY['RECIBIDO'::estado_abastecimiento_luma, 'ASIGNADO'::estado_abastecimiento_luma])) OR unidad_vehiculo_recibida_id IS NOT NULL);

ALTER TABLE public.transferencias_caja ADD CONSTRAINT caja_transferencia_cuentas_valido CHECK (cuenta_origen_id <> cuenta_destino_id);

ALTER TABLE public.transferencias_caja ADD CONSTRAINT caja_transferencia_importe_valido CHECK (importe > 0::numeric);

ALTER TABLE public.unidades_vehiculos ADD CONSTRAINT unidad_vehiculo_motor_todo_o_nada CHECK (numero_motor IS NULL AND motor_normalizado IS NULL OR numero_motor IS NOT NULL AND motor_normalizado IS NOT NULL);

ALTER TABLE public.unidades_vehiculos ADD CONSTRAINT unidad_vehiculo_patente_todo_o_nada CHECK (patente IS NULL AND patente_normalizada IS NULL OR patente IS NOT NULL AND patente_normalizada IS NOT NULL);

ALTER TABLE public.unidades_vehiculos ADD CONSTRAINT unidad_vehiculo_vin_formato CHECK (vin_normalizado::text ~ '^[A-Z0-9]{6,32}$'::text);

ALTER TABLE public.unidades_vehiculos ADD CONSTRAINT vehiculo_unidad_anio_valido CHECK (anio_fabricacion IS NULL OR anio_fabricacion >= 1886 AND anio_fabricacion <= 2100);

ALTER TABLE public.unidades_vehiculos ADD CONSTRAINT vehiculo_unidad_costo_compra_valido CHECK (costo_compra IS NULL OR costo_compra >= 0::numeric);

ALTER TABLE public.unidades_vehiculos ADD CONSTRAINT vehiculo_unidad_kilometraje_valido CHECK (kilometraje_km >= 0);

ALTER TABLE public.unidades_vehiculos ADD CONSTRAINT vehiculo_unidad_vin_normalizado CHECK (vin_normalizado::text = upper(regexp_replace(vin_mostrado::text, '[^A-Za-z0-9]'::text, ''::text, 'g'::text)));

ALTER TABLE public.vehiculos_tomados_parte_pago ADD CONSTRAINT toma_parte_pago_aceptacion_valido CHECK ((estado <> ALL (ARRAY['ACEPTADO'::estado_toma_parte_pago_luma, 'RECIBIDO'::estado_toma_parte_pago_luma])) OR importe_aceptado IS NOT NULL);

ALTER TABLE public.vehiculos_tomados_parte_pago ADD CONSTRAINT toma_parte_pago_anio_valido CHECK (anio_fabricacion IS NULL OR anio_fabricacion >= 1886 AND anio_fabricacion <= 2100);

ALTER TABLE public.vehiculos_tomados_parte_pago ADD CONSTRAINT toma_parte_pago_importes_valido CHECK (importe_tasado >= 0::numeric AND (importe_aceptado IS NULL OR importe_aceptado >= 0::numeric));

ALTER TABLE public.vehiculos_tomados_parte_pago ADD CONSTRAINT toma_parte_pago_kilometraje_valido CHECK (kilometraje_km IS NULL OR kilometraje_km >= 0);

ALTER TABLE public.vehiculos_tomados_parte_pago ADD CONSTRAINT toma_parte_pago_recepcion_valido CHECK (estado <> 'RECIBIDO'::estado_toma_parte_pago_luma OR unidad_vehiculo_resultante_id IS NOT NULL);

ALTER TABLE public.vehiculos_tomados_parte_pago ADD CONSTRAINT toma_parte_pago_vin_formato CHECK (vin_normalizado IS NULL OR vin_normalizado::text ~ '^[A-Z0-9]{6,32}$'::text);



-- Business triggers

CREATE TRIGGER disparador_aprobaciones_operacion_actualizado_en BEFORE UPDATE ON aprobaciones_operacion FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_clientes_actualizado_en BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_cobranzas_actualizado_en BEFORE UPDATE ON cobranzas FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_componentes_pago_operacion_actualizado_en BEFORE UPDATE ON componentes_pago_operacion FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE CONSTRAINT TRIGGER disparador_componentes_pago_operacion_total AFTER INSERT OR DELETE OR UPDATE ON componentes_pago_operacion DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION luma_validar_pago_plan_cambio();

CREATE TRIGGER disparador_compras_proveedor_actualizado_en BEFORE UPDATE ON compras_proveedor FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_consultas_crediticias_actualizado_en BEFORE UPDATE ON consultas_crediticias FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_cuentas_caja_actualizado_en BEFORE UPDATE ON cuentas_caja FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_disponibilidad_proveedor_actualizado_en BEFORE UPDATE ON disponibilidad_proveedor FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_disponibilidad_proveedor_cantidad BEFORE UPDATE OF cantidad_informada ON disponibilidad_proveedor FOR EACH ROW EXECUTE FUNCTION luma_proteger_cantidad_disponibilidad_proveedor();

CREATE TRIGGER disparador_filas_importacion_actualizado_en BEFORE UPDATE ON filas_importacion FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_financieras_actualizado_en BEFORE UPDATE ON financieras FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_gastos_actualizado_en BEFORE UPDATE ON gastos FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_liquidaciones_comisiones_actualizado_en BEFORE UPDATE ON liquidaciones_comisiones FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_lotes_importacion_actualizado_en BEFORE UPDATE ON lotes_importacion FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_marcas_vehiculos_actualizado_en BEFORE UPDATE ON marcas_vehiculos FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_modelos_vehiculos_actualizado_en BEFORE UPDATE ON modelos_vehiculos FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_obligaciones_operacion_actualizado_en BEFORE UPDATE ON obligaciones_operacion FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_operaciones_actualizado_en BEFORE UPDATE ON operaciones FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE CONSTRAINT TRIGGER disparador_operaciones_invariantes AFTER INSERT OR UPDATE ON operaciones DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION luma_validar_operacion_invariantes();

CREATE TRIGGER disparador_personal_actualizado_en BEFORE UPDATE ON personal FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_politicas_precios_vehiculos_actualizado_en BEFORE UPDATE ON politicas_precios_vehiculos FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_proveedores_actualizado_en BEFORE UPDATE ON proveedores FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_reservas_stock_actualizado_en BEFORE UPDATE ON reservas_stock FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_reservas_stock_capacidad BEFORE INSERT OR UPDATE OF unidad_vehiculo_id, disponibilidad_proveedor_id, cantidad, estado ON reservas_stock FOR EACH ROW EXECUTE FUNCTION luma_validar_reserva_capacidad();

CREATE TRIGGER disparador_roles_actualizado_en BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_solicitudes_abastecimiento_actualizado_en BEFORE UPDATE ON solicitudes_abastecimiento FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_sucursales_actualizado_en BEFORE UPDATE ON sucursales FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_transferencias_caja_actualizado_en BEFORE UPDATE ON transferencias_caja FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_unidades_vehiculos_actualizado_en BEFORE UPDATE ON unidades_vehiculos FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_usuarios_actualizado_en BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_vehiculos_tomados_parte_pago_actualizado_en BEFORE UPDATE ON vehiculos_tomados_parte_pago FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_versiones_vehiculos_actualizado_en BEFORE UPDATE ON versiones_vehiculos FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

-- Tenant functions not represented by the Prisma data model

CREATE OR REPLACE FUNCTION public.luma_organizacion_actual()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT nullif(current_setting('app.organizacion_id', true), '')::uuid;
$function$;


CREATE OR REPLACE FUNCTION public.luma_proteger_catalogo_compartido()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_setting('app.acceso_global', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION
      'Solo un usuario central con acceso global puede modificar marcas o modelos compartidos';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $function$;


CREATE OR REPLACE FUNCTION public.luma_tiene_acceso_organizacion(organizacion_objetivo_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT current_setting('app.acceso_global', true) = 'true'
      OR organizacion_objetivo_id = luma_organizacion_actual();
$function$;


CREATE OR REPLACE FUNCTION public.luma_validar_acceso_global_usuario()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.acceso_global AND NOT EXISTS (
    SELECT 1 FROM organizaciones
    WHERE id = NEW.organizacion_id AND tipo = 'CASA_CENTRAL'
  ) THEN
    RAISE EXCEPTION 'El acceso global solo puede otorgarse a usuarios de la casa central';
  END IF;
  RETURN NEW;
END $function$;


CREATE OR REPLACE FUNCTION public.luma_validar_asignacion_catalogo()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;


CREATE OR REPLACE FUNCTION public.luma_validar_version_organizacion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;


CREATE OR REPLACE FUNCTION public.luma_version_visible_para_organizacion(version_objetivo_id uuid, organizacion_objetivo_id uuid, exigir_venta boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
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
$function$;


CREATE OR REPLACE FUNCTION public.luma_versiones_visibles_actuales()
 RETURNS TABLE(id uuid, modelo_id uuid, nombre character varying, nombre_normalizado character varying, es_marcador boolean, activo boolean, alcance alcance_catalogo_luma, organizacion_propietaria_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT v.id, v.modelo_id, v.nombre, v.nombre_normalizado, v.es_marcador,
         v.activo, v.alcance, v.organizacion_propietaria_id
  FROM versiones_vehiculos v
  WHERE luma_version_visible_para_organizacion(v.id, luma_organizacion_actual(), false);
$function$;


-- Tenant check constraints not represented by the Prisma data model

ALTER TABLE "public"."versiones_vehiculos" ADD CONSTRAINT "versiones_vehiculos_alcance_propietario_valido" CHECK (alcance = 'GLOBAL'::alcance_catalogo_luma AND organizacion_propietaria_id IS NULL OR alcance = 'RESTRINGIDO'::alcance_catalogo_luma AND organizacion_propietaria_id IS NOT NULL);

-- Tenant triggers not represented by the Prisma data model

CREATE TRIGGER disparador_abastecimiento_version_organizacion BEFORE INSERT OR UPDATE OF version_id, organizacion_id ON solicitudes_abastecimiento FOR EACH ROW EXECUTE FUNCTION luma_validar_version_organizacion('version_id', 'true');

CREATE TRIGGER disparador_catalogo_organizacion_valido BEFORE INSERT OR UPDATE OF organizacion_id, version_id ON catalogo_organizaciones FOR EACH ROW EXECUTE FUNCTION luma_validar_asignacion_catalogo();

CREATE TRIGGER disparador_catalogo_organizaciones_actualizado_en BEFORE UPDATE ON catalogo_organizaciones FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_disponibilidad_version_organizacion BEFORE INSERT OR UPDATE OF version_id, organizacion_id ON disponibilidad_proveedor FOR EACH ROW EXECUTE FUNCTION luma_validar_version_organizacion('version_id', 'false');

CREATE TRIGGER disparador_marcas_catalogo_compartido BEFORE DELETE OR UPDATE ON marcas_vehiculos FOR EACH ROW EXECUTE FUNCTION luma_proteger_catalogo_compartido();

CREATE TRIGGER disparador_modelos_catalogo_compartido BEFORE DELETE OR UPDATE ON modelos_vehiculos FOR EACH ROW EXECUTE FUNCTION luma_proteger_catalogo_compartido();

CREATE TRIGGER disparador_operacion_version_organizacion BEFORE INSERT OR UPDATE OF version_id, organizacion_id ON operaciones FOR EACH ROW EXECUTE FUNCTION luma_validar_version_organizacion('version_id', 'true');

CREATE TRIGGER disparador_organizaciones_actualizado_en BEFORE UPDATE ON organizaciones FOR EACH ROW EXECUTE FUNCTION luma_establecer_actualizado_en();

CREATE TRIGGER disparador_precio_version_organizacion BEFORE INSERT OR UPDATE OF version_id, organizacion_id ON politicas_precios_vehiculos FOR EACH ROW EXECUTE FUNCTION luma_validar_version_organizacion('version_id', 'true');

CREATE TRIGGER disparador_toma_version_organizacion BEFORE INSERT OR UPDATE OF version_id, organizacion_id ON vehiculos_tomados_parte_pago FOR EACH ROW EXECUTE FUNCTION luma_validar_version_organizacion('version_id', 'false');

CREATE TRIGGER disparador_unidad_version_organizacion BEFORE INSERT OR UPDATE OF version_id, organizacion_id ON unidades_vehiculos FOR EACH ROW EXECUTE FUNCTION luma_validar_version_organizacion('version_id', 'false');

CREATE TRIGGER disparador_usuarios_acceso_global BEFORE INSERT OR UPDATE OF acceso_global, organizacion_id ON usuarios FOR EACH ROW EXECUTE FUNCTION luma_validar_acceso_global_usuario();

-- Row-level security is the database-level tenant isolation boundary

ALTER TABLE "public"."acceso_personal_sucursal" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."acceso_personal_sucursal" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."aprobaciones_operacion" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."aprobaciones_operacion" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."asignaciones_personal_operacion" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."asignaciones_personal_operacion" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."catalogo_organizaciones" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."catalogo_organizaciones" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."clientes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."clientes" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."cobranzas" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cobranzas" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."componentes_pago_operacion" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."componentes_pago_operacion" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."compras_proveedor" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."compras_proveedor" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."consultas_crediticias" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."consultas_crediticias" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."cuentas_caja" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cuentas_caja" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."disponibilidad_proveedor" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."disponibilidad_proveedor" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."filas_importacion" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."filas_importacion" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."gastos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."gastos" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."liquidaciones_comisiones" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."liquidaciones_comisiones" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."lotes_importacion" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."lotes_importacion" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."movimientos_caja" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."movimientos_caja" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."movimientos_inventario" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."movimientos_inventario" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."obligaciones_operacion" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."obligaciones_operacion" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."operaciones" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."operaciones" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."operaciones_liquidacion_comision" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."operaciones_liquidacion_comision" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."personal" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."personal" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."politicas_precios_vehiculos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."politicas_precios_vehiculos" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."proveedores" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."proveedores" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."registros_auditoria" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."registros_auditoria" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."reservas_stock" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."reservas_stock" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."solicitudes_abastecimiento" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."solicitudes_abastecimiento" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."sucursales" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."sucursales" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."transferencias_caja" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."transferencias_caja" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."unidades_vehiculos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."unidades_vehiculos" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."usuarios" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."usuarios" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."vehiculos_tomados_parte_pago" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."vehiculos_tomados_parte_pago" FORCE ROW LEVEL SECURITY;

ALTER TABLE "public"."versiones_vehiculos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."versiones_vehiculos" FORCE ROW LEVEL SECURITY;

-- Tenant row-level security policies

CREATE POLICY "politica_acceso_personal_sucursal_organizacion" ON "public"."acceso_personal_sucursal" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_aprobaciones_operacion_organizacion" ON "public"."aprobaciones_operacion" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_asignaciones_personal_operacion_organizacion" ON "public"."asignaciones_personal_operacion" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_catalogo_organizaciones_organizacion" ON "public"."catalogo_organizaciones" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_clientes_organizacion" ON "public"."clientes" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_cobranzas_organizacion" ON "public"."cobranzas" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_componentes_pago_operacion_organizacion" ON "public"."componentes_pago_operacion" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_compras_proveedor_organizacion" ON "public"."compras_proveedor" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_consultas_crediticias_organizacion" ON "public"."consultas_crediticias" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_cuentas_caja_organizacion" ON "public"."cuentas_caja" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_disponibilidad_proveedor_organizacion" ON "public"."disponibilidad_proveedor" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_filas_importacion_organizacion" ON "public"."filas_importacion" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_gastos_organizacion" ON "public"."gastos" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_liquidaciones_comisiones_organizacion" ON "public"."liquidaciones_comisiones" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_lotes_importacion_organizacion" ON "public"."lotes_importacion" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_movimientos_caja_organizacion" ON "public"."movimientos_caja" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_movimientos_inventario_organizacion" ON "public"."movimientos_inventario" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_obligaciones_operacion_organizacion" ON "public"."obligaciones_operacion" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_operaciones_organizacion" ON "public"."operaciones" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_operaciones_liquidacion_comision_organizacion" ON "public"."operaciones_liquidacion_comision" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_personal_organizacion" ON "public"."personal" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_politicas_precios_vehiculos_organizacion" ON "public"."politicas_precios_vehiculos" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_proveedores_organizacion" ON "public"."proveedores" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_registros_auditoria_organizacion" ON "public"."registros_auditoria" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_reservas_stock_organizacion" ON "public"."reservas_stock" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_solicitudes_abastecimiento_organizacion" ON "public"."solicitudes_abastecimiento" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_sucursales_organizacion" ON "public"."sucursales" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_transferencias_caja_organizacion" ON "public"."transferencias_caja" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_unidades_vehiculos_organizacion" ON "public"."unidades_vehiculos" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_usuarios_organizacion" ON "public"."usuarios" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_vehiculos_tomados_parte_pago_organizacion" ON "public"."vehiculos_tomados_parte_pago" AS PERMISSIVE FOR ALL TO PUBLIC USING (luma_tiene_acceso_organizacion(organizacion_id)) WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

CREATE POLICY "politica_versiones_actualizar" ON "public"."versiones_vehiculos" AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((COALESCE((current_setting('app.acceso_global'::text, true) = 'true'::text), false) OR (organizacion_propietaria_id = luma_organizacion_actual()))) WITH CHECK ((COALESCE((current_setting('app.acceso_global'::text, true) = 'true'::text), false) OR ((alcance = 'RESTRINGIDO'::alcance_catalogo_luma) AND (organizacion_propietaria_id = luma_organizacion_actual()))));

CREATE POLICY "politica_versiones_eliminar" ON "public"."versiones_vehiculos" AS PERMISSIVE FOR DELETE TO PUBLIC USING ((COALESCE((current_setting('app.acceso_global'::text, true) = 'true'::text), false) OR (organizacion_propietaria_id = luma_organizacion_actual())));

CREATE POLICY "politica_versiones_insertar" ON "public"."versiones_vehiculos" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((COALESCE((current_setting('app.acceso_global'::text, true) = 'true'::text), false) OR ((alcance = 'RESTRINGIDO'::alcance_catalogo_luma) AND (organizacion_propietaria_id = luma_organizacion_actual()))));

CREATE POLICY "politica_versiones_lectura" ON "public"."versiones_vehiculos" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((COALESCE((current_setting('app.acceso_global'::text, true) = 'true'::text), false) OR (alcance = 'GLOBAL'::alcance_catalogo_luma) OR (organizacion_propietaria_id = luma_organizacion_actual()) OR (EXISTS ( SELECT 1
   FROM catalogo_organizaciones catalogo
  WHERE ((catalogo.version_id = versiones_vehiculos.id) AND (catalogo.organizacion_id = luma_organizacion_actual()))))));

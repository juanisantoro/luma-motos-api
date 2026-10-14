-- Las administrativas (catalogo.gestionar) pueden dar de alta una marca o un
-- modelo nuevo. Agregar no pisa nada de otra organización: el nombre
-- normalizado sigue siendo único. Modificar o borrar marcas y modelos
-- compartidos sigue reservado al acceso global.
DROP TRIGGER IF EXISTS "disparador_marcas_catalogo_compartido" ON "marcas_vehiculos";
CREATE TRIGGER "disparador_marcas_catalogo_compartido"
BEFORE UPDATE OR DELETE ON "marcas_vehiculos"
FOR EACH ROW EXECUTE FUNCTION "luma_proteger_catalogo_compartido"();

DROP TRIGGER IF EXISTS "disparador_modelos_catalogo_compartido" ON "modelos_vehiculos";
CREATE TRIGGER "disparador_modelos_catalogo_compartido"
BEFORE UPDATE OR DELETE ON "modelos_vehiculos"
FOR EACH ROW EXECUTE FUNCTION "luma_proteger_catalogo_compartido"();

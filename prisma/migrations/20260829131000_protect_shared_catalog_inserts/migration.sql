-- INSERT must be protected as well as UPDATE and DELETE. Recreating these
-- triggers is idempotent and preserves luma_proteger_catalogo_compartido().
DROP TRIGGER IF EXISTS "disparador_marcas_catalogo_compartido" ON "marcas_vehiculos";
CREATE TRIGGER "disparador_marcas_catalogo_compartido"
BEFORE INSERT OR UPDATE OR DELETE ON "marcas_vehiculos"
FOR EACH ROW EXECUTE FUNCTION "luma_proteger_catalogo_compartido"();

DROP TRIGGER IF EXISTS "disparador_modelos_catalogo_compartido" ON "modelos_vehiculos";
CREATE TRIGGER "disparador_modelos_catalogo_compartido"
BEFORE INSERT OR UPDATE OR DELETE ON "modelos_vehiculos"
FOR EACH ROW EXECUTE FUNCTION "luma_proteger_catalogo_compartido"();

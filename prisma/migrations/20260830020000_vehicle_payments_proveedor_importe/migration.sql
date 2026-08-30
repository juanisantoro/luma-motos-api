-- Renombra el catálogo de "beneficiario" a "proveedor" (la gestoría/proveedor
-- que cobra el trámite; "Carolina" pasa a ser "Gestora Carolina") y agrega el
-- importe del pago, que faltaba en el modelo original.

ALTER TABLE "beneficiarios_pago_vehiculo" RENAME TO "proveedores_pago_vehiculo";
ALTER TABLE "proveedores_pago_vehiculo" RENAME CONSTRAINT "beneficiarios_pago_vehiculo_pkey" TO "proveedores_pago_vehiculo_pkey";
ALTER INDEX "beneficiarios_pago_vehiculo_nombre_normalizado_key" RENAME TO "proveedores_pago_vehiculo_nombre_normalizado_key";

DROP TRIGGER IF EXISTS "disparador_beneficiarios_pago_vehiculo_actualizado_en" ON "proveedores_pago_vehiculo";
CREATE TRIGGER "disparador_proveedores_pago_vehiculo_actualizado_en"
BEFORE UPDATE ON "proveedores_pago_vehiculo"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

UPDATE "proveedores_pago_vehiculo"
SET "nombre" = 'Gestora Carolina', "nombre_normalizado" = 'gestora carolina'
WHERE "nombre_normalizado" = 'carolina';

ALTER TABLE "pagos_vehiculo" RENAME COLUMN "beneficiario_id" TO "proveedor_id";
ALTER TABLE "pagos_vehiculo" RENAME CONSTRAINT "pagos_vehiculo_beneficiario_id_fkey" TO "pagos_vehiculo_proveedor_id_fkey";

ALTER TABLE "pagos_vehiculo" ADD COLUMN "importe" NUMERIC(18, 2);
UPDATE "pagos_vehiculo" SET "importe" = 0 WHERE "importe" IS NULL;
ALTER TABLE "pagos_vehiculo" ALTER COLUMN "importe" SET NOT NULL;

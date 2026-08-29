-- Extend the existing legacy finance tables for operational administration.
ALTER TABLE "compras_proveedor"
  ADD COLUMN "sucursal_id" UUID,
  ADD COLUMN "version_id" UUID;

ALTER TABLE "compras_proveedor"
  ADD CONSTRAINT "compra_sucursal_organizacion_fk"
    FOREIGN KEY ("sucursal_id", "organizacion_id")
    REFERENCES "sucursales"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "compras_proveedor_version_id_fkey"
    FOREIGN KEY ("version_id")
    REFERENCES "versiones_vehiculos"("id")
    ON DELETE RESTRICT;

CREATE INDEX "compras_proveedor_sucursal_fecha_indice"
  ON "compras_proveedor" ("sucursal_id", "fecha_compra" DESC);

ALTER TABLE "ingresos"
  ALTER COLUMN "fila_importacion_id" DROP NOT NULL,
  ADD COLUMN "operacion_id" UUID,
  ADD COLUMN "unidad_vehiculo_id" UUID,
  ADD COLUMN "referencia" VARCHAR(160),
  ADD COLUMN "moneda" CHAR(3) NOT NULL DEFAULT 'ARS';

ALTER TABLE "ingresos"
  DROP CONSTRAINT "ingresos_estado_registro_valido",
  DROP CONSTRAINT "ingresos_fila_importacion_id_fkey",
  DROP CONSTRAINT "ingreso_fila_organizacion_fk";

ALTER TABLE "ingresos"
  ADD CONSTRAINT "ingresos_estado_registro_valido"
    CHECK ("estado_registro" IN (
      'PENDIENTE',
      'PARCIAL',
      'PAGADO',
      'ANULADO',
      'PENDIENTE_CONCILIACION',
      'COBRADO'
    )),
  ADD CONSTRAINT "ingresos_fila_importacion_id_fkey"
    FOREIGN KEY ("fila_importacion_id")
    REFERENCES "filas_importacion"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "ingreso_fila_organizacion_fk"
    FOREIGN KEY ("fila_importacion_id", "organizacion_id")
    REFERENCES "filas_importacion"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "ingreso_operacion_organizacion_fk"
    FOREIGN KEY ("operacion_id", "organizacion_id")
    REFERENCES "operaciones"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "ingreso_unidad_organizacion_fk"
    FOREIGN KEY ("unidad_vehiculo_id", "organizacion_id")
    REFERENCES "unidades_vehiculos"("id", "organizacion_id")
    ON DELETE RESTRICT;

DROP INDEX "movimientos_caja_ingreso_unico";
CREATE INDEX "movimientos_caja_ingreso_indice"
  ON "movimientos_caja" ("ingreso_id", "contabilizado_en" DESC)
  WHERE "ingreso_id" IS NOT NULL;

ALTER TABLE "movimientos_caja"
  ADD COLUMN "clave_idempotencia" VARCHAR(100),
  ADD COLUMN "hash_idempotencia" CHAR(64);

ALTER TABLE "movimientos_caja"
  ADD CONSTRAINT "movimientos_caja_idempotencia_completa"
    CHECK (
      ("clave_idempotencia" IS NULL AND "hash_idempotencia" IS NULL)
      OR
      ("clave_idempotencia" IS NOT NULL AND "hash_idempotencia" IS NOT NULL)
    );

CREATE UNIQUE INDEX "movimientos_caja_organizacion_idempotencia_unico"
  ON "movimientos_caja" ("organizacion_id", "clave_idempotencia");

CREATE OR REPLACE FUNCTION "luma_rechazar_mutacion_movimiento_caja"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Los movimientos de caja son inmutables; registre una reversa';
END
$$;

CREATE TRIGGER "disparador_movimientos_caja_append_only"
BEFORE UPDATE OR DELETE ON "movimientos_caja"
FOR EACH ROW EXECUTE FUNCTION "luma_rechazar_mutacion_movimiento_caja"();

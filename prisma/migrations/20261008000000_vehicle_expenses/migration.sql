-- "Pagos/patentes" pasa a ser "Gastos de motos" / "Gastos de autos": un gasto
-- de un vehículo no siempre tiene proveedor ni unidad, y se paga desde la caja
-- de un administrador.
--
-- - proveedor_id y unidad_vehiculo_id pasan a ser opcionales.
-- - sucursal_id y tipo_vehiculo dejan de salir de la unidad: se guardan en el
--   gasto (los existentes se completan desde su unidad).
-- - cuenta_caja_id: la caja de quien lo paga. Opcional sólo para los gastos
--   cargados antes de este cambio; la API la exige en los nuevos.
-- - movimiento_caja_id: el débito en esa caja mientras el gasto está PAGADO.
--   Al volverlo a PENDIENTE se registra el contramovimiento (revierte_a_id) y
--   este campo queda en NULL: los movimientos de caja nunca se borran.
-- - moneda: la de la caja.

ALTER TABLE "pagos_vehiculo"
  ADD COLUMN "sucursal_id" UUID,
  ADD COLUMN "tipo_vehiculo" "tipo_vehiculo_luma",
  ADD COLUMN "cuenta_caja_id" UUID,
  ADD COLUMN "movimiento_caja_id" UUID,
  ADD COLUMN "moneda" CHAR(3) NOT NULL DEFAULT 'ARS';

-- Backfill desde la unidad. Las tablas tienen RLS forzada: habilitar acceso
-- transversal sólo dentro de esta transacción (igual que en
-- 20260929000000_linked_incomes_cash_handover).
SELECT set_config('app.acceso_global', 'true', true);

UPDATE "pagos_vehiculo" p
SET "sucursal_id" = u."sucursal_id",
    "tipo_vehiculo" = m."tipo_vehiculo"
FROM "unidades_vehiculos" u
JOIN "versiones_vehiculos" v ON v."id" = u."version_id"
JOIN "modelos_vehiculos" m ON m."id" = v."modelo_id"
WHERE u."id" = p."unidad_vehiculo_id";

ALTER TABLE "pagos_vehiculo"
  ALTER COLUMN "sucursal_id" SET NOT NULL,
  ALTER COLUMN "tipo_vehiculo" SET NOT NULL,
  ALTER COLUMN "proveedor_id" DROP NOT NULL,
  ALTER COLUMN "unidad_vehiculo_id" DROP NOT NULL;

ALTER TABLE "pagos_vehiculo"
  -- Con caja: está pagado si y sólo si tiene el débito registrado.
  ADD CONSTRAINT "pagos_vehiculo_caja_coherente"
    CHECK (
      ("cuenta_caja_id" IS NULL AND "movimiento_caja_id" IS NULL)
      OR ("cuenta_caja_id" IS NOT NULL
        AND ("estado" = 'PAGADO') = ("movimiento_caja_id" IS NOT NULL))
    ),
  ADD CONSTRAINT "pago_vehiculo_sucursal_organizacion_fk"
    FOREIGN KEY ("sucursal_id", "organizacion_id")
    REFERENCES "sucursales"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "pago_vehiculo_cuenta_organizacion_fk"
    FOREIGN KEY ("cuenta_caja_id", "organizacion_id")
    REFERENCES "cuentas_caja"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "pago_vehiculo_movimiento_organizacion_fk"
    FOREIGN KEY ("movimiento_caja_id", "organizacion_id")
    REFERENCES "movimientos_caja"("id", "organizacion_id")
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX "pagos_vehiculo_movimiento_unico"
  ON "pagos_vehiculo" ("movimiento_caja_id")
  WHERE "movimiento_caja_id" IS NOT NULL;

CREATE INDEX "pagos_vehiculo_tipo_fecha_indice"
  ON "pagos_vehiculo" ("organizacion_id", "tipo_vehiculo", "fecha" DESC);

CREATE INDEX "pagos_vehiculo_cuenta_indice"
  ON "pagos_vehiculo" ("cuenta_caja_id");

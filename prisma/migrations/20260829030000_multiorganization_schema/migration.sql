-- CreateEnum
CREATE TYPE "alcance_catalogo_luma" AS ENUM ('GLOBAL', 'RESTRINGIDO');

-- CreateEnum
CREATE TYPE "tipo_organizacion_luma" AS ENUM ('CASA_CENTRAL', 'FRANQUICIA');

-- DropForeignKey
ALTER TABLE "movimientos_caja" DROP CONSTRAINT "movimientos_caja_transferenciaencia_id_fkey";

-- DropIndex
DROP INDEX "cuentas_caja_codigo_key";

-- DropIndex
DROP INDEX "lotes_importacion_sha256_origen_key";

-- DropIndex
DROP INDEX "personal_codigo_empleado_key";

-- DropIndex
DROP INDEX "proveedores_nombre_normalizado_unico";

-- DropIndex
DROP INDEX "sucursales_codigo_key";

-- DropIndex
DROP INDEX "sucursales_nombre_key";

-- DropIndex
DROP INDEX "versiones_vehiculos_modelo_id_nombre_normalizado_key";

-- AlterTable
ALTER TABLE "acceso_personal_sucursal" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "aprobaciones_operacion" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "asignaciones_personal_operacion" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "cobranzas" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "componentes_pago_operacion" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "compras_proveedor" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "consultas_crediticias" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "cuentas_caja" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "disponibilidad_proveedor" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "filas_importacion" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "gastos" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "liquidaciones_comisiones" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "lotes_importacion" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "movimientos_caja" DROP COLUMN "transferenciaencia_id",
ADD COLUMN     "organizacion_id" UUID,
ADD COLUMN     "transferencia_id" UUID;

-- AlterTable
ALTER TABLE "movimientos_inventario" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "obligaciones_operacion" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "operaciones" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "operaciones_liquidacion_comision" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "personal" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "politicas_precios_vehiculos" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "proveedores" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "registros_auditoria" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "reservas_stock" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "solicitudes_abastecimiento" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "sucursales" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "transferencias_caja" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "unidades_vehiculos" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "acceso_global" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "vehiculos_tomados_parte_pago" ADD COLUMN     "organizacion_id" UUID;

-- AlterTable
ALTER TABLE "versiones_vehiculos" ADD COLUMN     "alcance" "alcance_catalogo_luma" NOT NULL DEFAULT 'RESTRINGIDO',
ADD COLUMN     "organizacion_propietaria_id" UUID;

-- CreateTable
CREATE TABLE "catalogo_organizaciones" (
    "organizacion_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "puede_vender" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalogo_organizaciones_pkey" PRIMARY KEY ("organizacion_id","version_id")
);

-- CreateTable
CREATE TABLE "organizaciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" VARCHAR(40) NOT NULL,
    "nombre" VARCHAR(180) NOT NULL,
    "tipo" "tipo_organizacion_luma" NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizaciones_pkey" PRIMARY KEY ("id")
);

-- Backfill pre-existing single-organization data before enforcing tenancy.
INSERT INTO "organizaciones" ("codigo", "nombre", "tipo")
VALUES ('LUMA_CENTRAL', 'Luma Motos Casa Central', 'CASA_CENTRAL');

DO $$
DECLARE
    central_id UUID;
    target_table TEXT;
BEGIN
    SELECT "id" INTO central_id
    FROM "organizaciones"
    WHERE "codigo" = 'LUMA_CENTRAL';

    FOREACH target_table IN ARRAY ARRAY[
        'acceso_personal_sucursal',
        'aprobaciones_operacion',
        'asignaciones_personal_operacion',
        'clientes',
        'cobranzas',
        'componentes_pago_operacion',
        'compras_proveedor',
        'consultas_crediticias',
        'cuentas_caja',
        'disponibilidad_proveedor',
        'filas_importacion',
        'gastos',
        'liquidaciones_comisiones',
        'lotes_importacion',
        'movimientos_caja',
        'movimientos_inventario',
        'obligaciones_operacion',
        'operaciones',
        'operaciones_liquidacion_comision',
        'personal',
        'politicas_precios_vehiculos',
        'proveedores',
        'registros_auditoria',
        'reservas_stock',
        'solicitudes_abastecimiento',
        'sucursales',
        'transferencias_caja',
        'unidades_vehiculos',
        'usuarios',
        'vehiculos_tomados_parte_pago'
    ]
    LOOP
        EXECUTE format(
            'UPDATE public.%I SET organizacion_id = $1 WHERE organizacion_id IS NULL',
            target_table
        ) USING central_id;
        EXECUTE format(
            'ALTER TABLE public.%I ALTER COLUMN organizacion_id SET NOT NULL',
            target_table
        );
    END LOOP;

    UPDATE "versiones_vehiculos"
    SET "organizacion_propietaria_id" = central_id
    WHERE "alcance" = 'RESTRINGIDO'
      AND "organizacion_propietaria_id" IS NULL;
END
$$;

-- CreateIndex
CREATE UNIQUE INDEX "organizaciones_codigo_key" ON "organizaciones"("codigo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "aprobaciones_operacion_id_organizacion_unico" ON "aprobaciones_operacion"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "clientes_id_organizacion_unico" ON "clientes"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cobranzas_id_organizacion_unico" ON "cobranzas"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "componentes_pago_operacion_id_organizacion_unico" ON "componentes_pago_operacion"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "compras_proveedor_id_organizacion_unico" ON "compras_proveedor"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "consultas_crediticias_id_organizacion_unico" ON "consultas_crediticias"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cuentas_caja_id_organizacion_unico" ON "cuentas_caja"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cuentas_caja_organizacion_codigo_unico" ON "cuentas_caja"("organizacion_id" ASC, "codigo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "disponibilidad_proveedor_id_organizacion_unico" ON "disponibilidad_proveedor"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "filas_importacion_id_organizacion_unico" ON "filas_importacion"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "gastos_id_organizacion_unico" ON "gastos"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "liquidaciones_comisiones_id_organizacion_unico" ON "liquidaciones_comisiones"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "lotes_importacion_id_organizacion_unico" ON "lotes_importacion"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "lotes_importacion_organizacion_sha256_unico" ON "lotes_importacion"("organizacion_id" ASC, "sha256_origen" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_caja_id_organizacion_unico" ON "movimientos_caja"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_inventario_id_organizacion_unico" ON "movimientos_inventario"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "obligaciones_operacion_id_organizacion_unico" ON "obligaciones_operacion"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "operaciones_id_organizacion_unico" ON "operaciones"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "personal_id_organizacion_unico" ON "personal"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "politicas_precios_vehiculos_id_organizacion_unico" ON "politicas_precios_vehiculos"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_id_organizacion_unico" ON "proveedores"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_organizacion_nombre_normalizado_unico" ON "proveedores"("organizacion_id" ASC, "nombre_normalizado" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "registros_auditoria_id_organizacion_unico" ON "registros_auditoria"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "reservas_stock_id_organizacion_unico" ON "reservas_stock"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "solicitudes_abastecimiento_id_organizacion_unico" ON "solicitudes_abastecimiento"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sucursales_id_organizacion_unico" ON "sucursales"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sucursales_organizacion_codigo_unico" ON "sucursales"("organizacion_id" ASC, "codigo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sucursales_organizacion_nombre_unico" ON "sucursales"("organizacion_id" ASC, "nombre" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "transferencias_caja_id_organizacion_unico" ON "transferencias_caja"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unidades_vehiculos_id_organizacion_unico" ON "unidades_vehiculos"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_id_organizacion_unico" ON "usuarios"("id" ASC, "organizacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "vehiculos_tomados_parte_pago_id_organizacion_unico" ON "vehiculos_tomados_parte_pago"("id" ASC, "organizacion_id" ASC);

-- AddForeignKey
ALTER TABLE "acceso_personal_sucursal" ADD CONSTRAINT "acceso_personal_organizacion_fk" FOREIGN KEY ("personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "acceso_personal_sucursal" ADD CONSTRAINT "acceso_personal_sucursal_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "acceso_personal_sucursal" ADD CONSTRAINT "acceso_sucursal_organizacion_fk" FOREIGN KEY ("sucursal_id", "organizacion_id") REFERENCES "sucursales"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "aprobaciones_operacion" ADD CONSTRAINT "aprobacion_decisor_organizacion_fk" FOREIGN KEY ("decidido_por_personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "aprobaciones_operacion" ADD CONSTRAINT "aprobacion_operacion_organizacion_fk" FOREIGN KEY ("operacion_id", "organizacion_id") REFERENCES "operaciones"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "aprobaciones_operacion" ADD CONSTRAINT "aprobacion_solicitante_organizacion_fk" FOREIGN KEY ("solicitado_por_personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "aprobaciones_operacion" ADD CONSTRAINT "aprobaciones_operacion_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "asignaciones_personal_operacion" ADD CONSTRAINT "asignacion_operacion_organizacion_fk" FOREIGN KEY ("operacion_id", "organizacion_id") REFERENCES "operaciones"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "asignaciones_personal_operacion" ADD CONSTRAINT "asignacion_personal_organizacion_fk" FOREIGN KEY ("personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "asignaciones_personal_operacion" ADD CONSTRAINT "asignaciones_personal_operacion_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "catalogo_organizaciones" ADD CONSTRAINT "catalogo_organizaciones_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "catalogo_organizaciones" ADD CONSTRAINT "catalogo_organizaciones_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "versiones_vehiculos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cobranzas" ADD CONSTRAINT "cobranza_componente_organizacion_fk" FOREIGN KEY ("componente_pago_id", "organizacion_id") REFERENCES "componentes_pago_operacion"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cobranzas" ADD CONSTRAINT "cobranza_cuenta_organizacion_fk" FOREIGN KEY ("cuenta_caja_id", "organizacion_id") REFERENCES "cuentas_caja"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cobranzas" ADD CONSTRAINT "cobranza_personal_organizacion_fk" FOREIGN KEY ("registrado_por_personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cobranzas" ADD CONSTRAINT "cobranza_reversion_organizacion_fk" FOREIGN KEY ("revierte_a_id", "organizacion_id") REFERENCES "cobranzas"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cobranzas" ADD CONSTRAINT "cobranzas_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "componentes_pago_operacion" ADD CONSTRAINT "componente_consulta_organizacion_fk" FOREIGN KEY ("consulta_crediticia_id", "organizacion_id") REFERENCES "consultas_crediticias"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "componentes_pago_operacion" ADD CONSTRAINT "componente_operacion_organizacion_fk" FOREIGN KEY ("operacion_id", "organizacion_id") REFERENCES "operaciones"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "componentes_pago_operacion" ADD CONSTRAINT "componente_toma_organizacion_fk" FOREIGN KEY ("vehiculo_tomado_id", "organizacion_id") REFERENCES "vehiculos_tomados_parte_pago"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "componentes_pago_operacion" ADD CONSTRAINT "componentes_pago_operacion_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compras_proveedor" ADD CONSTRAINT "compra_abastecimiento_organizacion_fk" FOREIGN KEY ("solicitud_abastecimiento_id", "organizacion_id") REFERENCES "solicitudes_abastecimiento"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compras_proveedor" ADD CONSTRAINT "compra_proveedor_referencia_organizacion_fk" FOREIGN KEY ("proveedor_id", "organizacion_id") REFERENCES "proveedores"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compras_proveedor" ADD CONSTRAINT "compra_unidad_organizacion_fk" FOREIGN KEY ("unidad_vehiculo_id", "organizacion_id") REFERENCES "unidades_vehiculos"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compras_proveedor" ADD CONSTRAINT "compras_proveedor_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consultas_crediticias" ADD CONSTRAINT "consulta_cliente_organizacion_fk" FOREIGN KEY ("cliente_id", "organizacion_id") REFERENCES "clientes"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consultas_crediticias" ADD CONSTRAINT "consulta_operacion_organizacion_fk" FOREIGN KEY ("operacion_id", "organizacion_id") REFERENCES "operaciones"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consultas_crediticias" ADD CONSTRAINT "consulta_personal_organizacion_fk" FOREIGN KEY ("consultado_por_personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consultas_crediticias" ADD CONSTRAINT "consultas_crediticias_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cuentas_caja" ADD CONSTRAINT "cuenta_personal_organizacion_fk" FOREIGN KEY ("personal_responsable_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cuentas_caja" ADD CONSTRAINT "cuenta_sucursal_organizacion_fk" FOREIGN KEY ("sucursal_id", "organizacion_id") REFERENCES "sucursales"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cuentas_caja" ADD CONSTRAINT "cuentas_caja_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "disponibilidad_proveedor" ADD CONSTRAINT "disponibilidad_proveedor_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "disponibilidad_proveedor" ADD CONSTRAINT "disponibilidad_proveedor_proveedor_organizacion_fk" FOREIGN KEY ("proveedor_id", "organizacion_id") REFERENCES "proveedores"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "filas_importacion" ADD CONSTRAINT "fila_lote_organizacion_fk" FOREIGN KEY ("lote_id", "organizacion_id") REFERENCES "lotes_importacion"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "filas_importacion" ADD CONSTRAINT "filas_importacion_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gasto_operacion_organizacion_fk" FOREIGN KEY ("operacion_id", "organizacion_id") REFERENCES "operaciones"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gasto_personal_organizacion_fk" FOREIGN KEY ("creado_por_personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gasto_sucursal_organizacion_fk" FOREIGN KEY ("sucursal_id", "organizacion_id") REFERENCES "sucursales"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gasto_unidad_organizacion_fk" FOREIGN KEY ("unidad_vehiculo_id", "organizacion_id") REFERENCES "unidades_vehiculos"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidaciones_comisiones" ADD CONSTRAINT "liquidacion_acordador_organizacion_fk" FOREIGN KEY ("acordado_por_personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidaciones_comisiones" ADD CONSTRAINT "liquidacion_personal_organizacion_fk" FOREIGN KEY ("personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidaciones_comisiones" ADD CONSTRAINT "liquidacion_sucursal_organizacion_fk" FOREIGN KEY ("sucursal_id", "organizacion_id") REFERENCES "sucursales"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidaciones_comisiones" ADD CONSTRAINT "liquidaciones_comisiones_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lotes_importacion" ADD CONSTRAINT "lote_personal_organizacion_fk" FOREIGN KEY ("creado_por_personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lotes_importacion" ADD CONSTRAINT "lotes_importacion_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimiento_caja_cobranza_organizacion_fk" FOREIGN KEY ("cobranza_id", "organizacion_id") REFERENCES "cobranzas"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimiento_caja_compra_organizacion_fk" FOREIGN KEY ("compra_proveedor_id", "organizacion_id") REFERENCES "compras_proveedor"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimiento_caja_cuenta_organizacion_fk" FOREIGN KEY ("cuenta_caja_id", "organizacion_id") REFERENCES "cuentas_caja"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimiento_caja_gasto_organizacion_fk" FOREIGN KEY ("gasto_id", "organizacion_id") REFERENCES "gastos"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimiento_caja_liquidacion_organizacion_fk" FOREIGN KEY ("liquidacion_comision_id", "organizacion_id") REFERENCES "liquidaciones_comisiones"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimiento_caja_personal_organizacion_fk" FOREIGN KEY ("registrado_por_personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimiento_caja_reversion_organizacion_fk" FOREIGN KEY ("revierte_a_id", "organizacion_id") REFERENCES "movimientos_caja"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimiento_caja_transferencia_organizacion_fk" FOREIGN KEY ("transferencia_id", "organizacion_id") REFERENCES "transferencias_caja"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_transferenciaencia_id_fkey" FOREIGN KEY ("transferencia_id") REFERENCES "transferencias_caja"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimiento_inventario_abastecimiento_organizacion_fk" FOREIGN KEY ("solicitud_abastecimiento_id", "organizacion_id") REFERENCES "solicitudes_abastecimiento"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimiento_inventario_destino_organizacion_fk" FOREIGN KEY ("sucursal_destino_id", "organizacion_id") REFERENCES "sucursales"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimiento_inventario_operacion_organizacion_fk" FOREIGN KEY ("operacion_id", "organizacion_id") REFERENCES "operaciones"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimiento_inventario_origen_organizacion_fk" FOREIGN KEY ("sucursal_origen_id", "organizacion_id") REFERENCES "sucursales"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimiento_inventario_personal_organizacion_fk" FOREIGN KEY ("realizado_por_personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimiento_inventario_unidad_organizacion_fk" FOREIGN KEY ("unidad_vehiculo_id", "organizacion_id") REFERENCES "unidades_vehiculos"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "obligaciones_operacion" ADD CONSTRAINT "obligacion_operacion_organizacion_fk" FOREIGN KEY ("operacion_id", "organizacion_id") REFERENCES "operaciones"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "obligaciones_operacion" ADD CONSTRAINT "obligaciones_operacion_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones" ADD CONSTRAINT "operacion_cliente_organizacion_fk" FOREIGN KEY ("cliente_id", "organizacion_id") REFERENCES "clientes"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones" ADD CONSTRAINT "operacion_personal_organizacion_fk" FOREIGN KEY ("creado_por_personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones" ADD CONSTRAINT "operacion_sucursal_organizacion_fk" FOREIGN KEY ("sucursal_id", "organizacion_id") REFERENCES "sucursales"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones" ADD CONSTRAINT "operacion_unidad_organizacion_fk" FOREIGN KEY ("unidad_vehiculo_id", "organizacion_id") REFERENCES "unidades_vehiculos"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones" ADD CONSTRAINT "operaciones_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones_liquidacion_comision" ADD CONSTRAINT "liquidacion_operacion_organizacion_fk" FOREIGN KEY ("liquidacion_id", "organizacion_id") REFERENCES "liquidaciones_comisiones"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones_liquidacion_comision" ADD CONSTRAINT "operacion_liquidacion_organizacion_fk" FOREIGN KEY ("operacion_id", "organizacion_id") REFERENCES "operaciones"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "operaciones_liquidacion_comision" ADD CONSTRAINT "operaciones_liquidacion_comision_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "personal" ADD CONSTRAINT "personal_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "personal" ADD CONSTRAINT "personal_sucursal_organizacion_fk" FOREIGN KEY ("sucursal_principal_id", "organizacion_id") REFERENCES "sucursales"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "personal" ADD CONSTRAINT "personal_usuario_organizacion_fk" FOREIGN KEY ("usuario_id", "organizacion_id") REFERENCES "usuarios"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "politicas_precios_vehiculos" ADD CONSTRAINT "politicas_precios_vehiculos_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "politicas_precios_vehiculos" ADD CONSTRAINT "precio_personal_organizacion_fk" FOREIGN KEY ("creado_por_personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "politicas_precios_vehiculos" ADD CONSTRAINT "precio_sucursal_organizacion_fk" FOREIGN KEY ("sucursal_id", "organizacion_id") REFERENCES "sucursales"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registros_auditoria" ADD CONSTRAINT "auditoria_usuario_organizacion_fk" FOREIGN KEY ("usuario_id", "organizacion_id") REFERENCES "usuarios"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registros_auditoria" ADD CONSTRAINT "registros_auditoria_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservas_stock" ADD CONSTRAINT "reserva_disponibilidad_organizacion_fk" FOREIGN KEY ("disponibilidad_proveedor_id", "organizacion_id") REFERENCES "disponibilidad_proveedor"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservas_stock" ADD CONSTRAINT "reserva_operacion_organizacion_fk" FOREIGN KEY ("operacion_id", "organizacion_id") REFERENCES "operaciones"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservas_stock" ADD CONSTRAINT "reserva_personal_organizacion_fk" FOREIGN KEY ("creado_por_personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservas_stock" ADD CONSTRAINT "reserva_unidad_organizacion_fk" FOREIGN KEY ("unidad_vehiculo_id", "organizacion_id") REFERENCES "unidades_vehiculos"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservas_stock" ADD CONSTRAINT "reservas_stock_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitudes_abastecimiento" ADD CONSTRAINT "abastecimiento_disponibilidad_organizacion_fk" FOREIGN KEY ("disponibilidad_proveedor_id", "organizacion_id") REFERENCES "disponibilidad_proveedor"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitudes_abastecimiento" ADD CONSTRAINT "abastecimiento_operacion_organizacion_fk" FOREIGN KEY ("operacion_id", "organizacion_id") REFERENCES "operaciones"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitudes_abastecimiento" ADD CONSTRAINT "abastecimiento_personal_organizacion_fk" FOREIGN KEY ("creado_por_personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitudes_abastecimiento" ADD CONSTRAINT "abastecimiento_proveedor_organizacion_fk" FOREIGN KEY ("proveedor_id", "organizacion_id") REFERENCES "proveedores"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitudes_abastecimiento" ADD CONSTRAINT "abastecimiento_sucursal_organizacion_fk" FOREIGN KEY ("sucursal_llegada_id", "organizacion_id") REFERENCES "sucursales"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitudes_abastecimiento" ADD CONSTRAINT "abastecimiento_unidad_organizacion_fk" FOREIGN KEY ("unidad_vehiculo_recibida_id", "organizacion_id") REFERENCES "unidades_vehiculos"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solicitudes_abastecimiento" ADD CONSTRAINT "solicitudes_abastecimiento_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transferencias_caja" ADD CONSTRAINT "transferencia_destino_organizacion_fk" FOREIGN KEY ("cuenta_destino_id", "organizacion_id") REFERENCES "cuentas_caja"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transferencias_caja" ADD CONSTRAINT "transferencia_origen_organizacion_fk" FOREIGN KEY ("cuenta_origen_id", "organizacion_id") REFERENCES "cuentas_caja"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transferencias_caja" ADD CONSTRAINT "transferencia_personal_organizacion_fk" FOREIGN KEY ("creado_por_personal_id", "organizacion_id") REFERENCES "personal"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transferencias_caja" ADD CONSTRAINT "transferencias_caja_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unidades_vehiculos" ADD CONSTRAINT "unidad_proveedor_organizacion_fk" FOREIGN KEY ("proveedor_id", "organizacion_id") REFERENCES "proveedores"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unidades_vehiculos" ADD CONSTRAINT "unidad_sucursal_organizacion_fk" FOREIGN KEY ("sucursal_id", "organizacion_id") REFERENCES "sucursales"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unidades_vehiculos" ADD CONSTRAINT "unidades_vehiculos_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_sucursal_organizacion_fk" FOREIGN KEY ("sucursal_id", "organizacion_id") REFERENCES "sucursales"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vehiculos_tomados_parte_pago" ADD CONSTRAINT "toma_operacion_organizacion_fk" FOREIGN KEY ("operacion_id", "organizacion_id") REFERENCES "operaciones"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vehiculos_tomados_parte_pago" ADD CONSTRAINT "toma_unidad_organizacion_fk" FOREIGN KEY ("unidad_vehiculo_resultante_id", "organizacion_id") REFERENCES "unidades_vehiculos"("id", "organizacion_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vehiculos_tomados_parte_pago" ADD CONSTRAINT "vehiculos_tomados_parte_pago_organizacion_fk" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "versiones_vehiculos" ADD CONSTRAINT "versiones_vehiculos_organizacion_propietaria_id_fkey" FOREIGN KEY ("organizacion_propietaria_id") REFERENCES "organizaciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

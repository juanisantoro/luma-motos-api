-- Lets a supply request (solicitudes_abastecimiento) record which color
-- was requested for the vehicle being ordered from a supplier, so it isn't
-- lost between "hacer el pedido" and "recibir": SupplyService.receive()
-- uses it as the default color for the unit it creates when no color is
-- given explicitly at reception time.
--
-- Free VARCHAR(80), same as unidades_vehiculos.color - validated at the
-- application layer against colores_unidad (see assertValidUnitColor in
-- src/common/unit-colors.ts), not a foreign key.
ALTER TABLE "public"."solicitudes_abastecimiento"
  ADD COLUMN "color" VARCHAR(80);

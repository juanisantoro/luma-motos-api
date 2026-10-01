-- Fase 5: llegada de la patente.
--
-- * patente_recibida_en: fecha en que la administrativa registró que llegó la
--   patente. El número vive en la unidad (unidades_vehiculos.patente /
--   patente_normalizada), como hasta ahora. NULL = en trámite.
-- * Las operaciones cuya unidad ya tenía patente cargada (usados, cargas
--   anteriores a esta fase) se consideran recibidas sin fecha: no se
--   rellenan para no inventar una fecha de recepción.
-- * No se recalculan las ventanas estimadas ya guardadas: los feriados
--   nacionales se aplican a operaciones nuevas y a las que cambian de fecha.
ALTER TABLE "public"."operaciones" ADD COLUMN "patente_recibida_en" DATE;

ALTER TABLE "public"."operaciones"
  ADD CONSTRAINT "operacion_patente_recibida_valida" CHECK (
    "patente_recibida_en" IS NULL
    OR "patente_recibida_en" >= "fecha_operacion"
  );

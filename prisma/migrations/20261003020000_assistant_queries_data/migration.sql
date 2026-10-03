-- Lumi: marca las consultas que se respondieron leyendo datos del sistema
-- (operaciones, patentes, pagos, stock).
--
-- Esas respuestas dependen de quién pregunta y de cuándo: una vendedora ve
-- sólo sus ventas y los datos cambian todo el tiempo. Por eso nunca se
-- reusan para otra pregunta igual: el reuso de respuestas sólo toma filas
-- con "uso_datos" = false.

ALTER TABLE "consultas_asistente"
  ADD COLUMN "uso_datos" BOOLEAN NOT NULL DEFAULT false;

-- Una respuesta con datos no puede ser el origen de un reuso ni ser reusada.
ALTER TABLE "consultas_asistente"
  ADD CONSTRAINT "consultas_asistente_datos_sin_reuso"
    CHECK (NOT ("uso_datos" AND "desde_cache"));

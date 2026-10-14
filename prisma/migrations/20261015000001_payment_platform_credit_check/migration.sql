-- La base tenía armada a mano la regla "la forma de pago lleva crédito si y
-- sólo si hay monto de crédito" (operacion_plataforma_credito_valido) con la
-- lista vieja de formas de pago, y rechazaba las nuevas con crédito
-- (TRANSFERENCIA_CREDITO, CREDITO_CREDITO). Se vuelve a crear con la lista
-- completa. Se compara como texto para no depender de los valores del enum
-- agregados en la migración anterior.
-- NOT VALID: no revisa las operaciones viejas (la regla anterior ya las
-- controlaba); rige para todo lo que se cargue o edite desde ahora.
ALTER TABLE "public"."operaciones"
  DROP CONSTRAINT IF EXISTS "operacion_plataforma_credito_valido";

ALTER TABLE "public"."operaciones"
  ADD CONSTRAINT "operacion_plataforma_credito_valido" CHECK (
    "plataforma_pago" IS NULL
    OR (
      "plataforma_pago"::text IN (
        'CREDITO',
        'CREDITO_CREDITO',
        'EFECTIVO_CREDITO',
        'TRANSFERENCIA_CREDITO',
        'MOTO_CREDITO',
        'MOTO_EFECTIVO_CREDITO'
      )
      AND "monto_credito" IS NOT NULL
      AND "monto_credito" > 0
    )
    OR (
      "plataforma_pago"::text NOT IN (
        'CREDITO',
        'CREDITO_CREDITO',
        'EFECTIVO_CREDITO',
        'TRANSFERENCIA_CREDITO',
        'MOTO_CREDITO',
        'MOTO_EFECTIVO_CREDITO'
      )
      AND ("monto_credito" IS NULL OR "monto_credito" = 0)
    )
  ) NOT VALID;

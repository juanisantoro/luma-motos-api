CREATE TYPE "plataforma_pago_luma" AS ENUM (
  'EFECTIVO',
  'CREDITO',
  'EFECTIVO_CREDITO',
  'MOTO_EFECTIVO',
  'MOTO_CREDITO',
  'MOTO_EFECTIVO_CREDITO'
);

CREATE TYPE "deuda_operacion_luma" AS ENUM (
  'NO',
  'RESERVA',
  'CUOTA_INICIAL',
  'PAPELES',
  'ACCESORIOS',
  'OTRO'
);

ALTER TABLE "operaciones"
  ADD COLUMN "plataforma_pago" "plataforma_pago_luma",
  ADD COLUMN "monto_credito" DECIMAL(18, 2),
  ADD COLUMN "respaldo_garante" VARCHAR(500),
  ADD COLUMN "debe" "deuda_operacion_luma" NOT NULL DEFAULT 'NO';

ALTER TABLE "operaciones"
  ADD CONSTRAINT "operacion_plataforma_credito_valido" CHECK (
    (
      plataforma_pago IS NULL
      AND monto_credito IS NULL
    )
    OR (
      plataforma_pago IN ('EFECTIVO', 'MOTO_EFECTIVO')
      AND monto_credito IS NULL
    )
    OR (
      plataforma_pago IN (
        'CREDITO',
        'EFECTIVO_CREDITO',
        'MOTO_CREDITO',
        'MOTO_EFECTIVO_CREDITO'
      )
      AND monto_credito > 0
      AND monto_credito <= precio_acordado
    )
  ),
  ADD CONSTRAINT "operacion_respaldo_garante_valido" CHECK (
    respaldo_garante IS NULL OR length(trim(respaldo_garante)) > 0
  );

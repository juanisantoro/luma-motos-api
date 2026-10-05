-- Retiros de socios: plata que un socio saca de una caja de la que es
-- responsable. No es un gasto (no entra en el resultado del mes) y por eso
-- vive en su propia tabla.
--
-- Cada retiro genera un movimiento de caja de tipo AJUSTE / DEBITO
-- ("movimiento_caja_id"). Los movimientos son inmutables: anular un retiro
-- registra un contramovimiento ("reversa_movimiento_id") y lo deja ANULADO.
-- La sucursal y la moneda del retiro son las de la cuenta.

CREATE TABLE "retiros_socio" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizacion_id" UUID NOT NULL,
  "cuenta_caja_id" UUID NOT NULL,
  "socio_personal_id" UUID NOT NULL,
  "importe" DECIMAL(18, 2) NOT NULL,
  "moneda" CHAR(3) NOT NULL,
  "fecha" DATE NOT NULL,
  "motivo" TEXT NOT NULL,
  "estado" VARCHAR(20) NOT NULL DEFAULT 'REGISTRADO',
  "movimiento_caja_id" UUID NOT NULL,
  "reversa_movimiento_id" UUID,
  "anulado_motivo" TEXT,
  "anulado_en" TIMESTAMPTZ(6),
  "anulado_por_personal_id" UUID,
  "creado_por_personal_id" UUID NOT NULL,
  "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "retiros_socio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retiros_socio_importe_valido" CHECK ("importe" > 0),
  CONSTRAINT "retiros_socio_estado_valido"
    CHECK ("estado" IN ('REGISTRADO', 'ANULADO')),
  CONSTRAINT "retiros_socio_anulacion_coherente"
    CHECK (
      ("estado" = 'REGISTRADO'
        AND "reversa_movimiento_id" IS NULL
        AND "anulado_en" IS NULL)
      OR ("estado" = 'ANULADO'
        AND "reversa_movimiento_id" IS NOT NULL
        AND "anulado_en" IS NOT NULL
        AND "anulado_motivo" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "retiros_socio_id_organizacion_unico"
  ON "retiros_socio" ("id", "organizacion_id");

CREATE UNIQUE INDEX "retiros_socio_movimiento_unico"
  ON "retiros_socio" ("movimiento_caja_id");

CREATE INDEX "retiros_socio_organizacion_fecha_indice"
  ON "retiros_socio" ("organizacion_id", "fecha" DESC);

CREATE INDEX "retiros_socio_cuenta_indice"
  ON "retiros_socio" ("cuenta_caja_id");

ALTER TABLE "retiros_socio"
  ADD CONSTRAINT "retiros_socio_organizacion_id_fkey"
    FOREIGN KEY ("organizacion_id")
    REFERENCES "organizaciones"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "retiro_socio_cuenta_organizacion_fk"
    FOREIGN KEY ("cuenta_caja_id", "organizacion_id")
    REFERENCES "cuentas_caja"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "retiro_socio_socio_organizacion_fk"
    FOREIGN KEY ("socio_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "retiro_socio_movimiento_organizacion_fk"
    FOREIGN KEY ("movimiento_caja_id", "organizacion_id")
    REFERENCES "movimientos_caja"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "retiro_socio_reversa_organizacion_fk"
    FOREIGN KEY ("reversa_movimiento_id", "organizacion_id")
    REFERENCES "movimientos_caja"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "retiro_socio_anulador_organizacion_fk"
    FOREIGN KEY ("anulado_por_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "retiro_socio_creador_organizacion_fk"
    FOREIGN KEY ("creado_por_personal_id", "organizacion_id")
    REFERENCES "personal"("id", "organizacion_id")
    ON DELETE RESTRICT;

ALTER TABLE "retiros_socio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retiros_socio" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "politica_retiros_socio_organizacion" ON "retiros_socio";
CREATE POLICY "politica_retiros_socio_organizacion" ON "retiros_socio"
FOR ALL
USING (luma_tiene_acceso_organizacion(organizacion_id))
WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id));

DROP TRIGGER IF EXISTS "disparador_retiros_socio_actualizado_en" ON "retiros_socio";
CREATE TRIGGER "disparador_retiros_socio_actualizado_en"
BEFORE UPDATE ON "retiros_socio"
FOR EACH ROW EXECUTE FUNCTION "luma_establecer_actualizado_en"();

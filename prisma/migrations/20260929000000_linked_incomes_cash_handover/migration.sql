-- Fase 4: ingresos vinculados y rendición de efectivo.
--
-- * cliente_id: doble asociación del ingreso (operación/boleto + cliente).
--   Si el ingreso tiene operacion_id, un trigger completa cliente_id con el
--   cliente de la operación y rechaza cualquier otro valor. Si cambia el
--   cliente de una operación, sus ingresos se actualizan en la misma
--   transacción, así la invariante nunca queda rota.
-- * componente_pago_id: cobro de un componente del plan de pago. Debe
--   pertenecer a la misma operación del ingreso.
-- * medio_pago: medio del cobro. En EFECTIVO es obligatorio saber quién
--   recibió el dinero (cobrado_por_personal_id) y a quién se lo rinde
--   (rendido_a_personal_id). Solo el destinatario confirma la recepción.
-- * version_fila: concurrencia optimista para la confirmación de rendición.
-- * cuota_credito_id: ingreso generado al cobrar una cuota del crédito propio.
-- * componentes_pago_operacion.financiera_pago_*: la financiera informó que
--   pagó (sin monto). El componente queda PAGADO aunque haya entrado un neto
--   menor al financiado.
-- * financieras.es_credito_propio: la financiación es crédito de Luma; se
--   cobra por cuotas, no por desembolso.

CREATE TYPE "public"."estado_rendicion_luma" AS ENUM ('PENDIENTE_RENDICION', 'RENDIDO');

ALTER TABLE "public"."ingresos"
  ADD COLUMN "cliente_id" UUID,
  ADD COLUMN "componente_pago_id" UUID,
  ADD COLUMN "medio_pago" "public"."metodo_cobranza_luma",
  ADD COLUMN "rendido_a_personal_id" UUID,
  ADD COLUMN "estado_rendicion" "public"."estado_rendicion_luma",
  ADD COLUMN "rendicion_confirmada_en" TIMESTAMPTZ(6),
  ADD COLUMN "rendicion_confirmada_por_personal_id" UUID,
  ADD COLUMN "version_fila" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cuota_credito_id" UUID;

ALTER TABLE "public"."ingresos"
  ADD CONSTRAINT "ingreso_cliente_organizacion_fk"
    FOREIGN KEY ("cliente_id", "organizacion_id")
    REFERENCES "public"."clientes"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "ingreso_componente_pago_organizacion_fk"
    FOREIGN KEY ("componente_pago_id", "organizacion_id")
    REFERENCES "public"."componentes_pago_operacion"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "ingreso_rendido_a_organizacion_fk"
    FOREIGN KEY ("rendido_a_personal_id", "organizacion_id")
    REFERENCES "public"."personal"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "ingreso_rendicion_confirmador_organizacion_fk"
    FOREIGN KEY ("rendicion_confirmada_por_personal_id", "organizacion_id")
    REFERENCES "public"."personal"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "ingreso_cuota_credito_organizacion_fk"
    FOREIGN KEY ("cuota_credito_id", "organizacion_id")
    REFERENCES "public"."cuotas_credito"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "ingresos_cuota_requiere_operacion" CHECK (
    "cuota_credito_id" IS NULL OR "operacion_id" IS NOT NULL
  ),
  ADD CONSTRAINT "ingresos_componente_requiere_operacion" CHECK (
    "componente_pago_id" IS NULL OR "operacion_id" IS NOT NULL
  ),
  ADD CONSTRAINT "ingresos_efectivo_requiere_cobrador" CHECK (
    "medio_pago" IS DISTINCT FROM 'EFECTIVO'
    OR "cobrado_por_personal_id" IS NOT NULL
  ),
  ADD CONSTRAINT "ingresos_rendicion_contrato" CHECK (
    (
      "estado_rendicion" IS NULL
      AND "rendido_a_personal_id" IS NULL
      AND "rendicion_confirmada_en" IS NULL
      AND "rendicion_confirmada_por_personal_id" IS NULL
    )
    OR (
      "medio_pago" = 'EFECTIVO'
      AND "rendido_a_personal_id" IS NOT NULL
      AND (
        (
          "estado_rendicion" = 'PENDIENTE_RENDICION'
          AND "rendicion_confirmada_en" IS NULL
          AND "rendicion_confirmada_por_personal_id" IS NULL
        )
        OR (
          "estado_rendicion" = 'RENDIDO'
          AND "rendicion_confirmada_en" IS NOT NULL
          AND "rendicion_confirmada_por_personal_id" = "rendido_a_personal_id"
        )
      )
    )
  ),
  ADD CONSTRAINT "ingresos_efectivo_requiere_rendicion" CHECK (
    "medio_pago" IS DISTINCT FROM 'EFECTIVO'
    OR "estado_rendicion" IS NOT NULL
  ),
  ADD CONSTRAINT "ingresos_version_fila_valida" CHECK ("version_fila" >= 0);

CREATE INDEX "ingresos_cliente_fecha_indice"
  ON "public"."ingresos" ("organizacion_id", "cliente_id", "fecha_ingreso" DESC)
  WHERE "cliente_id" IS NOT NULL;
CREATE INDEX "ingresos_operacion_indice"
  ON "public"."ingresos" ("operacion_id")
  WHERE "operacion_id" IS NOT NULL;
CREATE INDEX "ingresos_componente_pago_indice"
  ON "public"."ingresos" ("componente_pago_id")
  WHERE "componente_pago_id" IS NOT NULL;
CREATE INDEX "ingresos_cuota_credito_indice"
  ON "public"."ingresos" ("cuota_credito_id")
  WHERE "cuota_credito_id" IS NOT NULL;
CREATE INDEX "ingresos_rendicion_pendiente_indice"
  ON "public"."ingresos" ("organizacion_id", "rendido_a_personal_id")
  WHERE "estado_rendicion" = 'PENDIENTE_RENDICION';
CREATE INDEX "operaciones_numero_boleto_indice"
  ON "public"."operaciones" ("organizacion_id", "numero_boleto")
  WHERE "numero_boleto" IS NOT NULL;

-- Consistencia ingreso ↔ operación ↔ cliente ↔ componente.
CREATE OR REPLACE FUNCTION "public"."luma_validar_vinculos_ingreso"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cliente_operacion uuid;
  operacion_componente uuid;
  operacion_cuota uuid;
BEGIN
  IF NEW.operacion_id IS NOT NULL THEN
    SELECT cliente_id
    INTO cliente_operacion
    FROM "public"."operaciones"
    WHERE id = NEW.operacion_id
      AND organizacion_id = NEW.organizacion_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La operacion % no existe en la organizacion del ingreso', NEW.operacion_id
        USING ERRCODE = '23503';
    END IF;

    IF NEW.cliente_id IS NULL THEN
      NEW.cliente_id := cliente_operacion;
    ELSIF NEW.cliente_id <> cliente_operacion THEN
      RAISE EXCEPTION 'El cliente % del ingreso no coincide con el cliente % de la operacion %',
        NEW.cliente_id, cliente_operacion, NEW.operacion_id
        USING ERRCODE = '23514', CONSTRAINT = 'ingresos_cliente_operacion_consistente';
    END IF;
  END IF;

  IF NEW.componente_pago_id IS NOT NULL THEN
    SELECT operacion_id
    INTO operacion_componente
    FROM "public"."componentes_pago_operacion"
    WHERE id = NEW.componente_pago_id
      AND organizacion_id = NEW.organizacion_id;

    IF operacion_componente IS DISTINCT FROM NEW.operacion_id THEN
      RAISE EXCEPTION 'El componente de pago % no pertenece a la operacion % del ingreso',
        NEW.componente_pago_id, NEW.operacion_id
        USING ERRCODE = '23514', CONSTRAINT = 'ingresos_componente_operacion_consistente';
    END IF;
  END IF;

  IF NEW.cuota_credito_id IS NOT NULL THEN
    SELECT credito.operacion_id
    INTO operacion_cuota
    FROM "public"."cuotas_credito" cuota
    JOIN "public"."operacion_creditos" credito
      ON credito.id = cuota.operacion_credito_id
    WHERE cuota.id = NEW.cuota_credito_id
      AND cuota.organizacion_id = NEW.organizacion_id;

    IF operacion_cuota IS DISTINCT FROM NEW.operacion_id THEN
      RAISE EXCEPTION 'La cuota % no pertenece a la operacion % del ingreso',
        NEW.cuota_credito_id, NEW.operacion_id
        USING ERRCODE = '23514', CONSTRAINT = 'ingresos_cuota_operacion_consistente';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "disparador_ingresos_vinculos" ON "public"."ingresos";
CREATE TRIGGER "disparador_ingresos_vinculos"
BEFORE INSERT OR UPDATE OF "operacion_id", "cliente_id", "componente_pago_id", "cuota_credito_id", "organizacion_id"
ON "public"."ingresos"
FOR EACH ROW EXECUTE FUNCTION "public"."luma_validar_vinculos_ingreso"();

CREATE OR REPLACE FUNCTION "public"."luma_propagar_cliente_operacion_a_ingresos"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "public"."ingresos"
  SET cliente_id = NEW.cliente_id
  WHERE operacion_id = NEW.id
    AND organizacion_id = NEW.organizacion_id
    AND cliente_id IS DISTINCT FROM NEW.cliente_id;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "disparador_operaciones_cliente_ingresos" ON "public"."operaciones";
CREATE TRIGGER "disparador_operaciones_cliente_ingresos"
AFTER UPDATE OF "cliente_id" ON "public"."operaciones"
FOR EACH ROW
WHEN (OLD.cliente_id IS DISTINCT FROM NEW.cliente_id)
EXECUTE FUNCTION "public"."luma_propagar_cliente_operacion_a_ingresos"();

-- La financiera informó que pagó (sin monto) y financiación de crédito propio.
ALTER TABLE "public"."financieras"
  ADD COLUMN "es_credito_propio" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "public"."componentes_pago_operacion"
  ADD COLUMN "financiera_pago_informado_en" TIMESTAMPTZ(6),
  ADD COLUMN "financiera_pago_informado_por_personal_id" UUID,
  ADD COLUMN "financiera_pago_notas" TEXT;

ALTER TABLE "public"."componentes_pago_operacion"
  ADD CONSTRAINT "componente_financiera_pago_informante_organizacion_fk"
    FOREIGN KEY ("financiera_pago_informado_por_personal_id", "organizacion_id")
    REFERENCES "public"."personal"("id", "organizacion_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "componentes_financiera_pago_completo" CHECK (
    ("financiera_pago_informado_en" IS NULL) = ("financiera_pago_informado_por_personal_id" IS NULL)
    AND ("financiera_pago_notas" IS NULL OR "financiera_pago_informado_en" IS NOT NULL)
  ),
  ADD CONSTRAINT "componentes_financiera_pago_solo_financiacion" CHECK (
    "financiera_pago_informado_en" IS NULL OR "tipo_componente" = 'FINANCIACION'
  );

CREATE INDEX "componentes_financiacion_pendiente_indice"
  ON "public"."componentes_pago_operacion" ("organizacion_id", "operacion_id")
  WHERE "tipo_componente" = 'FINANCIACION' AND "financiera_pago_informado_en" IS NULL;

-- Backfill de ingresos ya vinculados a una operación. La tabla tiene RLS
-- forzada: habilitar acceso transversal sólo dentro de esta transacción.
SELECT set_config('app.acceso_global', 'true', true);

UPDATE "public"."ingresos" AS ingreso
SET cliente_id = operacion.cliente_id
FROM "public"."operaciones" AS operacion
WHERE ingreso.operacion_id = operacion.id
  AND ingreso.organizacion_id = operacion.organizacion_id
  AND ingreso.cliente_id IS NULL;

-- Tipo de ingreso usado por los cobros de componentes del plan de pago.
INSERT INTO "public"."tipos_ingreso" ("nombre", "nombre_normalizado") VALUES
  ('Cobro de operación', 'cobro de operación'),
  ('Cuota crédito', 'cuota crédito')
ON CONFLICT ("nombre_normalizado") DO NOTHING;

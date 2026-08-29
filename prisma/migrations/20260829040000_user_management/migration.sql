-- Track whether a user has replaced the non-usable bootstrap hash.
ALTER TABLE "usuarios"
ADD COLUMN "contrasena_configurada_en" TIMESTAMPTZ(6);

UPDATE "usuarios"
SET "contrasena_configurada_en" = COALESCE("actualizado_en", "creado_en", CURRENT_TIMESTAMP);

-- Preserve both the actor organization and the organization affected by a global action.
ALTER TABLE "registros_auditoria"
ADD COLUMN "organizacion_objetivo_id" UUID;

CREATE INDEX "registros_auditoria_organizacion_objetivo_indice"
ON "registros_auditoria"("organizacion_objetivo_id", "creado_en" DESC);

ALTER TABLE "registros_auditoria"
ADD CONSTRAINT "registros_auditoria_organizacion_objetivo_fk"
FOREIGN KEY ("organizacion_objetivo_id")
REFERENCES "organizaciones"("id")
ON DELETE RESTRICT
ON UPDATE NO ACTION;

DROP POLICY "politica_registros_auditoria_organizacion"
ON "registros_auditoria";

CREATE POLICY "politica_registros_auditoria_organizacion"
ON "registros_auditoria"
AS PERMISSIVE
FOR ALL
TO PUBLIC
USING (
  luma_tiene_acceso_organizacion("organizacion_id")
  OR luma_tiene_acceso_organizacion("organizacion_objetivo_id")
)
WITH CHECK (
  luma_tiene_acceso_organizacion("organizacion_id")
  OR luma_tiene_acceso_organizacion("organizacion_objetivo_id")
);

-- One-time activation credentials are stored only as SHA-256 hashes.
CREATE TABLE "tokens_activacion_usuario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "vence_en" TIMESTAMPTZ(6) NOT NULL,
    "usado_en" TIMESTAMPTZ(6),
    "revocado_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_activacion_usuario_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tokens_activacion_estado_valido"
      CHECK (NOT ("usado_en" IS NOT NULL AND "revocado_en" IS NOT NULL)),
    CONSTRAINT "tokens_activacion_vencimiento_valido"
      CHECK ("vence_en" > "creado_en")
);

CREATE UNIQUE INDEX "tokens_activacion_usuario_token_hash_key"
ON "tokens_activacion_usuario"("token_hash");

CREATE INDEX "tokens_activacion_usuario_indice"
ON "tokens_activacion_usuario"("usuario_id", "organizacion_id");

CREATE INDEX "tokens_activacion_vencimiento_indice"
ON "tokens_activacion_usuario"("vence_en");

ALTER TABLE "tokens_activacion_usuario"
ADD CONSTRAINT "tokens_activacion_usuario_organizacion_fk"
FOREIGN KEY ("organizacion_id")
REFERENCES "organizaciones"("id")
ON DELETE RESTRICT
ON UPDATE NO ACTION;

ALTER TABLE "tokens_activacion_usuario"
ADD CONSTRAINT "tokens_activacion_usuario_usuario_fk"
FOREIGN KEY ("usuario_id", "organizacion_id")
REFERENCES "usuarios"("id", "organizacion_id")
ON DELETE CASCADE
ON UPDATE NO ACTION;

ALTER TABLE "tokens_activacion_usuario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tokens_activacion_usuario" FORCE ROW LEVEL SECURITY;

CREATE POLICY "politica_tokens_activacion_usuario_organizacion"
ON "tokens_activacion_usuario"
AS PERMISSIVE
FOR ALL
TO PUBLIC
USING (luma_tiene_acceso_organizacion("organizacion_id"))
WITH CHECK (luma_tiene_acceso_organizacion("organizacion_id"));

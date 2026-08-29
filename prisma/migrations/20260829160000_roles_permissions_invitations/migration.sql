-- Tenant-scoped custom roles, protected global system roles and auditable invitations.
ALTER TABLE "roles"
ADD COLUMN "organizacion_id" UUID,
ADD COLUMN "es_sistema" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "roles"
SET "es_sistema" = true
WHERE "codigo" IN ('ADMINISTRADOR', 'GERENTE', 'ADMINISTRATIVA', 'VENDEDOR');

ALTER TABLE "roles"
ADD CONSTRAINT "roles_sistema_organizacion_valida"
CHECK (
  ("es_sistema" = true AND "organizacion_id" IS NULL)
  OR ("es_sistema" = false AND "organizacion_id" IS NOT NULL)
);

ALTER TABLE "roles"
ADD CONSTRAINT "roles_version_valida" CHECK ("version" > 0);

ALTER TABLE "roles"
ADD CONSTRAINT "roles_organizacion_fk"
FOREIGN KEY ("organizacion_id")
REFERENCES "organizaciones"("id")
ON DELETE RESTRICT
ON UPDATE NO ACTION;

DROP INDEX "roles_codigo_key";
DROP INDEX "roles_nombre_key";

CREATE UNIQUE INDEX "roles_sistema_codigo_unico"
ON "roles"("codigo")
WHERE "organizacion_id" IS NULL;

CREATE UNIQUE INDEX "roles_sistema_nombre_unico"
ON "roles"(lower("nombre"))
WHERE "organizacion_id" IS NULL;

CREATE UNIQUE INDEX "roles_organizacion_codigo_unico"
ON "roles"("organizacion_id", "codigo")
WHERE "organizacion_id" IS NOT NULL;

CREATE UNIQUE INDEX "roles_organizacion_nombre_unico"
ON "roles"("organizacion_id", lower("nombre"))
WHERE "organizacion_id" IS NOT NULL;

CREATE INDEX "roles_organizacion_activo_indice"
ON "roles"("organizacion_id", "activo");

CREATE OR REPLACE FUNCTION public.luma_proteger_identidad_rol()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."id"::text, 1));

  IF TG_OP = 'UPDATE' AND OLD."es_sistema" = true AND (
    NEW."codigo" IS DISTINCT FROM OLD."codigo"
    OR NEW."es_sistema" IS DISTINCT FROM OLD."es_sistema"
    OR NEW."organizacion_id" IS DISTINCT FROM OLD."organizacion_id"
  ) THEN
    RAISE EXCEPTION 'La identidad de un rol del sistema no puede modificarse'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."es_sistema" = false AND EXISTS (
    SELECT 1
    FROM "roles" AS system_role
    WHERE system_role."es_sistema" = true
      AND system_role."id" <> NEW."id"
      AND (
        system_role."codigo" = NEW."codigo"
        OR lower(system_role."nombre") = lower(NEW."nombre")
      )
  ) THEN
    RAISE EXCEPTION 'El rol personalizado colisiona con un rol del sistema'
      USING ERRCODE = '23505';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."activo" = false AND OLD."activo" = true THEN
    IF NEW."es_sistema" = true THEN
      RAISE EXCEPTION 'Los roles del sistema no pueden desactivarse'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "usuarios" WHERE "rol_id" = NEW."id"
    ) THEN
      RAISE EXCEPTION 'El rol tiene usuarios asignados'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "disparador_proteger_identidad_rol"
BEFORE INSERT OR UPDATE ON "roles"
FOR EACH ROW EXECUTE FUNCTION public.luma_proteger_identidad_rol();

CREATE TYPE "estado_invitacion_usuario" AS ENUM (
  'PENDING',
  'DELIVERED',
  'FAILED',
  'ACCEPTED',
  'EXPIRED'
);

ALTER TABLE "usuarios"
ADD COLUMN "estado_invitacion" "estado_invitacion_usuario" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "invitacion_ultimo_intento_en" TIMESTAMPTZ(6),
ADD COLUMN "invitacion_enviada_en" TIMESTAMPTZ(6),
ADD COLUMN "invitacion_aceptada_en" TIMESTAMPTZ(6),
ADD COLUMN "invitacion_error" VARCHAR(240),
ADD COLUMN "invitacion_version" INTEGER NOT NULL DEFAULT 1;

UPDATE "usuarios"
SET
  "estado_invitacion" = CASE
    WHEN "contrasena_configurada_en" IS NOT NULL THEN 'ACCEPTED'::"estado_invitacion_usuario"
    WHEN "contrasena_temporal_vence_en" <= CURRENT_TIMESTAMP THEN 'EXPIRED'::"estado_invitacion_usuario"
    WHEN "contrasena_temporal_vence_en" > CURRENT_TIMESTAMP THEN 'DELIVERED'::"estado_invitacion_usuario"
    ELSE 'PENDING'::"estado_invitacion_usuario"
  END,
  "invitacion_aceptada_en" = "contrasena_configurada_en",
  "invitacion_enviada_en" = CASE
    WHEN "contrasena_configurada_en" IS NULL
      AND "contrasena_temporal_vence_en" > CURRENT_TIMESTAMP
    THEN "actualizado_en"
    ELSE NULL
  END;

ALTER TABLE "usuarios"
ADD CONSTRAINT "usuarios_invitacion_version_valida"
CHECK ("invitacion_version" > 0);

CREATE INDEX "usuarios_organizacion_invitacion_indice"
ON "usuarios"("organizacion_id", "estado_invitacion");

CREATE OR REPLACE FUNCTION public.luma_validar_rol_organizacion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rol_organizacion UUID;
  rol_sistema BOOLEAN;
  rol_activo BOOLEAN;
BEGIN
  IF NEW.rol_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.rol_id::text, 1));

  SELECT "organizacion_id", "es_sistema", "activo"
  INTO rol_organizacion, rol_sistema, rol_activo
  FROM "roles"
  WHERE "id" = NEW.rol_id;

  IF NOT FOUND
    OR rol_activo = false
    OR (rol_sistema = false AND rol_organizacion IS DISTINCT FROM NEW.organizacion_id)
  THEN
    RAISE EXCEPTION 'El rol no pertenece a la organización indicada'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "disparador_usuario_rol_organizacion"
BEFORE INSERT OR UPDATE OF "rol_id", "organizacion_id" ON "usuarios"
FOR EACH ROW EXECUTE FUNCTION public.luma_validar_rol_organizacion();

CREATE TRIGGER "disparador_personal_rol_organizacion"
BEFORE INSERT OR UPDATE OF "rol_id", "organizacion_id" ON "personal"
FOR EACH ROW EXECUTE FUNCTION public.luma_validar_rol_organizacion();

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

CREATE POLICY "politica_roles_lectura"
ON "roles"
AS PERMISSIVE
FOR SELECT
TO PUBLIC
USING (
  "es_sistema" = true
  OR luma_tiene_acceso_organizacion("organizacion_id")
);

CREATE POLICY "politica_roles_insercion"
ON "roles"
AS PERMISSIVE
FOR INSERT
TO PUBLIC
WITH CHECK (
  (
    "es_sistema" = true
    AND "organizacion_id" IS NULL
    AND COALESCE(
      NULLIF(current_setting('app.acceso_global', true), ''),
      'false'
    )::boolean
  )
  OR luma_tiene_acceso_organizacion("organizacion_id")
);

CREATE POLICY "politica_roles_actualizacion"
ON "roles"
AS PERMISSIVE
FOR UPDATE
TO PUBLIC
USING (
  (
    "es_sistema" = true
    AND COALESCE(
      NULLIF(current_setting('app.acceso_global', true), ''),
      'false'
    )::boolean
  )
  OR luma_tiene_acceso_organizacion("organizacion_id")
)
WITH CHECK (
  (
    "es_sistema" = true
    AND "organizacion_id" IS NULL
    AND COALESCE(
      NULLIF(current_setting('app.acceso_global', true), ''),
      'false'
    )::boolean
  )
  OR luma_tiene_acceso_organizacion("organizacion_id")
);

ALTER TABLE "permisos_rol" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "permisos_rol" FORCE ROW LEVEL SECURITY;

CREATE POLICY "politica_permisos_rol_lectura"
ON "permisos_rol"
AS PERMISSIVE
FOR SELECT
TO PUBLIC
USING (
  EXISTS (
    SELECT 1
    FROM "roles"
    WHERE "roles"."id" = "permisos_rol"."rol_id"
  )
);

CREATE POLICY "politica_permisos_rol_mutacion"
ON "permisos_rol"
AS PERMISSIVE
FOR ALL
TO PUBLIC
USING (
  EXISTS (
    SELECT 1
    FROM "roles"
    WHERE "roles"."id" = "permisos_rol"."rol_id"
      AND (
        "roles"."es_sistema" = false
        OR COALESCE(
          NULLIF(current_setting('app.acceso_global', true), ''),
          'false'
        )::boolean
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM "roles"
    WHERE "roles"."id" = "permisos_rol"."rol_id"
      AND (
        "roles"."es_sistema" = false
        OR COALESCE(
          NULLIF(current_setting('app.acceso_global', true), ''),
          'false'
        )::boolean
      )
  )
);

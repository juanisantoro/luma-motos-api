-- "Funciona como": un rol creado por la organización puede tomar como base un
-- rol del sistema (p. ej. "Vendedor autos" con base VENDEDOR). Para todo lo
-- que depende del tipo de rol (quién figura como vendedor, comisiones, el
-- inicio) cuenta como ese rol; sus permisos son los que tenga cargados.
-- Los roles del sistema no llevan base y Administrador no se usa como base.
ALTER TABLE "public"."roles" ADD COLUMN "rol_base" VARCHAR(50);

ALTER TABLE "public"."roles"
  ADD CONSTRAINT "roles_rol_base_valido" CHECK (
    "rol_base" IS NULL
    OR (
      "es_sistema" = false
      AND "rol_base" IN (
        'GERENTE', 'ADMINISTRATIVA', 'VENDEDOR', 'CALLCENTER', 'MECANICO'
      )
    )
  );

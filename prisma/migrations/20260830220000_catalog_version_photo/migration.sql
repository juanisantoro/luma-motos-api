-- Adds an optional photo URL to each catalog version (brand/model/version),
-- used by the read-only catalog view for sellers and managed from the
-- catalog administration screens.
ALTER TABLE "public"."versiones_vehiculos"
  ADD COLUMN "foto_url" VARCHAR(500);

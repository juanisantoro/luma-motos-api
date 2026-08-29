-- Temporary passwords replace activation tokens. Their plaintext exists only
-- in memory long enough to deliver the email; PostgreSQL stores Argon2 hashes.
ALTER TABLE "usuarios"
ADD COLUMN "contrasena_temporal_vence_en" TIMESTAMPTZ(6);

DROP TABLE "tokens_activacion_usuario";

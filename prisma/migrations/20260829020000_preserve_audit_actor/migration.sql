ALTER TABLE "registros_auditoria"
DROP CONSTRAINT "registros_auditoria_usuario_id_fkey";

ALTER TABLE "registros_auditoria"
ADD CONSTRAINT "registros_auditoria_usuario_id_fkey"
FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

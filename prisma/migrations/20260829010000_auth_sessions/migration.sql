-- CreateTable
CREATE TABLE "sesiones_autenticacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "ultima_actividad_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocada_en" TIMESTAMPTZ(6),
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sesiones_autenticacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sesiones_autenticacion_usuario_indice" ON "sesiones_autenticacion"("usuario_id");

-- CreateIndex
CREATE INDEX "sesiones_autenticacion_actividad_indice" ON "sesiones_autenticacion"("ultima_actividad_en");

-- CreateIndex
CREATE INDEX "sesiones_autenticacion_revocada_indice" ON "sesiones_autenticacion"("revocada_en");

-- AddForeignKey
ALTER TABLE "sesiones_autenticacion" ADD CONSTRAINT "sesiones_autenticacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

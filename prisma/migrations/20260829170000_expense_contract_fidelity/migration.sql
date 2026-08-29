ALTER TABLE "gastos"
  ADD COLUMN "recuperada" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "gastos"
  ADD CONSTRAINT "gastos_recuperada_valida" CHECK (
    NOT recuperada OR recuperable
  );

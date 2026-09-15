-- Adds the operation's paper ticket/receipt number ("número de boleto"),
-- captured at creation. Optional and free-form (branches issue their own
-- ticket books, not a single numbering scheme), so no uniqueness constraint.
ALTER TABLE "public"."operaciones" ADD COLUMN "numero_boleto" VARCHAR(40);

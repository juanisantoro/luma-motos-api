-- Nuevas plataformas de pago de la operación:
-- - TRANSFERENCIA y TARJETA: todo por transferencia o con tarjeta.
-- - TRANSFERENCIA_CREDITO: una parte por transferencia y otra con crédito.
-- - CREDITO_CREDITO: dos créditos de financieras distintas (p. ej. Santander
--   y Directo) que completan el precio; monto_credito es la suma de los dos.
-- ADD VALUE no se puede deshacer dentro de la misma migración: los valores
-- nuevos se usan recién desde la aplicación.
ALTER TYPE "public"."plataforma_pago_luma" ADD VALUE IF NOT EXISTS 'TRANSFERENCIA';
ALTER TYPE "public"."plataforma_pago_luma" ADD VALUE IF NOT EXISTS 'TARJETA';
ALTER TYPE "public"."plataforma_pago_luma" ADD VALUE IF NOT EXISTS 'TRANSFERENCIA_CREDITO';
ALTER TYPE "public"."plataforma_pago_luma" ADD VALUE IF NOT EXISTS 'CREDITO_CREDITO';

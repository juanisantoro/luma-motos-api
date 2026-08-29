UPDATE "gastos"
SET "recuperada" = true
WHERE upper(trim(coalesce("recuperable_original", ''))) IN (
  'SI',
  'SÍ',
  'TRUE',
  '1',
  'RECUPERADA'
);

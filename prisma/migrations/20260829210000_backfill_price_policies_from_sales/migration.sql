-- Restore actionable pricing only where the organization has real, positive
-- historical sale values. Catalog versions without evidence remain unpriced.
WITH historical_prices AS (
  SELECT
    o.organizacion_id,
    o.version_id,
    MAX(o.precio_acordado) AS precio_lista,
    MIN(o.precio_acordado) AS precio_minimo
  FROM public.operaciones o
  WHERE o.precio_acordado > 0
    AND o.estado_operacion IN ('APROBADA', 'CERRADA')
  GROUP BY o.organizacion_id, o.version_id
),
active_personnel AS (
  SELECT DISTINCT ON (p.organizacion_id)
    p.organizacion_id,
    p.id
  FROM public.personal p
  WHERE p.estado = 'ACTIVO'
  ORDER BY p.organizacion_id, p.creado_en, p.id
)
INSERT INTO public.politicas_precios_vehiculos (
  version_id,
  sucursal_id,
  moneda,
  precio_lista,
  precio_minimo,
  vigente_desde,
  vigente_hasta,
  creado_por_personal_id,
  organizacion_id
)
SELECT
  hp.version_id,
  NULL,
  'ARS',
  hp.precio_lista,
  hp.precio_minimo,
  CURRENT_DATE,
  NULL,
  ap.id,
  hp.organizacion_id
FROM historical_prices hp
JOIN active_personnel ap
  ON ap.organizacion_id = hp.organizacion_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.politicas_precios_vehiculos pp
  WHERE pp.organizacion_id = hp.organizacion_id
    AND pp.version_id = hp.version_id
    AND pp.sucursal_id IS NULL
    AND pp.vigente_desde <= CURRENT_DATE
    AND (pp.vigente_hasta IS NULL OR pp.vigente_hasta >= CURRENT_DATE)
);

// BCRA "APIs Públicas - Central de Deudores" - endpoint "Históricas".
// Public endpoint: no API key/token/header is documented or required.
export const BCRA_HISTORICAS_BASE_URL =
  'https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas/Historicas';

// The service must never hang a request/response cycle waiting on an
// external, unauthenticated government API. 9s leaves headroom under most
// client/proxy timeouts while still giving the BCRA API a fair chance to
// respond.
export const BCRA_REQUEST_TIMEOUT_MS = 9_000;

// BCRA situación codes (Central de Deudores manual). 0 shows up in real
// example payloads on rows where monto is 0 and is not documented in the
// manual - treated as "no debt/situation informed by that entity for that
// period", i.e. neutral, never the worst case.
export const BCRA_SITUACION = {
  SIN_INFORMAR: 0,
  NORMAL: 1,
  SEGUIMIENTO_ESPECIAL: 2,
  PROBLEMAS: 3,
  ALTO_RIESGO_INSOLVENCIA: 4,
  IRRECUPERABLE: 5,
} as const;

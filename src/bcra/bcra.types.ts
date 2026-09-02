// --- Raw shapes returned by the BCRA "Históricas" endpoint ---------------

export interface BcraEntidadHistorica {
  entidad: string;
  situacion: number;
  monto: number;
  enRevision: boolean;
  procesoJud: boolean;
}

export interface BcraPeriodoHistorico {
  periodo: string; // AAAAMM, most recent period first
  entidades: BcraEntidadHistorica[];
}

export interface BcraHistoricasResult {
  identificacion: number;
  denominacion: string;
  periodos: BcraPeriodoHistorico[];
}

export interface BcraHistoricasSuccessResponse {
  status: 200;
  results: BcraHistoricasResult;
}

export interface BcraHistoricasErrorResponse {
  status: number;
  errorMessages: string[];
}

export type BcraHistoricasResponse =
  | BcraHistoricasSuccessResponse
  | BcraHistoricasErrorResponse;

// --- Shapes this API returns to Luma Motos clients ------------------------

export type BcraVeredicto = 'VERDE' | 'AMARILLO' | 'ROJO' | 'SIN_DATOS';

/**
 * Always present for any actor with `creditos.consultar`. Deliberately does
 * NOT include a human-readable message - that copy lives in the frontend
 * (same convention as the rest of the credit-plans/credit-inquiries
 * modules), keyed off `veredicto` and the flags below.
 */
export interface BcraSituacionResumen {
  veredicto: BcraVeredicto;
  identificacion: string;
  denominacion: string | null;
  periodoMasReciente: string | null;
  peorSituacionActual: number | null;
  procesoJudActual: boolean;
  enRevisionActual: boolean;
  antecedenteSeveroReciente: boolean;
  /** Sum of `monto` (already converted to pesos, not thousands) across
   * entities reporting situación 3+ in the most recent period. */
  montoIrregularActual: number;
  /** Sum of `monto` (already converted to pesos, not thousands) across ALL
   * entities in the most recent period. */
  montoTotalActual: number;
  /** `montoIrregularActual / montoTotalActual`, or `null` when
   * `montoTotalActual` is 0 (nothing to divide by). */
  porcentajeIrregular: number | null;
  /** Highest `monto` (in pesos) found at situación 3+ in any entity/period
   * within the last 24 months. Only set when `antecedenteSeveroReciente`
   * is true. */
  mayorMontoIrregularHistorico?: number;
  /** AAAAMM period `mayorMontoIrregularHistorico` was reported in. */
  periodoMayorMontoIrregular?: string;
  consultadoEn: string;
}

/** Only built and returned for actors holding `creditos.bcra.detalle`. */
export interface BcraSituacionDetalle {
  periodos: BcraPeriodoHistorico[];
}

export interface BcraSituacionResponse {
  resumen: BcraSituacionResumen;
  detalle?: BcraSituacionDetalle;
}

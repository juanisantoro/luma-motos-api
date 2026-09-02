import { BCRA_SITUACION } from './bcra.constants';
import type {
  BcraPeriodoHistorico,
  BcraSituacionResumen,
  BcraVeredicto,
} from './bcra.types';

/**
 * Pure "traffic light" heuristic over a BCRA "Históricas" payload. This is
 * an aid to a human decision, not an automatic approve/reject of the
 * credit - the credit-plans flow still requires a person to decide.
 *
 * Thresholds (as agreed with the product owner):
 *  - SIN_DATOS: no `periodos` at all (covers both a BCRA 404 - the person
 *    has no financial-system history - and an empty `periodos` array).
 *  - ROJO: the worst `situacion` reported in the MOST RECENT period is 3,
 *    4 or 5 (ignoring situación 0, which is not a real "bad" situation),
 *    OR any entity in that period reports `procesoJud: true` - a live
 *    judicial process outranks a low situación code.
 *  - AMARILLO: the worst situación in the most recent period is 2, OR the
 *    current period looks clean (0/1) but some period within the last 24
 *    months (the full history BCRA returns) reported situación 3+ - i.e.
 *    the person is normalized now but recently had trouble, and that
 *    context should not be hidden from whoever is evaluating the credit.
 *  - VERDE: worst situación now is 0 or 1, no procesoJud now, and no
 *    situación 3+ anywhere in the last 24 months.
 *
 * The veredicto/thresholds above are intentionally amount-agnostic (worst
 * situación wins, regardless of monto) - that is the standard criterion
 * used by banks/fintechs and is not changed here. `montoIrregularActual`,
 * `montoTotalActual` and `porcentajeIrregular` are computed alongside it so
 * whoever is evaluating the credit can see how much of the reported debt
 * is actually in trouble, instead of taking the color at face value.
 */
export function computeBcraResumen(
  periodos: BcraPeriodoHistorico[] | undefined,
  identificacion: string,
  denominacion: string | null,
  consultadoEn: string,
): BcraSituacionResumen {
  if (!periodos || periodos.length === 0) {
    return {
      veredicto: 'SIN_DATOS',
      identificacion,
      denominacion,
      periodoMasReciente: null,
      peorSituacionActual: null,
      procesoJudActual: false,
      enRevisionActual: false,
      antecedenteSeveroReciente: false,
      montoIrregularActual: 0,
      montoTotalActual: 0,
      porcentajeIrregular: null,
      consultadoEn,
    };
  }

  // BCRA reports `monto` in thousands of pesos; every monto below is
  // converted to real pesos up front, same as the frontend does for the
  // detalle table (see `formatMontoMiles` in the UI).
  const PESOS_POR_MIL = 1000;

  // BCRA documents `periodos` as coming back most-recent-first.
  const periodoActual = periodos[0]!;
  const entidadesActuales = periodoActual.entidades ?? [];

  const situacionesRelevantes = entidadesActuales
    .map((entidad) => entidad.situacion)
    .filter((situacion) => situacion !== BCRA_SITUACION.SIN_INFORMAR);
  const peorSituacionActual =
    situacionesRelevantes.length > 0 ? Math.max(...situacionesRelevantes) : 0;

  const procesoJudActual = entidadesActuales.some(
    (entidad) => entidad.procesoJud === true,
  );
  const enRevisionActual = entidadesActuales.some(
    (entidad) => entidad.enRevision === true,
  );

  const montoIrregularActual = entidadesActuales
    .filter((entidad) => entidad.situacion >= BCRA_SITUACION.PROBLEMAS)
    .reduce((sum, entidad) => sum + entidad.monto * PESOS_POR_MIL, 0);
  const montoTotalActual = entidadesActuales.reduce(
    (sum, entidad) => sum + entidad.monto * PESOS_POR_MIL,
    0,
  );
  const porcentajeIrregular =
    montoTotalActual > 0 ? montoIrregularActual / montoTotalActual : null;

  // Walk every period/entity once to get both the existing "had trouble in
  // the last 24 months" flag and (nice-to-have) the worst historical monto
  // behind it, without a second pass over the same data.
  let antecedenteSeveroReciente = false;
  let mayorMontoIrregularHistorico: number | undefined;
  let periodoMayorMontoIrregular: string | undefined;
  for (const periodo of periodos) {
    for (const entidad of periodo.entidades ?? []) {
      if (entidad.situacion < BCRA_SITUACION.PROBLEMAS) continue;
      antecedenteSeveroReciente = true;
      const montoPesos = entidad.monto * PESOS_POR_MIL;
      if (
        mayorMontoIrregularHistorico === undefined ||
        montoPesos > mayorMontoIrregularHistorico
      ) {
        mayorMontoIrregularHistorico = montoPesos;
        periodoMayorMontoIrregular = periodo.periodo;
      }
    }
  }

  let veredicto: BcraVeredicto;
  if (
    peorSituacionActual >= BCRA_SITUACION.PROBLEMAS ||
    procesoJudActual
  ) {
    veredicto = 'ROJO';
  } else if (
    peorSituacionActual === BCRA_SITUACION.SEGUIMIENTO_ESPECIAL ||
    antecedenteSeveroReciente
  ) {
    veredicto = 'AMARILLO';
  } else {
    veredicto = 'VERDE';
  }

  return {
    veredicto,
    identificacion,
    denominacion,
    periodoMasReciente: periodoActual.periodo,
    peorSituacionActual,
    procesoJudActual,
    enRevisionActual,
    antecedenteSeveroReciente,
    montoIrregularActual,
    montoTotalActual,
    porcentajeIrregular,
    ...(mayorMontoIrregularHistorico !== undefined
      ? { mayorMontoIrregularHistorico, periodoMayorMontoIrregular }
      : {}),
    consultadoEn,
  };
}

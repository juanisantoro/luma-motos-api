import { computeBcraResumen } from './bcra-situacion';
import type { BcraPeriodoHistorico } from './bcra.types';

function periodo(
  periodo: string,
  entidades: Array<{
    situacion: number;
    monto?: number;
    procesoJud?: boolean;
    enRevision?: boolean;
  }>,
): BcraPeriodoHistorico {
  return {
    periodo,
    entidades: entidades.map((entidad, index) => ({
      entidad: `Entidad ${index}`,
      situacion: entidad.situacion,
      monto: entidad.monto ?? 0,
      enRevision: entidad.enRevision ?? false,
      procesoJud: entidad.procesoJud ?? false,
    })),
  };
}

const NOW = '2026-09-01T12:00:00.000Z';

describe('computeBcraResumen', () => {
  it('returns SIN_DATOS when there are no periods at all', () => {
    const resumen = computeBcraResumen(undefined, '20380974410', null, NOW);
    expect(resumen.veredicto).toBe('SIN_DATOS');
    expect(resumen.peorSituacionActual).toBeNull();
    expect(resumen.periodoMasReciente).toBeNull();
    expect(resumen.montoIrregularActual).toBe(0);
    expect(resumen.montoTotalActual).toBe(0);
    expect(resumen.porcentajeIrregular).toBeNull();
    expect(resumen.mayorMontoIrregularHistorico).toBeUndefined();
  });

  it('returns SIN_DATOS for an empty periods array', () => {
    const resumen = computeBcraResumen([], '20380974410', null, NOW);
    expect(resumen.veredicto).toBe('SIN_DATOS');
  });

  it('returns VERDE when the current period is clean and there is no recent history of trouble', () => {
    const periodos = [
      periodo('202608', [{ situacion: 1 }, { situacion: 0 }]),
      periodo('202607', [{ situacion: 1 }]),
    ];
    const resumen = computeBcraResumen(
      periodos,
      '20380974410',
      'SANTORO JUAN IGNACIO',
      NOW,
    );
    expect(resumen.veredicto).toBe('VERDE');
    expect(resumen.peorSituacionActual).toBe(1);
    expect(resumen.antecedenteSeveroReciente).toBe(false);
    expect(resumen.procesoJudActual).toBe(false);
  });

  it('treats situación 0 rows as neutral, not as the worst case', () => {
    const periodos = [periodo('202608', [{ situacion: 0 }, { situacion: 0 }])];
    const resumen = computeBcraResumen(periodos, '20380974410', null, NOW);
    expect(resumen.veredicto).toBe('VERDE');
    expect(resumen.peorSituacionActual).toBe(0);
  });

  it('returns AMARILLO when the current worst situación is 2 (seguimiento especial)', () => {
    const periodos = [periodo('202608', [{ situacion: 2 }, { situacion: 1 }])];
    const resumen = computeBcraResumen(periodos, '20380974410', null, NOW);
    expect(resumen.veredicto).toBe('AMARILLO');
    expect(resumen.peorSituacionActual).toBe(2);
  });

  it('returns AMARILLO when the current period is clean but situación 3+ appears earlier in the 24-month window', () => {
    const periodos = [
      periodo('202608', [{ situacion: 1, monto: 2000 }]),
      periodo('202607', [{ situacion: 1, monto: 2000 }]),
      periodo('202412', [{ situacion: 3, monto: 450 }]),
    ];
    const resumen = computeBcraResumen(periodos, '20380974410', null, NOW);
    expect(resumen.veredicto).toBe('AMARILLO');
    expect(resumen.peorSituacionActual).toBe(1);
    expect(resumen.antecedenteSeveroReciente).toBe(true);
    // Current period is clean: nothing irregular to weigh right now...
    expect(resumen.montoIrregularActual).toBe(0);
    expect(resumen.montoTotalActual).toBe(2_000_000);
    expect(resumen.porcentajeIrregular).toBe(0);
    // ...but the historical worst case (24-month window) is still surfaced.
    expect(resumen.mayorMontoIrregularHistorico).toBe(450_000);
    expect(resumen.periodoMayorMontoIrregular).toBe('202412');
  });

  it('real case: a low-amount situación 4 at one bank against much larger normal debt elsewhere still gives ROJO, with a low montoIrregularActual/porcentajeIrregular for a human to weigh', () => {
    // Same shape as the case the user reported: one entity at $83.000 in
    // situación 4 (worsening for 4 straight months, 3 -> 3 -> 3 -> 4 -> 4),
    // while the rest of the entities report $3-10M at situación 1 normal.
    const periodos = [
      periodo('202607', [
        { situacion: 4, monto: 83 }, // $83.000
        { situacion: 1, monto: 3000 }, // $3.000.000
        { situacion: 1, monto: 4417 }, // $4.417.000
      ]),
      periodo('202606', [{ situacion: 4, monto: 80 }]),
      periodo('202605', [{ situacion: 3, monto: 75 }]),
      periodo('202604', [{ situacion: 3, monto: 70 }]),
      periodo('202603', [{ situacion: 3, monto: 65 }]),
    ];
    const resumen = computeBcraResumen(periodos, '20380974410', null, NOW);

    // The veredicto/threshold logic does NOT change: worst situación in the
    // most recent period still wins, regardless of how small its monto is
    // relative to the rest.
    expect(resumen.veredicto).toBe('ROJO');
    expect(resumen.peorSituacionActual).toBe(4);

    // But the new fields let a human see just how small that share is.
    expect(resumen.montoIrregularActual).toBe(83_000);
    expect(resumen.montoTotalActual).toBe(7_500_000);
    expect(resumen.porcentajeIrregular).toBeCloseTo(83_000 / 7_500_000, 6);
    expect(resumen.porcentajeIrregular).toBeLessThan(0.02);
    expect(resumen.mayorMontoIrregularHistorico).toBe(83_000);
    expect(resumen.periodoMayorMontoIrregular).toBe('202607');
  });

  it('returns ROJO when the current worst situación is 3, 4 or 5', () => {
    const periodos = [periodo('202608', [{ situacion: 4 }, { situacion: 1 }])];
    const resumen = computeBcraResumen(periodos, '20380974410', null, NOW);
    expect(resumen.veredicto).toBe('ROJO');
    expect(resumen.peorSituacionActual).toBe(4);
  });

  it('returns ROJO on an active procesoJud even if situación itself is low', () => {
    const periodos = [
      periodo('202608', [{ situacion: 1, procesoJud: true }]),
    ];
    const resumen = computeBcraResumen(periodos, '20380974410', null, NOW);
    expect(resumen.veredicto).toBe('ROJO');
    expect(resumen.procesoJudActual).toBe(true);
    expect(resumen.peorSituacionActual).toBe(1);
  });

  it('surfaces enRevision from the current period without affecting the veredicto', () => {
    const periodos = [
      periodo('202608', [{ situacion: 1, enRevision: true }]),
    ];
    const resumen = computeBcraResumen(periodos, '20380974410', null, NOW);
    expect(resumen.veredicto).toBe('VERDE');
    expect(resumen.enRevisionActual).toBe(true);
  });
});

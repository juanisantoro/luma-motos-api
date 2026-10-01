// Feriados nacionales de Argentina (inamovibles y trasladables, en la fecha
// en que efectivamente se gozan). Se usan para calcular la ventana estimada
// de llegada de la patente en días hábiles.
//
// Es una tabla versionada en código, a propósito: cambia una vez por año y
// no necesita edición desde la aplicación. Cada año hay que agregar el
// calendario oficial (https://www.argentina.gob.ar/interior/feriados) cuando
// se publica el decreto de feriados trasladables.
//
// No incluye los "días no laborables con fines turísticos": son optativos
// para el sector privado. Tampoco feriados provinciales o locales.
//
// Un año que todavía no está cargado se calcula sólo con lunes a viernes; el
// test "cubre el año en curso" avisa cuando falta el año siguiente.

export const AR_NATIONAL_HOLIDAYS: Readonly<Record<number, readonly string[]>> =
  {
    2026: [
      '2026-01-01', // Año Nuevo
      '2026-02-16', // Carnaval
      '2026-02-17', // Carnaval
      '2026-03-24', // Día Nacional de la Memoria por la Verdad y la Justicia
      '2026-04-02', // Veteranos y Caídos en la Guerra de Malvinas
      '2026-04-03', // Viernes Santo
      '2026-05-01', // Día del Trabajador
      '2026-05-25', // Revolución de Mayo
      '2026-06-15', // Paso a la Inmortalidad de Güemes (trasladado del 17/6)
      '2026-06-20', // Paso a la Inmortalidad de Belgrano
      '2026-07-09', // Día de la Independencia
      '2026-08-17', // Paso a la Inmortalidad de San Martín
      '2026-10-12', // Día del Respeto a la Diversidad Cultural
      '2026-11-23', // Día de la Soberanía Nacional (trasladado del 20/11)
      '2026-12-08', // Inmaculada Concepción de María
      '2026-12-25', // Navidad
    ],
    // 2027: sólo inamovibles. Agregar los trasladables (Güemes, San Martín,
    // Diversidad Cultural, Soberanía) cuando se publique el decreto.
    2027: [
      '2027-01-01', // Año Nuevo
      '2027-02-08', // Carnaval
      '2027-02-09', // Carnaval
      '2027-03-24', // Día Nacional de la Memoria por la Verdad y la Justicia
      '2027-03-26', // Viernes Santo
      '2027-04-02', // Veteranos y Caídos en la Guerra de Malvinas
      '2027-05-01', // Día del Trabajador
      '2027-05-25', // Revolución de Mayo
      '2027-06-20', // Paso a la Inmortalidad de Belgrano
      '2027-07-09', // Día de la Independencia
      '2027-12-08', // Inmaculada Concepción de María
      '2027-12-25', // Navidad
    ],
  };

const HOLIDAY_SET: ReadonlySet<string> = new Set(
  Object.values(AR_NATIONAL_HOLIDAYS).flat(),
);

export function isNationalHoliday(date: Date): boolean {
  return HOLIDAY_SET.has(date.toISOString().slice(0, 10));
}

// Hábil = lunes a viernes que no es feriado nacional.
export function isBusinessDay(date: Date): boolean {
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isNationalHoliday(date);
}

// Años con calendario cargado: el front los recibe para previsualizar la
// misma ventana que calcula la API.
export function nationalHolidayDates(): string[] {
  return [...HOLIDAY_SET].sort();
}

import {
  WorkCalendar,
  cutProblem,
  periodOfRange,
  shiftPeriod,
} from './work-months.calendar';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

describe('WorkCalendar', () => {
  it('uses calendar months when there are no cuts', () => {
    const calendar = new WorkCalendar();
    const range = calendar.range('2026-10');

    expect([iso(range.from), iso(range.to)]).toEqual([
      '2026-10-01',
      '2026-10-31',
    ]);
    expect(calendar.periodOf(day('2026-10-31'))).toBe('2026-10');
    expect(calendar.periodOf(day('2026-11-01'))).toBe('2026-11');
  });

  it('starts each month the day after the previous cut', () => {
    const calendar = new WorkCalendar(
      new Map([
        ['2026-09', day('2026-09-27')],
        ['2026-10', day('2026-10-27')],
      ]),
    );

    expect(iso(calendar.range('2026-10').from)).toBe('2026-09-28');
    expect(iso(calendar.range('2026-10').to)).toBe('2026-10-27');
    // Noviembre no tiene corte: arranca después del de octubre y termina
    // con el almanaque.
    expect(iso(calendar.range('2026-11').from)).toBe('2026-10-28');
    expect(iso(calendar.range('2026-11').to)).toBe('2026-11-30');
    expect(calendar.periodOf(day('2026-09-28'))).toBe('2026-10');
    expect(calendar.periodOf(day('2026-10-28'))).toBe('2026-11');
    expect(calendar.periodOf(day('2026-10-27'))).toBe('2026-10');
  });

  it('lets a month run into the next calendar month', () => {
    const calendar = new WorkCalendar(
      new Map([['2026-10', day('2026-11-03')]]),
    );

    expect(iso(calendar.range('2026-10').to)).toBe('2026-11-03');
    expect(iso(calendar.range('2026-11').from)).toBe('2026-11-04');
    expect(calendar.periodOf(day('2026-11-02'))).toBe('2026-10');
  });

  it('crosses the year boundary', () => {
    const calendar = new WorkCalendar(
      new Map([['2026-12', day('2026-12-26')]]),
    );

    expect(iso(calendar.range('2027-01').from)).toBe('2026-12-27');
    expect(calendar.periodOf(day('2026-12-30'))).toBe('2027-01');
    expect(shiftPeriod('2027-01', -1)).toBe('2026-12');
  });

  it('knows the current month by the Argentina date', () => {
    const calendar = new WorkCalendar(
      new Map([['2026-10', day('2026-10-27')]]),
    );

    // 27/10 a las 23:30 en Argentina ya es 28/10 en UTC.
    expect(calendar.current(new Date('2026-10-28T02:30:00.000Z'))).toBe(
      '2026-10',
    );
    expect(calendar.current(new Date('2026-10-28T03:30:00.000Z'))).toBe(
      '2026-11',
    );
  });

  it('only accepts cuts between the 15th and the 14th of the next month', () => {
    expect(cutProblem('2026-10', day('2026-10-15'))).toBeNull();
    expect(cutProblem('2026-10', day('2026-11-14'))).toBeNull();
    expect(cutProblem('2026-10', day('2026-10-14'))).toMatch(/15\/10\/2026/);
    expect(cutProblem('2026-10', day('2026-11-15'))).toMatch(/14\/11\/2026/);
  });

  it('tells which month a stored range belongs to', () => {
    expect(periodOfRange(day('2026-10-31'))).toBe('2026-10');
    expect(periodOfRange(day('2026-10-15'))).toBe('2026-10');
    expect(periodOfRange(day('2026-11-14'))).toBe('2026-10');
    expect(periodOfRange(day('2026-02-28'))).toBe('2026-02');
  });
});

import {
  findSections,
  manualIndex,
  parseManual,
  selectSections,
  stems,
} from './assistant.manual-sections';

const manual = parseManual({
  profile: 'Gerente',
  text: [
    'LMLUMA MOTOS',
    '',
    '# Manual del Gerente',
    'Todo lo que podés hacer.',
    '',
    '### Cómo usar este manual',
    'Cada capítulo es una parte del menú.',
    '',
    '## Ventas',
    'Las pantallas de ventas.',
    '',
    '### Aprobaciones',
    'Las ventas por debajo de lista esperan tu decisión.',
    '#### Aprobar o rechazar',
    '- Tocá Aprobar.',
    '',
    '### Patentamiento',
    'Cargá la patente cuando llega.',
    '',
    '## Comisiones',
    '',
    '### Pagar',
    'Elegí al vendedor y registrá el pago de la comisión.',
  ].join('\n'),
});

describe('manual sections', () => {
  it('splits a manual by chapters and screens, keeping sub-steps inside', () => {
    expect(manual.title).toBe('Manual del Gerente');
    expect(
      manual.sections.map((section) => [section.chapter, section.title]),
    ).toEqual([
      [null, 'Manual del Gerente'],
      [null, 'Cómo usar este manual'],
      [null, 'Ventas'],
      ['Ventas', 'Aprobaciones'],
      ['Ventas', 'Patentamiento'],
      [null, 'Comisiones'],
      ['Comisiones', 'Pagar'],
    ]);
    const approvals = manual.sections[3];
    expect(approvals.manual).toBe('Manual del Gerente');
    expect(approvals.text).toContain('#### Aprobar o rechazar');
    // The logo before the first heading is not content.
    expect(
      manual.sections.some((section) => section.text.includes('LMLUMA')),
    ).toBe(false);
  });

  it('lists every chapter and screen in the index', () => {
    expect(manualIndex(manual)).toBe(
      [
        '- Cómo usar este manual',
        '- Ventas: Aprobaciones · Patentamiento',
        '- Comisiones: Pagar',
      ].join('\n'),
    );
  });

  it('matches different forms of the same word', () => {
    expect(stems('pago pagar pagos')).toEqual(['pag', 'pag', 'pag']);
    expect(stems('apruebo aprobar')).toEqual(['apro', 'apro']);
    expect(stems('¿Cómo creo una comisión?')).toEqual(['cre', 'comi']);
  });

  it('picks the sections about the question, best first', () => {
    const titles = (question: string) =>
      selectSections(manual.sections, [{ text: question, weight: 1 }]).map(
        (section) => section.title,
      );

    expect(titles('¿Cómo apruebo una venta?')[0]).toBe('Aprobaciones');
    expect(titles('¿Cómo pago una comisión?')[0]).toBe('Pagar');
    expect(titles('donde cargo la patente')).toEqual(['Patentamiento']);
    expect(titles('carrizo alejandro')).toEqual([]);
    expect(titles('hola')).toEqual([]);
  });

  it('respects the section and size limits, but always keeps the best one', () => {
    const question = [{ text: 'ventas patente comisión', weight: 1 }];

    expect(
      selectSections(manual.sections, question, { sections: 2, chars: 9_000 }),
    ).toHaveLength(2);
    expect(
      selectSections(manual.sections, question, { sections: 5, chars: 1 }),
    ).toHaveLength(1);
  });

  it('keeps one section when several manuals document the same screen', () => {
    const seller = parseManual({
      profile: 'Vendedor',
      text: '# Manual del Vendedor\n\n### Patentamiento\nMirá el estado de la patente de tu venta.',
    });

    const selected = selectSections(
      [...manual.sections, ...seller.sections],
      [{ text: 'patente', weight: 1 }],
    );

    expect(
      selected.filter((section) => section.title === 'Patentamiento'),
    ).toHaveLength(1);
  });

  it('finds sections by the title in the index, or the closest one', () => {
    const titles = (wanted: string[]) =>
      findSections(manual.sections, wanted).map((section) => section.title);

    expect(titles(['patentamiento'])).toEqual(['Patentamiento']);
    expect(titles(['Pagar comisiones'])).toEqual(['Pagar']);
    expect(titles(['zzz'])).toEqual([]);
    expect(titles(['Pagar', 'Aprobaciones', 'Ventas', 'Comisiones'])).toEqual([
      'Pagar',
      'Aprobaciones',
      'Ventas',
    ]);
  });
});

// Recorte del manual por pregunta.
//
// Mandar el manual entero en cada llamada era casi todo el gasto de tokens de
// Lumi (el Administrador recibía los de todos los perfiles). Acá el manual se
// parte por títulos y, para cada pregunta, se eligen las pocas secciones que
// tienen que ver. El modelo recibe además el índice completo y puede pedir
// cualquier otra sección por su título (ver leer_manual en el servicio).
//
// La elección es por coincidencia de palabras, sin llamadas extra a OpenAI:
// es determinística, así que la misma pregunta arma siempre el mismo prompt.

export interface ManualBook {
  profile: string;
  text: string;
}

export interface ManualSection {
  profile: string;
  // Título del manual ("Manual del Gerente").
  manual: string;
  // Capítulo al que pertenece, si la sección es una pantalla o tarea.
  chapter: string | null;
  title: string;
  // Título y cuerpo, tal como están en el manual.
  text: string;
}

export interface ParsedManual {
  profile: string;
  title: string;
  sections: ManualSection[];
}

export interface SectionQuery {
  text: string;
  // 1 para la pregunta; menos para el contexto de la conversación.
  weight: number;
}

// Hasta cuántas secciones y cuánto texto se incluyen por pregunta.
export const MAX_SELECTED_SECTIONS = 5;
export const MAX_SELECTED_CHARS = 9_000;
// Una sección entra sólo si puntúa al menos esta fracción de la mejor.
const MIN_RELATIVE_SCORE = 0.3;

const HEADING = /^(#{1,3}) (.+)$/;

const STOPWORDS = new Set(
  (
    'a al algo algun alguna ante aca ahi asi aun bien cada como con cual ' +
    'cuales cuando de del desde donde dos el ella ellos en entre era es esa ' +
    'ese eso esta estan estas este esto estos estoy fue ha hace hacer hago ' +
    'hay hola la las le les lo los mas me mi mis muy necesito no nos o otra ' +
    'otro para pero por porque puede pueden puedo que quien quiero se sea ' +
    'ser si sin sobre son soy su sus tambien te tengo tiene tienen todo ' +
    'todos tu un una uno unos usted va veo ver ves vos voy ya yo'
  ).split(' '),
);

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Raíz aproximada de una palabra, para que "pago", "pagar" y "pagos", o
// "apruebo" y "aprobar", cuenten como la misma. No es un stemmer completo:
// alcanza con que pregunta y manual se reduzcan igual.
function stem(word: string): string {
  let root = word.replace(/ue/g, 'o').replace(/ie/g, 'e');
  if (root.length > 4 && root.endsWith('s')) root = root.slice(0, -1);
  if (root.length > 4 && /[aei]r$/.test(root)) root = root.slice(0, -1);
  while (root.length > 3 && /[aeiou]$/.test(root)) root = root.slice(0, -1);
  return root.slice(0, 4);
}

export function stems(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
    .map(stem);
}

export function parseManual(book: ManualBook): ParsedManual {
  const sections: ManualSection[] = [];
  let title = `Manual del perfil ${book.profile}`;
  let chapter: string | null = null;
  let current: {
    title: string;
    chapter: string | null;
    lines: string[];
  } | null = null;
  const close = () => {
    if (!current) return;
    sections.push({
      profile: book.profile,
      manual: title,
      chapter: current.chapter,
      title: current.title,
      text: current.lines.join('\n').trim(),
    });
  };
  for (const line of book.text.split('\n')) {
    const heading = HEADING.exec(line);
    if (!heading) {
      // Lo que está antes del primer título (el logo) no es contenido.
      current?.lines.push(line);
      continue;
    }
    close();
    const level = heading[1].length;
    const name = heading[2].trim();
    if (level === 1) title = name;
    if (level <= 2) chapter = level === 2 ? name : null;
    current = {
      title: name,
      chapter: level === 3 ? chapter : null,
      lines: [line],
    };
  }
  close();
  // The manual title is known only after its heading: fix earlier sections.
  for (const section of sections) section.manual = title;
  return { profile: book.profile, title, sections };
}

// Índice de un manual: sus capítulos y, dentro de cada uno, sus secciones.
export function manualIndex(manual: ParsedManual): string {
  const lines: string[] = [];
  const loose: string[] = [];
  let open: { chapter: string; titles: string[] } | null = null;
  const close = () => {
    if (!open) return;
    lines.push(
      open.titles.length
        ? `- ${open.chapter}: ${open.titles.join(' · ')}`
        : `- ${open.chapter}`,
    );
    open = null;
  };
  for (const section of manual.sections) {
    if (section.title === manual.title) continue;
    if (section.chapter === null && section.text.startsWith('## ')) {
      close();
      open = { chapter: section.title, titles: [] };
    } else if (open && section.chapter === open.chapter) {
      open.titles.push(section.title);
    } else {
      loose.push(section.title);
    }
  }
  close();
  return [...(loose.length ? [`- ${loose.join(' · ')}`] : []), ...lines].join(
    '\n',
  );
}

export function sectionLabel(section: ManualSection): string {
  return `[${[section.manual, section.chapter].filter(Boolean).join(' › ')}]`;
}

interface Scored {
  section: ManualSection;
  score: number;
}

function score(sections: ManualSection[], queries: SectionQuery[]): Scored[] {
  const documents = sections.map((section) => {
    const title = new Set(stems(section.title));
    const chapter = new Set(stems(section.chapter ?? ''));
    const body = new Map<string, number>();
    for (const stem of stems(section.text))
      body.set(stem, (body.get(stem) ?? 0) + 1);
    return { section, title, chapter, body };
  });
  const frequency = new Map<string, number>();
  for (const document of documents)
    for (const stem of document.body.keys())
      frequency.set(stem, (frequency.get(stem) ?? 0) + 1);

  const terms = new Map<string, number>();
  for (const query of queries)
    for (const stem of stems(query.text))
      terms.set(stem, Math.max(terms.get(stem) ?? 0, query.weight));

  return documents.map((document) => {
    let total = 0;
    for (const [stem, weight] of terms) {
      const count = document.body.get(stem);
      if (!count) continue;
      // Rare words tell sections apart; words in every section do not.
      const rarity = Math.log(1 + documents.length / frequency.get(stem)!);
      const where =
        (document.title.has(stem) ? 3 : 0) +
        (document.chapter.has(stem) ? 1 : 0) +
        count / (count + 1.5);
      total += weight * rarity * where;
    }
    return { section: document.section, score: total };
  });
}

// Las secciones que mejor coinciden con la pregunta, de mayor a menor. Si
// varias tienen el mismo título (la misma pantalla en manuales de distintos
// perfiles), queda sólo la que mejor coincide.
export function selectSections(
  sections: ManualSection[],
  queries: SectionQuery[],
  limits = { sections: MAX_SELECTED_SECTIONS, chars: MAX_SELECTED_CHARS },
): ManualSection[] {
  const ranked = score(sections, queries)
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.section.text.length - a.section.text.length,
    );
  if (!ranked.length) return [];
  const floor = ranked[0].score * MIN_RELATIVE_SCORE;
  const selected: ManualSection[] = [];
  const titles = new Set<string>();
  let chars = 0;
  for (const { section, score: value } of ranked) {
    if (value < floor || selected.length >= limits.sections) break;
    const key = normalize(section.title);
    if (titles.has(key)) continue;
    // The best match always goes in, whatever its length.
    if (selected.length && chars + section.text.length > limits.chars) continue;
    titles.add(key);
    selected.push(section);
    chars += section.text.length;
  }
  return selected;
}

// Secciones pedidas por título (como figuran en el índice). Un título que no
// existe tal cual se resuelve a la sección que mejor coincide.
export function findSections(
  sections: ManualSection[],
  titles: string[],
  max = 3,
): ManualSection[] {
  const found: ManualSection[] = [];
  for (const title of titles) {
    const wanted = normalize(title).trim();
    if (!wanted) continue;
    const exact = sections.filter(
      (section) => normalize(section.title).trim() === wanted,
    );
    const match = exact.length
      ? // Same screen in several manuals: the most complete version.
        [...exact].sort((a, b) => b.text.length - a.text.length)[0]
      : selectSections(sections, [{ text: title, weight: 1 }], {
          sections: 1,
          chars: Number.MAX_SAFE_INTEGER,
        })[0];
    if (match && !found.includes(match)) found.push(match);
    if (found.length >= max) break;
  }
  return found;
}

export function renderSections(sections: ManualSection[]): string {
  return sections
    .map((section) => `${sectionLabel(section)}\n${section.text}`)
    .join('\n\n');
}

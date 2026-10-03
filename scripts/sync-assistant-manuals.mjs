#!/usr/bin/env node
// Regenera los manuales en texto plano que usa el asistente (src/assistant)
// a partir de los manuales HTML del frontend, que son la fuente de verdad.
//
//   node scripts/sync-assistant-manuals.mjs <ruta a luma-motos-ui>/src/features/manual/content
//
// Por cada <rol>.html escribe src/assistant/manuals/<rol>.manual.ts. Correlo
// cada vez que cambie un manual; un rol nuevo además se registra a mano en
// src/assistant/assistant.manuals.ts.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function manualHtmlToText(html) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h1[^>]*>/gi, '\n\n# ')
    .replace(/<h2[^>]*>/gi, '\n\n## ')
    .replace(/<h3[^>]*>/gi, '\n\n### ')
    .replace(/<h4[^>]*>/gi, '\n\n#### ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<(br|\/tr|\/p|\/h[1-4]|\/div|\/figcaption|\/section|\/table)[^>]*>/gi, '\n')
    .replace(/<(p|tr|div|section|figure|figcaption|table|header|footer)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').replace(/( \|)+ ?$/, '').trim())
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function main() {
  const sourceDir = process.argv[2];
  if (!sourceDir) {
    console.error('Uso: node scripts/sync-assistant-manuals.mjs <carpeta con los .html>');
    process.exit(1);
  }
  const targetDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../src/assistant/manuals',
  );
  mkdirSync(targetDir, { recursive: true });
  for (const file of readdirSync(sourceDir).filter((name) => name.endsWith('.html'))) {
    const role = basename(file, '.html');
    const text = manualHtmlToText(readFileSync(join(sourceDir, file), 'utf8'));
    const constant = `${role.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_MANUAL`;
    writeFileSync(
      join(targetDir, `${role}.manual.ts`),
      `// GENERADO por scripts/sync-assistant-manuals.mjs desde ${file} del frontend.\n` +
        `// No editar a mano: corregí el HTML y volvé a generar.\n` +
        `export const ${constant} = ${JSON.stringify(text)};\n`,
    );
    console.log(`${file} -> ${role}.manual.ts (${text.length} caracteres)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

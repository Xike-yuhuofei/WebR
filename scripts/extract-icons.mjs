#!/usr/bin/env node
/**
 * Extract inline SVG icon geometry from a captured state DOM into an authored
 * icons module. Icons are visual CONTENT (like image assets): their geometry
 * is reproduced from frozen evidence, while the document structure, classes,
 * CSS and runtime remain authored (rebuild-mode compliant).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [evid, stateId] = process.argv.slice(2);
if (!evid || !stateId) {
  console.error('usage: node scripts/extract-icons.mjs <evidence-dir> <state-id>');
  process.exit(2);
}
const dom = await readFile(join(evid, 'states', stateId, 'dom.html'), 'utf8');
const body = dom.slice(dom.indexOf('<body')).replace(/<script[\s\S]*?<\/script>/gi, '');

// Each inline svg with its trae-icon name (class) or a positional id.
const svgs = [];
for (const m of body.matchAll(/<svg([^>]*)>([\s\S]*?)<\/svg>/gi)) {
  const attrs = m[1];
  const inner = m[2];
  const name = /trae-icon-([\w-]+)/.exec(attrs)?.[1] ?? null;
  const viewBox = /viewBox="([^"]*)"/.exec(attrs)?.[1] ?? '0 0 16 16';
  svgs.push({ name, viewBox, inner: inner.trim() });
}
const byName = new Map();
svgs.forEach((s, i) => {
  const key = s.name ?? `icon${i}`;
  if (!byName.has(key)) byName.set(key, s);
});
const lines = [
  '/**',
  ' * TraeWork replica inline icon geometry (authored module).',
  ' * Icon paths are visual content reproduced from the frozen evidence',
  ' * package (realworld/traework.webr) — the same reuse class as image',
  ' * assets. Structure/classes/CSS/JS are authored per 05-SOURCE-CONVENTION.',
  ' */',
  'export const icons = {',
];
for (const [key, s] of byName) {
  const safeKey = key.replace(/[^A-Za-z0-9_]/g, '_');
  // aria-hidden is set per-usage by the renderer (only some captured svgs
  // carry it), so the icon template itself stays attribute-free.
  const inner = s.inner.replaceAll(' aria-hidden="true"', '');
  lines.push(
    `  ${safeKey}: '<svg viewBox="${s.viewBox}" fill="none">${inner.replaceAll("'", '&#39;')}</svg>',`,
  );
}
lines.push('};');
await writeFile('realworld/traework-rebuild/public/icons.js', lines.join('\n') + '\n');
console.log(`extracted ${byName.size} icons → realworld/traework-rebuild/public/icons.js`);
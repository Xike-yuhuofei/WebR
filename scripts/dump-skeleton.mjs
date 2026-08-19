#!/usr/bin/env node
/** Dump a state's captured DOM as an annotated skeleton for replica authoring. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [evid, stateId] = process.argv.slice(2);
if (!evid || !stateId) {
  console.error('usage: node scripts/dump-skeleton.mjs <evidence-dir> <state-id>');
  process.exit(2);
}
const dom = await readFile(join(evid, 'states', stateId, 'dom.html'), 'utf8');
const body = dom.slice(dom.indexOf('<body'));
const clean = body
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '');
const VOID = new Set(['br', 'img', 'input', 'meta', 'link', 'path', 'rect', 'circle', 'use', 'hr', 'area', 'base', 'col', 'embed', 'track', 'wbr', 'source', 'stop']);
let depth = 0;
const out = [];
const re = /<(\/?)([a-z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/gi;
for (const m of clean.matchAll(re)) {
  const [, close, tag, attrs, self, text] = m;
  if (tag) {
    if (close) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const g = (k) => new RegExp('\\b' + k + '="([^"]*)"').exec(attrs || '')?.[1];
    const parts = [];
    if (g('id')) parts.push('#' + g('id'));
    if (g('role')) parts.push('role=' + g('role'));
    if (g('aria-expanded') != null) parts.push('exp=' + g('aria-expanded'));
    if (g('aria-hidden') != null) parts.push('ah=' + g('aria-hidden'));
    if (g('aria-label')) parts.push('label=' + g('aria-label'));
    if (g('placeholder')) parts.push('ph=' + g('placeholder'));
    if (g('href') && g('href').length < 46) parts.push('href=' + g('href'));
    if (g('src') && g('src').length < 46) parts.push('src=' + g('src'));
    if (g('type')) parts.push('type=' + g('type'));
    const cls = g('class');
    if (cls) parts.push('.' + cls.split(/\s+/).slice(0, 4).join('.'));
    out.push('  '.repeat(depth) + tag + (parts.length ? ' ' + parts.join(' ') : ''));
    if (!self && !VOID.has(tag)) depth++;
  } else if (text && text.trim() && out.length) {
    const t = text.trim().replace(/\s+/g, ' ').slice(0, 60);
    out[out.length - 1] += '  «' + t + '»';
  }
}
await writeFile('/tmp/skeleton.txt', out.join('\n') + '\n');
console.log(`dumped ${out.length} lines → /tmp/skeleton.txt`);
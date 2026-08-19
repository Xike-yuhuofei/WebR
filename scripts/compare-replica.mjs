#!/usr/bin/env node
/**
 * Replica fingerprint comparison tool (TraeWork benchmark iteration loop).
 * Serves the authored replica, reproduces each recorded state context, and
 * compares the replica's live fingerprint signals against the recorded
 * golden fingerprint — reporting exact signal-level deltas.
 *
 * Usage: node scripts/compare-replica.mjs [state-id ...]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { readPackage, collectFingerprintSignals, fingerprintString } from '../dist/index.js';

const EVID = resolve('realworld/traework.webr');
const REPLICA = resolve('realworld/traework-rebuild/public');
const pkg = await readPackage(EVID);

const server = createServer(async (req, res) => {
  const p = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
  try {
    const data = await readFile(join(REPLICA, rel));
    const mime =
      {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.image': 'image/png',
        '.json': 'application/json',
      }[extname(rel)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime }).end(data);
  } catch {
    res.writeHead(404).end('Not Found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const only = process.argv.slice(2);
for (const s of pkg.states) {
  if (only.length > 0 && !only.includes(s.id)) continue;
  const route = s.url.replace(pkg.manifest.source.origin, '') || '/';
  await page.goto(base + (route === '/' ? '/' : route), {
    waitUntil: 'domcontentloaded',
  });
  await page.setViewportSize({ width: s.viewport.width, height: s.viewport.height });
  await page.evaluate('(p) => window.scrollTo(p[0] || 0, p[1] || 0)', [s.scroll.x, s.scroll.y]);
  await page.waitForTimeout(250);
  const signals = await page.evaluate(collectFingerprintSignals, [
    s.url,
    { width: s.viewport.width, height: s.viewport.height },
    s.scroll,
  ]);
  const fp = fingerprintString(signals);
  const ok = fp === s.fingerprint;
  console.log(`${ok ? 'MATCH' : 'DIFF '} ${s.id} ${route} ${s.viewport.width}x${s.viewport.height}`);
  if (!ok && only.length > 0) {
    console.log('  replica:', signals.join(' | '));
  }
}
await browser.close();
server.close();
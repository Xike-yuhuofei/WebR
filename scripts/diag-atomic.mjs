#!/usr/bin/env node
/**
 * Atomic-consistency diagnostic: capture a state atomically on the live page
 * (via the authenticated CDP Chrome), then reload the EXACT serialized DOM
 * offline (localized CSS) and diff the two signal arrays line by line.
 * Any difference is purely environmental (CSS context), not DOM content —
 * because both signal sets come from the same serialized DOM string.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { readPackage, atomicStateCapture, fingerprintString, collectFingerprintSignals } from '../dist/index.js';

const EVID = resolve('realworld/traework.webr');
const pkg = await readPackage(EVID);
const ORIGIN = pkg.manifest.source.origin;

// local asset server
const server = createServer(async (req, res) => {
  const p = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
  try {
    const data = await readFile(join(EVID, p));
    const ext = p.slice(p.lastIndexOf('.'));
    const mime = { '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime }).end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const urlMap = new Map(pkg.assets.assets.map((a) => [a.originalUrl, '/' + a.localPath]));
const rewrite = (html) => {
  let h = html;
  for (const [from, to] of urlMap) h = h.split(from).join(base + to);
  h = h.replace(/([="'(,])\/\/([a-z0-9.-]+)(\/[^"')\s,]*?)(?=["')\s,])/gi, (m, pre, host, path) => {
    const abs = `https://${host}${path}`;
    return urlMap.has(abs) ? pre + base + urlMap.get(abs) : m;
  });
  h = h.replace(/([="'(])(\/[a-zA-Z0-9_][^"')\s,]*?)(?=["')\s,])/g, (m, pre, path) => {
    const abs = ORIGIN + path;
    return urlMap.has(abs) ? pre + base + urlMap.get(abs) : m;
  });
  return h;
};

// live atomic capture on the authenticated session
const browser = await chromium.connectOverCDP('http://[::1]:9222');
const ctx = browser.contexts()[0];
const livePage = await ctx.newPage();
await livePage.setViewportSize({ width: 1440, height: 900 });
await livePage.goto('https://work.trae.cn/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await livePage.waitForTimeout(2500);
const atomic = await livePage.evaluate(atomicStateCapture, ['https://work.trae.cn/', { width: 1440, height: 900 }, { x: 0, y: 0 }]);
await livePage.close().catch(() => {});
await browser.close();

// offline reload of the EXACT serialized dom
const browser2 = await chromium.launch({ headless: true });
const ctx2 = await browser2.newContext({ viewport: { width: 1440, height: 900 } });
const page2 = await ctx2.newPage();
await page2.setContent(rewrite(atomic.dom), { waitUntil: 'domcontentloaded' });
await page2.setViewportSize({ width: 1440, height: 900 });
await page2.waitForTimeout(200);
const offlineSignals = await page2.evaluate(collectFingerprintSignals, ['https://work.trae.cn/', { width: 1440, height: 900 }, { x: 0, y: 0 }]);

console.log('LIVE FP   :', fingerprintString(atomic.signals));
console.log('OFFLINE FP:', fingerprintString(offlineSignals));
const liveSet = new Map(atomic.signals.map((s) => [s, (atomic.signals.indexOf(s))]));
const offSet = new Set(offlineSignals);
console.log('\n--- in LIVE but not OFFLINE ---');
for (const s of atomic.signals) if (!offSet.has(s)) console.log(' +', s);
console.log('--- in OFFLINE but not LIVE ---');
const liveS = new Set(atomic.signals);
for (const s of offlineSignals) if (!liveS.has(s)) console.log(' -', s);
void liveSet;
await browser2.close();
server.close();
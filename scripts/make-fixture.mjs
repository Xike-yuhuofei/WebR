// Builds the committed minimal valid Evidence Package fixture at
// `fixtures/minimal.webr`. Run via `npm run make-fixture`.
//
// The output is deterministic: fixed capturedAt, content-derived SHA-256
// fingerprints and checksums, so re-running is idempotent when inputs do not
// change.
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = join(ROOT, 'fixtures', 'minimal.webr');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// A real, valid 1x1 transparent PNG (required for a schema-valid screenshot
// artifact).
const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const DOM =
  '<html lang="en"><head><meta charset="utf-8"><title>Example</title></head><body><h1 class="wr-Heading">Example</h1></body></html>\n';

const SVG_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#eee"/></svg>\n';

const capturedAt = '2026-08-18T00:00:00Z';
const entryUrl = 'https://example.com/';

function manifest() {
  return {
    format: 'webr-evidence',
    version: '1.0.0',
    capture: { capturedAt, toolVersion: '0.1.0', browser: { name: 'chromium', version: '0.0.0' } },
    source: { origin: 'https://example.com', entryUrl },
    indexes: {
      pages: 'pages/index.json',
      transitions: 'transitions/state-graph.json',
      assets: 'assets/index.json',
      checksums: 'checksums.json',
    },
  };
}

function pageIndex() {
  return { pages: [{ id: 'page-home', url: entryUrl, route: '/', stateIds: ['state-home'] }] };
}

function stateMetadata() {
  return {
    id: 'state-home',
    pageId: 'page-home',
    url: entryUrl,
    viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
    scroll: { x: 0, y: 0 },
    artifacts: { screenshot: 'screenshot.png', dom: 'dom.html' },
    fingerprint: `sha256:${sha256(DOM)}`,
  };
}

function stateGraph() {
  return { nodes: ['state-home'], transitions: [] };
}

function assetIndex() {
  return {
    assets: [
      {
        id: 'asset-logo',
        originalUrl: 'https://example.com/assets/logo.svg',
        localPath: 'assets/svg/logo.svg',
        mimeType: 'image/svg+xml',
        sha256: sha256(SVG_LOGO),
      },
    ],
  };
}

const files = new Map();

async function writeText(rel, data) {
  const abs = join(FIXTURE, rel);
  await mkdir(join(FIXTURE, rel).replace(/\/[^/]+$/, ''), { recursive: true });
  await writeFile(abs, data, 'utf8');
  files.set(rel, Buffer.from(data, 'utf8'));
}

async function writeBinary(rel, data) {
  const buf = Buffer.from(data, 'base64');
  const abs = join(FIXTURE, rel);
  await mkdir(abs.replace(/\/[^/]+$/, ''), { recursive: true });
  await writeFile(abs, buf);
  files.set(rel, buf);
}

async function collectAllFiles(dir = FIXTURE, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const abs = join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (rel === 'checksums.json') continue;
      out.push(...(await collectAllFiles(abs, rel)));
    } else if (rel !== 'checksums.json') {
      out.push(rel);
    }
  }
  return out;
}

async function main() {
  await rm(FIXTURE, { recursive: true, force: true });

  await writeText('manifest.json', JSON.stringify(manifest(), null, 2) + '\n');
  await writeText('pages/index.json', JSON.stringify(pageIndex(), null, 2) + '\n');
  await writeText(
    'states/state-home/metadata.json',
    JSON.stringify(stateMetadata(), null, 2) + '\n',
  );
  await writeText('states/state-home/dom.html', DOM);
  await writeBinary('states/state-home/screenshot.png', PNG_1x1_BASE64);
  await writeText('transitions/state-graph.json', JSON.stringify(stateGraph(), null, 2) + '\n');
  await writeText('assets/index.json', JSON.stringify(assetIndex(), null, 2) + '\n');
  await writeText('assets/svg/logo.svg', SVG_LOGO);

  const checksums = {};
  for (const rel of await collectAllFiles()) {
    const buf = await readFile(join(FIXTURE, rel));
    checksums[rel] = sha256(buf);
  }
  await writeText('checksums.json', JSON.stringify(checksums, null, 2) + '\n');

  console.log(`Wrote fixture: ${FIXTURE}`);
  console.log(`Canonical artifacts covered by checksums: ${Object.keys(checksums).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { afterAll, describe, expect, it } from 'vitest';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readPackage, validatePackage } from '../src/index.js';
import { cleanup, duplicateFixture, rebuildChecksums } from './helpers.js';

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map(cleanup));
});

async function freshDir(): Promise<string> {
  const d = await duplicateFixture();
  tempDirs.push(d);
  return d;
}

describe('validatePackage — valid minimal package', () => {
  it('passes a valid evidence package', async () => {
    const dir = await freshDir();
    const pkg = await readPackage(dir);
    const result = await validatePackage(pkg, dir);

    expect(result.valid).toBe(true);
    expect(result.formatSupported).toBe(true);
    expect(result.checksumsVerified).toBe(true);
    expect(result.format).toBe('webr-evidence');
    expect(result.version).toBe('1.0.0');
    expect(result.issues).toEqual([]);
    expect(result.counts.manifest).toBe(0);
    expect(result.counts.checksums).toBe(0);
  });

  it('recognizes the committed fixture as valid', async () => {
    const { FIXTURE_DIR } = await import('./helpers.js');
    const pkg = await readPackage(FIXTURE_DIR);
    const result = await validatePackage(pkg, FIXTURE_DIR);
    expect(result.valid).toBe(true);
  });
});

describe('validatePackage — version handling', () => {
  it('rejects an unsupported major version', async () => {
    const dir = await freshDir();
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.version = '99.0.0';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    await rebuildChecksums(dir);

    const pkg = await readPackage(dir);
    const result = await validatePackage(pkg, dir);

    expect(result.valid).toBe(false);
    expect(result.formatSupported).toBe(false);
    expect(result.counts.version).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.code === 'unsupported-version')).toBe(true);
  });

  it('rejects a malformed version string', async () => {
    const dir = await freshDir();
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.version = 'abc';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    await rebuildChecksums(dir);

    const pkg = await readPackage(dir);
    const result = await validatePackage(pkg, dir);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'malformed-version')).toBe(true);
  });

  it('rejects an unsupported format string', async () => {
    const dir = await freshDir();
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.format = 'webr/other';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    await rebuildChecksums(dir);

    const pkg = await readPackage(dir);
    const result = await validatePackage(pkg, dir);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'unsupported-format')).toBe(true);
  });
});

describe('validatePackage — integrity checks', () => {
  it('reports a checksum mismatch when a file is corrupted', async () => {
    const dir = await freshDir();
    const shot = join(dir, 'states/state-home/screenshot.png');
    await writeFile(shot, (await readFile(shot)) + Buffer.from('corrupt'));

    const pkg = await readPackage(dir);
    const result = await validatePackage(pkg, dir);

    expect(result.checksumsVerified).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.counts.checksums).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.code === 'checksum-mismatch')).toBe(true);
  });

  it('flags a missing required file', async () => {
    const dir = await freshDir();
    const domPath = join(dir, 'states/state-home/dom.html');
    await unlink(domPath);
    await rebuildChecksums(dir);

    const pkg = await readPackage(dir);
    const result = await validatePackage(pkg, dir);

    expect(result.valid).toBe(false);
    expect(result.counts.files).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.code === 'missing-state-artifact')).toBe(true);
  });
});

describe('validatePackage — referential integrity', () => {
  it('flags a dangling page->state reference', async () => {
    const dir = await freshDir();
    const pagesPath = join(dir, 'pages/index.json');
    const pages = JSON.parse(await readFile(pagesPath, 'utf8'));
    pages.pages[0].stateIds = ['state-missing'];
    await writeFile(pagesPath, JSON.stringify(pages, null, 2) + '\n', 'utf8');
    await rebuildChecksums(dir);

    const pkg = await readPackage(dir);
    const result = await validatePackage(pkg, dir);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'dangling-page-state')).toBe(true);
  });

  it('flags a state graph referencing an unknown node', async () => {
    const dir = await freshDir();
    const graphPath = join(dir, 'transitions/state-graph.json');
    const graph = JSON.parse(await readFile(graphPath, 'utf8'));
    graph.transitions = [
      { id: 'transition-x', from: 'state-home', action: { type: 'click' }, to: 'state-ghost' },
    ];
    await writeFile(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf8');
    await rebuildChecksums(dir);

    const pkg = await readPackage(dir);
    const result = await validatePackage(pkg, dir);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'graph-unknown-to')).toBe(true);
  });
});

describe('validatePackage — package-relative path portability', () => {
  it('rejects an absolute artifact path', async () => {
    const dir = await freshDir();
    const statePath = join(dir, 'states/state-home/metadata.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.artifacts.screenshot = '/etc/absolute.png';
    await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
    await rebuildChecksums(dir);

    const pkg = await readPackage(dir);
    const result = await validatePackage(pkg, dir);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'absolute-state-artifact')).toBe(true);
  });

  it('rejects a path escaping the package via ..', async () => {
    const dir = await freshDir();
    const statePath = join(dir, 'states/state-home/metadata.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.artifacts.dom = '../../outside/dom.html';
    await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
    await rebuildChecksums(dir);

    const pkg = await readPackage(dir);
    const result = await validatePackage(pkg, dir);
    expect(result.valid).toBe(false);
    expect(result.counts.relativePaths).toBeGreaterThan(0);
  });
});

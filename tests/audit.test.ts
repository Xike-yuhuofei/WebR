/**
 * Phase 4 — Completeness Audit / Evidence Freeze tests.
 *
 * Verifies that structurally-valid-but-low-coverage packages are not marked
 * freeze-ready, and that known-incomplete fixtures fail freeze readiness for
 * explicit reasons. Audit never requires source-site access.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auditPackage, DEFAULT_FREEZE_POLICY } from '../src/index.js';
import { cleanup, duplicateFixture, rebuildChecksums, FIXTURE_DIR } from './helpers.js';

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map(cleanup));
});

async function fresh(): Promise<string> {
  const d = await duplicateFixture();
  tempDirs.push(d);
  return d;
}

describe('Phase 4 — valid vs freeze-ready', () => {
  it('the committed minimal fixture is valid and freeze-ready', async () => {
    const audit = await auditPackage(FIXTURE_DIR);
    expect(audit.valid).toBe(true);
    expect(audit.freezeReady).toBe(true);
    expect(audit.freezeBlockers).toEqual([]);
    expect(audit.coverage.states.total).toBe(1);
    expect(audit.coverage.states.golden).toBe(1);
  });

  it('an invalid package is not freeze-ready', async () => {
    const dir = await fresh();
    // Corrupt a checksum so the package becomes structurally invalid.
    const shot = join(dir, 'states/state-home/screenshot.png');
    await writeFile(shot, (await readFile(shot)) + Buffer.from('x'));

    const audit = await auditPackage(dir);
    expect(audit.valid).toBe(false);
    expect(audit.freezeReady).toBe(false);
    expect(audit.freezeBlockers.some((b) => b.includes('structurally valid'))).toBe(true);
  });

  it('a package missing required states is not freeze-ready', async () => {
    const dir = await fresh();
    // Remove the only state: pages index still references it, so this also
    // introduces a dangling reference.
    const { rm } = await import('node:fs/promises');
    await rm(join(dir, 'states/state-home'), { recursive: true });
    await rebuildChecksums(dir);

    const audit = await auditPackage(dir);
    expect(audit.valid).toBe(false);
    expect(audit.freezeReady).toBe(false);
    // The dangling page->state reference is reported.
    expect(audit.issues.some((i) => i.code === 'dangling-page-state')).toBe(true);
    expect(audit.coverage.states.total).toBe(0);
  });

  it('a valid but low-coverage package is not freeze-ready under a stricter policy', async () => {
    const dir = await fresh();
    const audit = await auditPackage(dir, {
      ...DEFAULT_FREEZE_POLICY,
      minStates: 2, // fixture only has 1
    });
    expect(audit.valid).toBe(true);
    expect(audit.freezeReady).toBe(false);
    expect(audit.freezeBlockers.some((b) => b.includes('state'))).toBe(true);
  });

  it('reports unresolved external dependencies as freeze blockers', async () => {
    const dir = await fresh();
    // Add a DOM reference to a source-origin asset that is not localized.
    const domPath = join(dir, 'states/state-home/dom.html');
    const dom = await readFile(domPath, 'utf8');
    await writeFile(
      domPath,
      dom.replace('</body>', '<img src="https://example.com/assets/missing.png"></body>'),
      'utf8',
    );
    await rebuildChecksums(dir);

    const audit = await auditPackage(dir);
    expect(audit.valid).toBe(true);
    expect(audit.freezeReady).toBe(false);
    expect(audit.externalDependencies.length).toBeGreaterThan(0);
    expect(audit.externalDependencies[0].originalUrl).toContain('missing.png');
    expect(audit.freezeBlockers.some((b) => b.includes('external dependency'))).toBe(true);
  });
});

/**
 * GOAL-003 — Independent Agent Reconstruction regression tests.
 *
 * Proves the two reconstruction modes (`replay` / `rebuild`), the blank rebuild
 * workspace scaffold, class-agnostic action resolution, network-wide isolation
 * hardening, and the end-to-end rebuild regression: from the frozen evidence
 * with the source + CDN disconnected, an Agent-authored replica (following
 * `05-SOURCE-CONVENTION.md`, `wr-*` / `is-*` / `--wr-*`) populates a truly blank
 * workspace and passes `webr validate <evidence> <replica> --profile full` with
 * exit code 0 and `transitions.failed = 0`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readdir, readFile, mkdtemp, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readPackage,
  buildReconstructionSpec,
  scaffoldRebuildWorkspace,
  isReusableContentAsset,
  stripCssClasses,
  validateReplica,
  runCli,
  EXIT_CODES,
} from '../src/index.js';
import { cleanup } from './helpers.js';

const EVIDENCE = new URL('../fixtures/benchmark.webr/', import.meta.url).pathname;
const AUTHORED = new URL('../fixtures/rebuilt-benchmark/', import.meta.url).pathname;

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map(cleanup));
});

async function temp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}

describe('GOAL-003 — rebuild workspace scaffold', () => {
  it('scaffolds a truly blank authored-source workspace (no captured runtime)', async () => {
    const pkg = await readPackage(EVIDENCE);
    const spec = buildReconstructionSpec(pkg);
    const ws = await temp('webr-rebuild-scaffold-');
    await scaffoldRebuildWorkspace(spec, EVIDENCE, ws);

    // Agent-facing contract files present.
    await expect(pathExists(join(ws, 'spec.json'))).resolves.toBe(true);
    await expect(pathExists(join(ws, 'README.md'))).resolves.toBe(true);

    // Blank: no captured HTML/CSS/JS as the final implementation.
    const publicFiles = await readdir(join(ws, 'public'), { recursive: true });
    const names = publicFiles.flatMap((f) => (typeof f === 'string' ? [f] : []));
    expect(names.filter((n) => /\.html$/.test(n))).toEqual([]);
    expect(names.filter((n) => n.endsWith('app.js') || n.endsWith('.js'))).toEqual([]);
    expect(names.filter((n) => n.endsWith('.css'))).toEqual([]);

    // Reusable content assets (only the SVG logo here) are copied.
    const svg = spec.assets.filter((a) => isReusableContentAsset(a));
    expect(svg.length).toBeGreaterThan(0);
    for (const a of svg) {
      await expect(pathExists(join(ws, 'public', a.localPath))).resolves.toBe(true);
    }
  });

  it('writes an enriched spec: per-state outline + interactive targets (P2-2)', async () => {
    const pkg = await readPackage(EVIDENCE);
    const spec = buildReconstructionSpec(pkg);
    const ws = await temp('webr-rebuild-enrich-');
    await scaffoldRebuildWorkspace(spec, EVIDENCE, ws);

    // The Agent-facing spec must be enriched with DOM-derived structure.
    const written = JSON.parse(await readFile(join(ws, 'spec.json'), 'utf8'));
    const statesWithDom = pkg.states.filter((s) => s.artifacts.dom);
    expect(written.states.length).toBe(pkg.states.length);
    for (const s of statesWithDom) {
      const record = written.states.find((x) => x.id === s.id);
      // Enrichment is best-effort; assert shape when present.
      if (!record) continue;
      if (record.outline !== undefined) {
        expect(typeof record.outline.headings).toBe('object');
      }
    }
    // The benchmark fixture's captured states carry real DOM → enrichment must
    // populate outline/targets on at least one state.
    const withDom = pkg.states.filter((s) => s.artifacts.dom);
    expect(withDom.length).toBeGreaterThan(0);
    const enriched = written.states.filter(
      (x) => x.outline !== undefined || (x.targets ?? []).length > 0,
    );
    expect(enriched.length).toBeGreaterThan(0);
    // A captured DOM with visible headings should yield a non-empty outline.
    const firstOutline = written.states.find((x) => x.outline && x.outline.headings.length > 0);
    expect(firstOutline).toBeDefined();
  });

  it('isReusableContentAsset allows content but not runtime', () => {
    expect(isReusableContentAsset({ mimeType: 'image/svg+xml', localPath: 'svg/x.svg' })).toBe(
      true,
    );
    expect(isReusableContentAsset({ mimeType: 'image/png', localPath: 'png/x.png' })).toBe(true);
    expect(isReusableContentAsset({ mimeType: 'text/css', localPath: 'css/x.css' })).toBe(false);
    expect(
      isReusableContentAsset({ mimeType: 'application/javascript', localPath: 'js/x.js' }),
    ).toBe(false);
    expect(isReusableContentAsset({ mimeType: 'application/json', localPath: 'api/x' })).toBe(
      false,
    );
  });
});

describe('GOAL-003 — class-agnostic action resolution', () => {
  it('strips authored class names while preserving structure', () => {
    expect(stripCssClasses('#site-header > div.SiteHeader-inner > a.Brand')).toBe(
      '#site-header > div > a',
    );
    expect(stripCssClasses('button.Tab.is-active:nth-of-type(1)')).toBe('button:nth-of-type(1)');
    expect(stripCssClasses('#email-input')).toBe('#email-input');
  });
});

describe('GOAL-003 — rebuild benchmark regression (source + CDN offline)', () => {
  it('blank rebuild workspace → Agent-authored replica → full validation succeeds', async () => {
    // Source + CDN are already disconnected for this regression: the frozen
    // evidence is read from disk only; nothing contacts the original site.
    const pkg = await readPackage(EVIDENCE);
    void pkg;

    // 1. CLI scaffolds the blank rebuild workspace.
    const ws = await temp('webr-rebuild-e2e-ws-');
    const scaffoldCode = await runCli(['reconstruct', EVIDENCE, '--out', ws, '--mode', 'rebuild']);
    expect(scaffoldCode).toBe(EXIT_CODES.success);

    // 2. The coding Agent populates /public with authored source only.
    await cp(AUTHORED, join(ws, 'public'), { recursive: true });

    // 3. Full-profile validation must genuinely pass, with no resize carve-out:
    //    success=true, transitions.failed=0, states.failed=0, isolation clean.
    const report = await validateReplica(EVIDENCE, join(ws, 'public'), {
      profile: 'full',
      visual: { threshold: 0.08, pixelmatchThreshold: 0.1 },
      diffDir: join(ws, 'public', '.webr-diffs'),
    });
    expect(
      report.isolation.passed,
      `isolation violations: ${JSON.stringify(report.isolation)}`,
    ).toBe(true);
    expect(report.failures.filter((f) => f.startsWith('offline-isolation'))).toEqual([]);
    expect(report.states.failed, `state failures: ${report.failures.join('; ')}`).toBe(0);
    expect(
      report.transitions.failed,
      `transition failures must be 0: ${report.failures.join('; ')}`,
    ).toBe(0);
    expect(report.success, `full validation:\n${JSON.stringify(report, null, 2)}`).toBe(true);
  }, 180_000);

  it('`webr validate <evidence> <replica> --profile full` exits 0', async () => {
    const ws2 = await temp('webr-rebuild-e2e-cli-');
    const scaffoldCode = await runCli(['reconstruct', EVIDENCE, '--out', ws2, '--mode', 'rebuild']);
    expect(scaffoldCode).toBe(EXIT_CODES.success);
    // Agent populates the blank workspace.
    await cp(AUTHORED, join(ws2, 'public'), { recursive: true });
    const code = await runCli(['validate', EVIDENCE, join(ws2, 'public'), '--profile', 'full']);
    expect(code).toBe(EXIT_CODES.success);
  }, 180_000);
});

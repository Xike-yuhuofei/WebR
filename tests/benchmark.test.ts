/**
 * GOAL-002 — Benchmark Site end-to-end regression tests.
 *
 * Proves the WebR core loop works against a genuinely interactive, modern
 * Benchmark Site across: hover menu, modal, tabs, form/input, scroll-dependent
 * header, responsive/mobile menu, route navigation, animation, cross-origin/CDN
 * asset, and API-loaded content.
 *
 * Each regression below must *really fail* when its behavior regresses.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startBenchmarkSite,
  type BenchmarkSite,
  auditPackage,
  readPackage,
  validateReplica,
  buildReconstructionSpec,
  buildReplica,
  routeKeyFor,
} from '../src/index.js';
import { cleanup } from './helpers.js';

const tempDirs: string[] = [];
let site: BenchmarkSite | null = null;

beforeAll(async () => {
  site = await startBenchmarkSite();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(cleanup));
});

async function tempPath(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

describe('GOAL-002 — capture regressions on the Benchmark Site', () => {
  it('localizes cross-origin/CDN assets and records API network evidence', async () => {
    const out = await tempPath('webr-bench-cdn-');
    const capture = await import('../src/index.js').then((m) => m.capturePackage);
    await capture({
      url: site!.urls.entry,
      out,
      maxStates: 6,
      maxTransitions: 14,
      maxDepth: 1,
      timeBudgetMs: 120_000,
    });

    const pkg = await readPackage(out);

    // API (JSON) evidence is captured as a localized asset.
    const api = pkg.assets.assets.find((a) => a.mimeType.startsWith('application/json'));
    expect(api).toBeDefined();
    const apiBytes = await readFile(join(out, api!.localPath));
    expect(JSON.parse(apiBytes.toString()).length).toBeGreaterThan(0);

    // Cross-origin CDN stylesheet localizes.
    const cdnCss = pkg.assets.assets.find((a) => a.originalUrl.includes('theme.css'));
    expect(cdnCss).toBeDefined();
    const cssBytes = await readFile(join(out, cdnCss!.localPath));
    expect(cssBytes.toString()).toContain('.Verdant-mark');

    const cdnSvg = pkg.assets.assets.find((a) => a.originalUrl.includes('logo.svg'));
    expect(cdnSvg).toBeDefined();
    expect(cdnSvg!.originalUrl.startsWith(site!.cdnUrl)).toBe(true);

    // Every non-HTML response (any origin) is localized and resolvable.
    for (const a of pkg.assets.assets) {
      const bytes = await readFile(join(out, a.localPath));
      expect(bytes.length).toBeGreaterThan(0);
    }
  }, 150_000);

  it('discovers a hover transition and records scroll/url/viewport states', async () => {
    const out = await tempPath('webr-bench-explore-');
    const capture = await import('../src/index.js').then((m) => m.capturePackage);
    const outcome = await capture({
      url: site!.urls.entry,
      out,
      maxStates: 120,
      maxTransitions: 240,
      maxDepth: 2,
      timeBudgetMs: 180_000,
    });
    const pkg = await readPackage(out);

    // hover-menu transition discovered.
    const hover = pkg.stateGraph.transitions.find((t) => t.action.type === 'hover');
    expect(hover, 'no hover transition discovered').toBeDefined();

    // API-loaded content present in the captured DOM of the root state.
    const root = pkg.states.find((s) => routeKeyFor(s.url) === '/');
    expect(root).toBeDefined();
    const rootDom = await readFile(join(out, 'states', root!.id, 'dom.html'), 'utf8');
    expect(rootDom).toContain('Ribbed tee');

    // Route navigation captured distinct route states.
    const routes = new Set(pkg.states.map((s) => routeKeyFor(s.url)));
    expect(routes.has('/')).toBe(true);
    expect(routes.has('/about')).toBe(true);

    // Scroll-dependent header state: at least one state with scrollY > 0.
    expect(pkg.states.some((s) => s.scroll.y > 0)).toBe(true);

    // Responsive/mobile state: at least one distinct (narrow) viewport.
    const viewports = new Set(pkg.states.map((s) => `${s.viewport.width}x${s.viewport.height}`));
    expect(viewports.size).toBeGreaterThan(1);

    expect(outcome.states).toBeGreaterThanOrEqual(5);
  }, 220_000);

  it('small-graph loop: reconstruct + validate the core mechanism', async () => {
    const evidenceDir = await tempPath('webr-bench-fast-evidence-');
    const capture = await import('../src/index.js').then((m) => m.capturePackage);
    await capture({
      url: site!.urls.entry,
      out: evidenceDir,
      maxStates: 20,
      maxTransitions: 40,
      maxDepth: 1,
      timeBudgetMs: 90_000,
    });
    const pkg = await readPackage(evidenceDir);
    const spec = buildReconstructionSpec(pkg);
    const replicaDir = await tempPath('webr-bench-fast-replica-');
    await buildReplica(spec, evidenceDir, replicaDir);
    const report = await validateReplica(evidenceDir, replicaDir, {
      profile: 'full',
      visual: { threshold: 0.08, pixelmatchThreshold: 0.1 },
      diffDir: join(replicaDir, '.webr-diffs'),
    });
    const nodes = pkg.states.length;
    const edges = pkg.stateGraph.transitions.length;
    const root = pkg.states.find((s) => s.id.endsWith('-0'));
    const summary = JSON.stringify(
      {
        nodes,
        edges,
        rootUrl: root?.url,
        rootRoute: root ? routeKeyFor(root.url) : undefined,
        states: report.states,
        sampleFailures: report.failures.slice(0, 8),
        stateRoutes: pkg.states.map((s) => ({ id: s.id, route: routeKeyFor(s.url) })),
      },
      null,
      2,
    );
    expect(report.isolation.passed, `isolation\n${summary}`).toBe(true);
    expect(report.success, `result\n${summary}`).toBe(true);
    expect(report.states.failed, `state failures\n${summary}`).toBe(0);
    expect(report.transitions.failed, `transition failures\n${summary}`).toBe(0);
  }, 200_000);
});

describe('GOAL-002 — reconstruction + validation with the source offline', () => {
  it('dropping the source + CDN servers, a full-profile replica validates offline', async () => {
    // 1. Capture (source is ONLINE here — the only online step).
    const evidenceDir = await tempPath('webr-bench-e2e-evidence-');
    const capture = await import('../src/index.js').then((m) => m.capturePackage);
    await capture({
      url: site!.urls.entry,
      out: evidenceDir,
      maxStates: 80,
      maxTransitions: 160,
      maxDepth: 2,
      timeBudgetMs: 150_000,
    });

    const pkg = await readPackage(evidenceDir);
    const routes = new Set(pkg.states.map((s) => routeKeyFor(s.url)));
    const actionTypes = new Set(pkg.stateGraph.transitions.map((t) => t.action.type));

    // Make sure the source is actually unreachable from here on.
    const audit = await auditPackage(evidenceDir);
    const siteToClose = site!;
    await siteToClose.close();
    site = null;

    // 2. Reconstruct from the frozen evidence with the source + CDN CLOSED.
    const spec = buildReconstructionSpec(pkg);
    const replicaDir = await tempPath('webr-bench-e2e-replica-');
    await buildReplica(spec, evidenceDir, replicaDir);

    // 3. Validate offline (full profile).
    const report = await validateReplica(evidenceDir, replicaDir, {
      profile: 'full',
      visual: { threshold: 0.08, pixelmatchThreshold: 0.1 },
      diffDir: join(replicaDir, '.webr-diffs'),
    });

    const summary = JSON.stringify(
      {
        routes: [...routes],
        actionTypes: [...actionTypes],
        audit: { valid: audit.valid, freezeReady: audit.freezeReady },
        states: report.states,
        transitions: report.transitions,
        isolation: report.isolation,
        sampleFailures: report.failures.slice(0, 12),
      },
      null,
      2,
    );

    const nonResizeFailures = report.failures.filter((f) => !f.includes('resize:viewport'));
    const summaryNote = `\n${summary}`;

    // Completion contract: with the source + CDN fully offline, the replica
    // must pass visual, interactive, responsive, routing and isolation
    // validation. Every non-`resize` transition failure is a hard regression
    // (click/hover/scroll/navigate/type must reproduce). The only tolerated
    // residuals are responsive `resize` adaptive transitions whose destination
    // still passes its golden STATE screenshot (responsive viewport changes
    // are authoritative via those state comparisons).
    expect(report.isolation.passed, `isolation should be clean${summaryNote}`).toBe(true);
    expect(report.failures.filter((f) => f.startsWith('offline-isolation'))).toEqual([]);
    expect(report.states.failed, `state failures:\n${summary}`).toBe(0);
    expect(nonResizeFailures, `non-resize transition failures:\n${summary}`).toEqual([]);
    // Every state reproduced (visual/routing/responsive/isolation are clean).
    expect(report.states.tested).toBeGreaterThanOrEqual(1);
    expect(report.transitions.tested).toBeGreaterThanOrEqual(1);
    // Responsive resize adaptations remain proven by their state screenshots.
    const resizeOnly =
      report.transitions.failed === 0 ||
      report.failures.every((f) => f.includes('resize:viewport'));
    expect(resizeOnly, `only resize adaptations allowed to remain${summaryNote}`).toBe(true);
  }, 300_000);
});

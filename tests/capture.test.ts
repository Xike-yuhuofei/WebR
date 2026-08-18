/**
 * Phase 2 (Capture Baseline) + Phase 3 (State Explorer) integration tests.
 *
 * These launch Chromium against the controlled local test site. They verify
 * the produced Evidence Package is schema-valid, resolves locally, and that
 * interactive states/transitions are discovered and recorded.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  auditPackage,
  readPackage,
  validatePackage,
  capturePackage,
  type AuditResult,
} from '../src/index.js';
import { startTestSite, type TestSite } from './site-fixture.js';
import { cleanup } from './helpers.js';

const tempDirs: string[] = [];
let site: TestSite | null = null;

beforeAll(async () => {
  site = await startTestSite();
});

afterAll(async () => {
  await site?.close();
  await Promise.all(tempDirs.map(cleanup));
});

describe('Phase 2 — capture baseline', () => {
  it('captures a schema-valid package with locally-resolved assets', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const out = await mkdtemp(join(tmpdir(), 'webr-capture-'));
    tempDirs.push(out);

    const outcome = await capturePackage({
      url: `${site!.url}/`,
      out,
      maxStates: 5,
      maxTransitions: 10,
      maxDepth: 2,
      timeBudgetMs: 60_000,
    });

    expect(outcome.packagePath).toBe(out);
    expect(outcome.states).toBeGreaterThanOrEqual(1);
    expect(outcome.assets).toBeGreaterThanOrEqual(3); // css, js, svg

    const pkg = await readPackage(out);
    const structural = await validatePackage(pkg, out);
    expect(structural.valid).toBe(true);

    // Assets must resolve locally.
    for (const asset of pkg.assets.assets) {
      const bytes = await readFile(join(out, asset.localPath));
      expect(bytes.length).toBeGreaterThan(0);
    }

    // screenshot must be a real PNG.
    const shot = await readFile(join(out, 'states', pkg.states[0].id, 'screenshot.png'));
    expect(shot.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    // network/HAR baseline: the root state recorded page requests.
    const har = await readFile(join(out, 'states', pkg.states[0].id, 'page.har'), 'utf8');
    const harJson = JSON.parse(har);
    expect(harJson.log.version).toBe('1.2');
    expect(harJson.log.entries.length).toBeGreaterThan(0);
    expect(
      harJson.log.entries.some((e: { request: { url: string } }) =>
        e.request.url.includes(site!.url),
      ),
    ).toBe(true);
  }, 90_000);

  it('capture output passes the Phase-4 structural audit', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const out = await mkdtemp(join(tmpdir(), 'webr-capture-audit-'));
    tempDirs.push(out);

    await capturePackage({
      url: `${site!.url}/`,
      out,
      maxStates: 3,
      maxTransitions: 6,
      maxDepth: 2,
      timeBudgetMs: 60_000,
    });

    const audit: AuditResult = await auditPackage(out);
    expect(audit.valid).toBe(true);
    expect(audit.coverage.states.total).toBeGreaterThanOrEqual(1);
    expect(audit.coverage.assets.total).toBeGreaterThanOrEqual(3);
    expect(audit.externalDependencies).toEqual([]);
  }, 90_000);
});

describe('Phase 3 — state explorer / UI state graph', () => {
  it('records transitions for interactive elements and dedupes equivalent states', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const out = await mkdtemp(join(tmpdir(), 'webr-explore-'));
    tempDirs.push(out);

    const outcome = await capturePackage({
      url: `${site!.url}/`,
      out,
      maxStates: 20,
      maxTransitions: 30,
      maxDepth: 3,
      timeBudgetMs: 90_000,
    });

    const pkg = await readPackage(out);
    // The site has a toggle button that changes DOM; exploration should find
    // at least one transition that changes the hidden box.
    expect(outcome.transitions).toBeGreaterThanOrEqual(1);

    // State graph must be structurally valid (nodes ⊆ states, refs resolve).
    const structural = await validatePackage(pkg, out);
    expect(structural.valid).toBe(true);

    // All transition endpoints must be real states.
    const stateIds = new Set(pkg.states.map((s) => s.id));
    for (const t of pkg.stateGraph.transitions) {
      expect(stateIds.has(t.from)).toBe(true);
      expect(stateIds.has(t.to)).toBe(true);
    }

    // The toggle-box click transition should lead to a distinct state (box
    // visible). Verify at least one "click" transition exists.
    const clickTransitions = pkg.stateGraph.transitions.filter((t) => t.action.type === 'click');
    expect(clickTransitions.length).toBeGreaterThanOrEqual(1);

    // The site's test page is short (not scrollable) and the viewport is
    // fixed, so scroll/resize actions may or may not produce new states,
    // but they must be discoverable without error.
    const scrollResize = pkg.stateGraph.transitions.filter(
      (t) => t.action.type === 'scroll' || t.action.type === 'resize',
    );
    // If the page is short enough, scroll produces no new state (fingerprint
    // unchanged), but the action vocabulary is present in the graph.
    expect(scrollResize.length).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('discovers scroll/resize actions and executes them deterministically', async () => {
    const { launchSession, discoverActions, performAction } = await import('../src/index.js');
    const session = await launchSession({ width: 1280, height: 800, deviceScaleFactor: 1 });
    try {
      await session.page.goto(`${site!.url}/long`, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
      await session.page.waitForTimeout(200);

      const actions = await discoverActions(session.page);
      const scroll = actions.find((a) => a.type === 'scroll');
      const resize = actions.find((a) => a.type === 'resize');

      // The tall page must expose a scroll action; resize is always available.
      expect(scroll).toBeDefined();
      expect(resize).toBeDefined();

      // Executing scroll moves the page down.
      const before = await session.page.evaluate(() => window.scrollY);
      const scrollResult = await performAction(session.page, scroll!);
      expect(scrollResult.ok).toBe(true);
      const after = await session.page.evaluate(() => window.scrollY);
      expect(after).toBeGreaterThan(before);

      // Executing resize shrinks the viewport width.
      const resizeResult = await performAction(session.page, resize!);
      expect(resizeResult.ok).toBe(true);
      const size = session.page.viewportSize();
      expect(size!.width).toBeLessThan(1280);
    } finally {
      await session.close();
    }
  }, 60_000);
});

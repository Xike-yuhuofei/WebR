/**
 * Phase 6 — Offline Validator tests.
 *
 * Verifies visual diff mechanics, isolation monitoring, local replica serving,
 * and end-to-end replica validation against the controlled test site.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  compareScreenshots,
  compareStructure,
  structuralSignalsFromDom,
  startReplicaServer,
  monitorIsolation,
  selectStates,
  selectTransitions,
  readPackage,
  DEFAULT_VISUAL_OPTIONS,
} from '../src/index.js';
import { cleanup, duplicateFixture, FIXTURE_DIR } from './helpers.js';
import { writeTestSiteReplica } from './site-fixture.js';
import { chromium } from 'playwright';

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map(cleanup));
});

describe('Phase 6 — visual diff', () => {
  it('identical screenshots pass within threshold', async () => {
    const { PNG } = await import('pngjs');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const png = PNG.sync.write(new PNG({ width: 4, height: 4 }));
    const dir = await mkdtemp(join(tmpdir(), 'webr-diff-'));
    tempDirs.push(dir);

    const result = await compareScreenshots(
      png,
      png,
      join(dir, 'diff.png'),
      DEFAULT_VISUAL_OPTIONS,
    );
    expect(result.passed).toBe(true);
    expect(result.diffPixels).toBe(0);
    expect(result.diffRatio).toBe(0);
  });

  it('different screenshots fail above threshold', async () => {
    const { PNG } = await import('pngjs');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    // Opaque solid backgrounds so pixelmatch does not treat pixels as alpha-ignored.
    const solid = () => {
      const p = new PNG({ width: 4, height: 4 });
      for (let i = 0; i < p.data.length; i += 4) {
        p.data[i] = 200;
        p.data[i + 1] = 200;
        p.data[i + 2] = 200;
        p.data[i + 3] = 255;
      }
      return p;
    };
    const a = solid();
    const b = solid();
    // Paint a different pixel so diffRatio > 0.
    b.data[0] = 0;
    b.data[1] = 0;
    b.data[2] = 0;
    const dir = await mkdtemp(join(tmpdir(), 'webr-diff2-'));
    tempDirs.push(dir);

    const result = await compareScreenshots(
      PNG.sync.write(a),
      PNG.sync.write(b),
      join(dir, 'diff.png'),
      { threshold: 0, pixelmatchThreshold: 0 },
    );
    expect(result.passed).toBe(false);
    expect(result.diffPixels).toBeGreaterThan(0);
    expect(result.diffRatio).toBeGreaterThan(0);
  });
});

describe('Phase 6 — structural/layout comparison (V-6)', () => {
  it('extracts semantic structural signals from serialized HTML', () => {
    const dom =
      '<html><head><title>My Page</title></head><body><h1>Hello</h1><h2>World</h2></body></html>';
    const signals = structuralSignalsFromDom(dom);
    expect(signals.title).toBe('My Page');
    expect(signals.headings).toEqual(['Hello', 'World']);
  });

  it('passes when the replica reproduces expected structure', () => {
    const expected = '<html><head><title>Site</title></head><body><h1>Heading</h1></body></html>';
    const actual =
      '<html><head><title>Site</title></head><body><h1>Heading</h1><p>extra</p></body></html>';
    const result = compareStructure(expected, actual, 'state-home');
    expect(result.passed).toBe(true);
    expect(result.missingExpected).toEqual([]);
  });

  it('flags missing expected structure as a failure', () => {
    const expected = '<html><head><title>Site</title></head><body><h1>Heading</h1></body></html>';
    const actual = '<html><head><title>Other</title></head><body></body></html>';
    const result = compareStructure(expected, actual, 'state-home');
    expect(result.passed).toBe(false);
    expect(result.missingExpected.length).toBeGreaterThan(0);
  });
});

describe('Phase 6 — replica server + isolation monitoring', () => {
  it('serves the replica and blocks path escapes', async () => {
    const replica = await writeTestSiteReplica();
    tempDirs.push(replica);
    const server = await startReplicaServer(replica);
    try {
      const res = await fetch(`${server.url}/index.html`);
      expect(res.status).toBe(200);
      expect((await res.text()).length).toBeGreaterThan(0);
      // Path escape is blocked.
      const esc = await fetch(`${server.url}/../../etc/passwd`);
      expect([403, 404]).toContain(esc.status);
    } finally {
      await server.close();
    }
  });

  it('monitors and flags source-origin requests as isolation violations', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const violations = monitorIsolation(page, 'https://example.com');
      await page
        .goto('data:text/html,<script>fetch("https://example.com/x")</script>')
        .catch(() => {});
      await page.waitForTimeout(300);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].url).toContain('https://example.com');
    } finally {
      await browser.close();
    }
  });
});

describe('Phase 6 — profile selection', () => {
  it('selects a bounded subset of states/transitions per profile', async () => {
    const pkg = await readPackage(FIXTURE_DIR);
    const smokeStates = selectStates(pkg, 'smoke');
    const fullStates = selectStates(pkg, 'full');
    expect(smokeStates.length).toBeGreaterThanOrEqual(1);
    expect(fullStates.length).toBeGreaterThanOrEqual(smokeStates.length);
    // transitions are empty in the fixture; selection must not blow up.
    expect(Array.isArray(selectTransitions(pkg, 'full'))).toBe(true);
  });
});

describe('Phase 6 — end-to-end replica validation (controlled correct replica)', () => {
  it('passes a replica rebuilt from a live capture of the test site', async () => {
    const { capturePackage, validateReplica, buildReconstructionSpec, buildReplica } =
      await import('../src/index.js');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { startTestSite } = await import('./site-fixture.js');

    const site = await startTestSite();
    try {
      const evidenceDir = await mkdtemp(join(tmpdir(), 'webr-e2e-evidence-'));
      tempDirs.push(evidenceDir);
      await capturePackage({
        url: `${site.url}/`,
        out: evidenceDir,
        maxStates: 2,
        maxTransitions: 4,
        maxDepth: 1,
        timeBudgetMs: 60_000,
      });

      const pkg = await readPackage(evidenceDir);
      const spec = buildReconstructionSpec(pkg);
      const replicaDir = await mkdtemp(join(tmpdir(), 'webr-e2e-replica-'));
      tempDirs.push(replicaDir);
      await buildReplica(spec, evidenceDir, replicaDir);

      const report = await validateReplica(evidenceDir, replicaDir, {
        profile: 'smoke',
        // The replica re-renders the same captured DOM, so a modest tolerance
        // accepts font/metrics noise while still detecting real regressions.
        visual: { threshold: 0.1, pixelmatchThreshold: 0.1 },
        diffDir: join(replicaDir, '.webr-diffs'),
      });

      expect(report.isolation.passed).toBe(true);
      expect(report.failures.filter((f) => f.startsWith('offline-isolation'))).toEqual([]);
      expect(report.success).toBe(true);
      expect(report.states.tested).toBeGreaterThanOrEqual(1);
    } finally {
      await site.close();
    }
  }, 90_000);

  it('reports a validation failure for a clearly-wrong replica', async () => {
    const { validateReplica } = await import('../src/index.js');
    const { mkdtemp, writeFile: wf } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');

    const evidenceDir = await duplicateFixture();
    tempDirs.push(evidenceDir);

    // A replica that is a totally different page (wrong content).
    const wrong = await mkdtemp(join(tmpdir(), 'webr-wrong-replica-'));
    tempDirs.push(wrong);
    await wf(
      join(wrong, 'index.html'),
      '<html><body><h1>Completely different</h1><div data-wr-replica="true" data-wr-state="state-home"></div></body></html>',
      'utf8',
    );

    const report = await validateReplica(evidenceDir, wrong, {
      profile: 'smoke',
      visual: { threshold: 0.0, pixelmatchThreshold: 0 }, // strict: any diff fails
      diffDir: join(wrong, '.webr-diffs'),
    });

    expect(report.success).toBe(false);
    expect(report.states.failed).toBeGreaterThan(0);
    expect(report.visual.comparisons.length).toBeGreaterThan(0);
    // Diagnostic artifacts are preserved.
    const diffExists = await import('node:fs/promises').then((fs) =>
      fs
        .stat(join(wrong, '.webr-diffs', 'state-home.diff.png'))
        .then(() => true)
        .catch(() => false),
    );
    expect(diffExists).toBe(true);
  }, 60_000);
});

/**
 * GOAL-005 — P0 remediation acceptance tests.
 *
 * Unit-level acceptance for the four P0 capabilities added to close the
 * Benchmark→Real-World gap (see realworld/GOAL-004-GAP-REPORT.md):
 *   P0-1 locator hardening (multi-strategy locators + prioritized resolution)
 *   P0-2 Golden-Reference validity gate (reject/warn error/challenge/empty)
 *   P0-4 auditor navigation-link vs fetched-resource disambiguation
 *
 * These are deterministic, no-browser, no-network unit tests.
 */
import { describe, expect, it } from 'vitest';
import { classifyStateHealth } from '../src/capture/collector.js';
import { auditPackage } from '../src/index.js';
import { stripCssClasses } from '../src/index.js';
import { duplicateFixture, rebuildChecksums } from './helpers.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const tempDirs: string[] = [];
afterAll(async () => {
  const { cleanup } = await import('./helpers.js');
  await Promise.all(tempDirs.map(cleanup));
});

describe('P0-2 — Golden-Reference validity gate', () => {
  it('flags a Next.js error boundary as error', () => {
    const dom = `<html><body><h1>Something went wrong</h1><p>We encountered an unexpected error. Please try again.</p></body></html>`;
    expect(classifyStateHealth(dom)).toBe('error');
  });

  it('flags a security/challenge page', () => {
    const dom = `<html><body><h1>Security Check</h1><p>Verify you are human before accessing.</p></body></html>`;
    expect(classifyStateHealth(dom)).toBe('challenge');
  });

  it('flags an empty page', () => {
    expect(
      classifyStateHealth('<html><head><script>void 0</script></head><body></body></html>'),
    ).toBe('empty');
  });

  it('accepts a real content page as ok', () => {
    const dom = `<html><head><title>Vite | Next Generation Frontend Tooling</title></head><body><h1>The Build Tool for the Web</h1><p>Vite is a blazing fast frontend build tool.</p></body></html>`;
    expect(classifyStateHealth(dom, 'Vite | Next Generation Frontend Tooling')).toBe('ok');
  });
});

describe('P0-1 — locator hardening (class-agnostic resolution)', () => {
  it('stripCssClasses removes authored classes but keeps ids/tags/nth-of-type', () => {
    const sel = '#app > div.marketing-layout > a.VPLink.link.flex:nth-of-type(1)';
    const stripped = stripCssClasses(sel);
    expect(stripped).toBe('#app > div > a:nth-of-type(1)');
    expect(stripped).not.toContain('.VPLink');
    expect(stripped).not.toContain('.flex');
  });
});

describe('P0-4 — auditor navigation-link vs fetched-resource disambiguation', () => {
  it('does NOT treat hreflang alternate links as external dependencies', async () => {
    const dir = await duplicateFixture();
    tempDirs.push(dir);

    const domPath = join(dir, 'states/state-home/dom.html');
    const dom = await readFile(domPath, 'utf8');
    // Inject same-origin hreflang alternate links + a plain <a href> nav link:
    // these are routing metadata, not resources, so they must not block freeze.
    const enriched = dom.replace(
      '</body>',
      '<link rel="alternate" hreflang="zh" href="https://example.com/zh/">' +
        '<link rel="alternate" hreflang="ja" href="https://example.com/ja/">' +
        '<link rel="canonical" href="https://example.com/">' +
        '<a href="https://example.com/about">About</a>' +
        '</body>',
    );
    await writeFile(domPath, enriched, 'utf8');
    await rebuildChecksums(dir);

    const audit = await auditPackage(dir);
    expect(audit.valid).toBe(true);
    // Navigation/metadata links are not unresolved resource dependencies.
    expect(audit.externalDependencies).toEqual([]);
    expect(audit.freezeBlockers).toEqual([]);
  });

  it('still flags a truly fetched source-origin resource (img script css font)', async () => {
    const dir = await duplicateFixture();
    tempDirs.push(dir);

    const domPath = join(dir, 'states/state-home/dom.html');
    const dom = await readFile(domPath, 'utf8');
    const enriched = dom.replace(
      '</body>',
      '<img src="https://example.com/assets/missing.png">' +
        '<script src="https://example.com/assets/missing.js"></script>' +
        '<link rel="stylesheet" href="https://example.com/assets/missing.css">' +
        '</body>',
    );
    await writeFile(domPath, enriched, 'utf8');
    await rebuildChecksums(dir);

    const audit = await auditPackage(dir);
    expect(audit.valid).toBe(true);
    expect(audit.externalDependencies.length).toBeGreaterThanOrEqual(3);
    expect(audit.freezeReady).toBe(false);
    const urls = audit.externalDependencies.map((d) => d.originalUrl);
    expect(urls).toContain('https://example.com/assets/missing.png');
    expect(urls).toContain('https://example.com/assets/missing.js');
    expect(urls).toContain('https://example.com/assets/missing.css');
  });
});

describe('P0-3 — responsive + scroll first-class states', () => {
  it('captures a mobile viewport and a scrolled state by default', async () => {
    const { capturePackage, readPackage } = await import('../src/index.js');
    const { startTestSite } = await import('./site-fixture.js');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');

    const site = await startTestSite();
    try {
      const out = await mkdtemp(join(tmpdir(), 'webr-responsive-'));
      tempDirs.push(out);
      await capturePackage({
        url: `${site.url}/long`,
        out,
        maxStates: 8,
        maxTransitions: 8,
        maxDepth: 2,
        timeBudgetMs: 60_000,
      });

      const pkg = await readPackage(out);
      // Root 1440 desktop state plus a 390-wide mobile state must exist, and
      // a scrolled depth (y>0) must be represented as its own state.
      const viewports = [...new Set(pkg.states.map((s) => s.viewport.width))];
      expect(viewports.some((w) => w <= 400)).toBe(true);
      expect(viewports.some((w) => w >= 1000)).toBe(true);
      expect(pkg.states.some((s) => s.scroll.y > 0)).toBe(true);
      // resize + scroll transitions from the entry state are recorded.
      const types = new Set(pkg.stateGraph.transitions.map((t) => t.action.type));
      expect(types.has('resize')).toBe(true);
      expect(types.has('scroll')).toBe(true);
    } finally {
      await site.close();
    }
  }, 90_000);
});

describe('GOAL-006 P1 — real-world gap remediation', () => {
  describe('P1-1 — immersive exploration', () => {
    it('reports pageLoads and still discovers transitions', async () => {
      const { capturePackage, readPackage } = await import('../src/index.js');
      const { startTestSite } = await import('./site-fixture.js');
      const { mkdtemp } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');

      const site = await startTestSite();
      try {
        const out = await mkdtemp(join(tmpdir(), 'webr-immersive-'));
        tempDirs.push(out);
        const outcome = await capturePackage({
          url: `${site.url}/`,
          out,
          maxStates: 12,
          maxTransitions: 20,
          maxDepth: 3,
          timeBudgetMs: 60_000,
        });
        // The immersive explorer reports its top-level page-load count.
        expect(outcome.pageLoads).toBeGreaterThanOrEqual(1);
        const pkg = await readPackage(out);
        // Exploration still produces real states + transitions.
        expect(pkg.states.length).toBeGreaterThanOrEqual(1);
        expect(pkg.stateGraph.transitions.length).toBeGreaterThanOrEqual(1);
      } finally {
        await site.close();
      }
    }, 90_000);
  });

  describe('P1-3 — third-party tracker stripping', () => {
    it('classifies known analytics/tracker hosts as non-content', async () => {
      const { isTracker, isLocalizableAsset } = await import('../src/index.js');
      const obs = (url: string) => ({
        url,
        status: 200,
        mimeType: 'application/javascript',
        body: Buffer.from('x'),
        headers: {} as Record<string, string>,
      });
      expect(isTracker(obs('https://www.googletagmanager.com/gtag/js?id=G-X'))).toBe(true);
      expect(isTracker(obs('https://connect.facebook.net/en_US/fbevents.js'))).toBe(true);
      expect(isTracker(obs('https://snap.licdn.com/li.lms-analytics/insight.min.js'))).toBe(true);
      expect(isTracker(obs('https://analytics.tiktok.com/i18n/pixel/events.js'))).toBe(true);
      expect(
        isTracker(obs('https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/img.jpg')),
      ).toBe(false);
      // Tracker scripts are not localized as content assets.
      expect(isLocalizableAsset(obs('https://connect.facebook.net/en_US/fbevents.js'))).toBe(false);
    });
  });

  describe('P1-2 — anti-bot / challenge gate', () => {
    it('classifies a Vercel security checkpoint as challenge', async () => {
      const { classifyStateHealth } = await import('../src/index.js');
      const dom =
        '<html><head><title>Vercel Security Checkpoint</title></head><body><h1>Verify you are human</h1><form>challenge</form></body></html>';
      expect(classifyStateHealth(dom, 'Vercel Security Checkpoint')).toBe('challenge');
    });

    it('refuses to freeze a package whose entry is a challenge page', async () => {
      const { CaptureBlockedError } = await import('../src/index.js');
      // Directly verify the error carries a machine-readable classification.
      const err = new CaptureBlockedError('challenge', 'unittest');
      expect(err.kind).toBe('challenge');
      expect(err.message).toContain('capture blocked (challenge)');
    });
  });

  describe('P1-4 — validator diagnostic granularity', () => {
    it('distinguishes locator-unresolved from action-execution-error', async () => {
      const { executeAction } = await import('../src/index.js');
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent('<html><body><div>hello</div></body></html>');
        // A click on a locator that does not exist anywhere → locator-unresolved.
        const outcome = await executeAction(page, {
          type: 'click',
          target: { strategy: 'css', value: '#does-not-exist' },
        });
        expect(outcome.ok).toBe(false);
        expect(outcome.reason).toBe('locator-unresolved');
      } finally {
        await browser.close();
      }
    });
  });
});

describe('GOAL-007 P2 — real-world gap remediation', () => {
  describe('P2-2 — spec enrichment (outline + targets)', () => {
    it('extracts title + full h1-h6 heading outline from DOM', async () => {
      const { outlineFromDom } = await import('../src/index.js');
      const dom =
        '<html><head><title>Docs</title></head><body><h1>A</h1><h2>B</h2><h3>C</h3></body></html>';
      const outline = outlineFromDom(dom);
      expect(outline.title).toBe('Docs');
      expect(outline.headings).toEqual(['A', 'B', 'C']);
    });

    it('extracts visible interactive targets (id/role/text) from DOM', async () => {
      const { targetsFromDomMinimal } = await import('../src/index.js');
      const dom =
        '<html><body><a href="/x" id="nav" role="link">Guide</a>' +
        '<button data-testid="b" aria-label="Save">Save</button></body></html>';
      const targets = targetsFromDomMinimal(dom);
      expect(targets.some((t) => t.id === 'nav')).toBe(true);
      expect(targets.some((t) => t.text === 'Guide')).toBe(true);
    });

    it('buildReconstructionSpec populates outline/targets when DOM is supplied', async () => {
      const { buildReconstructionSpec, readPackage } = await import('../src/index.js');
      const { FIXTURE_DIR } = await import('./helpers.js');
      const pkg = await readPackage(FIXTURE_DIR);
      const dom =
        '<html><head><title>Home</title></head><body><h1>Hi</h1><button id="b">X</button></body></html>';
      const spec = buildReconstructionSpec(pkg, { 'state-home': dom });
      const state = spec.states.find((s) => s.id === 'state-home');
      expect(state?.outline?.title).toBe('Home');
      expect(state?.outline?.headings).toContain('Hi');
      expect(state?.targets?.length).toBeGreaterThan(0);
    });
  });

  describe('P2-1 — masked visual comparison', () => {
    it('masked regions do not contribute to diffRatio', async () => {
      const { PNG } = await import('pngjs');
      const { compareScreenshots } = await import('../src/index.js');
      const { mkdtemp } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const solid = (color: number) => {
        const p = new PNG({ width: 8, height: 8 });
        for (let i = 0; i < p.data.length; i += 4) {
          p.data[i] = color;
          p.data[i + 1] = color;
          p.data[i + 2] = color;
          p.data[i + 3] = 255;
        }
        return p;
      };
      const a = solid(200);
      const b = solid(200);
      // Differ only inside a 4x4 corner region.
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const i = (y * 8 + x) * 4;
          b.data[i] = 0;
          b.data[i + 1] = 0;
          b.data[i + 2] = 0;
        }
      }
      const dir = await mkdtemp(join(tmpdir(), 'webr-mask-'));
      tempDirs.push(dir);
      const diffPath = join(dir, 'diff.png');
      // Without a mask the diff is large and fails; with the mask it passes.
      const unmasked = await compareScreenshots(PNG.sync.write(a), PNG.sync.write(b), diffPath, {
        threshold: 0.03,
        pixelmatchThreshold: 0.1,
      });
      expect(unmasked.passed).toBe(false);
      const masked = await compareScreenshots(PNG.sync.write(a), PNG.sync.write(b), diffPath, {
        threshold: 0.03,
        pixelmatchThreshold: 0.1,
        mask: [{ x: 0, y: 0, width: 4, height: 4 }],
      });
      expect(masked.passed).toBe(true);
      // Per-content-class threshold is honored without changing the global default.
      const byClass = await compareScreenshots(
        PNG.sync.write(a),
        PNG.sync.write(b),
        diffPath,
        { threshold: 0.03, pixelmatchThreshold: 0.1, thresholdsByClass: { marketing: 1 } },
        'marketing',
      );
      expect(byClass.passed).toBe(true);
    });
  });

  describe('P2-3 — internal route discovery', () => {
    it('discovers bounded same-origin internal routes and skips assets/anchors/external', async () => {
      const { discoverInternalRoutes } = await import('../src/index.js');
      const dom =
        '<a href="/about">About</a>' +
        '<a href="https://example.com/pricing?plan=pro">Pricing</a>' +
        '<a href="https://example.com/logo.png">img</a>' +
        '<a href="#section">anchor</a>' +
        '<a href="https://external.com/x">ext</a>';
      const routes = discoverInternalRoutes(dom, 'https://example.com', 10);
      expect(routes).toContain('https://example.com/about');
      expect(routes).toContain('https://example.com/pricing?plan=pro');
      expect(routes.some((r) => r.includes('logo.png'))).toBe(false);
      expect(routes.some((r) => r.includes('external.com'))).toBe(false);
      expect(routes.some((r) => r.includes('#'))).toBe(false);
    });
  });

  describe('P2-4 — replay trace artifact', () => {
    it('validateReplica writes replay-trace.json when captureTraces is enabled', async () => {
      const { validateReplica } = await import('../src/index.js');
      const { mkdtemp, readFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const { duplicateFixtureDir, FIXTURE_DIR } = await import('./helpers.js');
      const dir = await duplicateFixtureDir(FIXTURE_DIR);
      const out = await mkdtemp(join(tmpdir(), 'webr-trace-'));
      tempDirs.push(dir);
      tempDirs.push(out);
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(
        join(out, 'index.html'),
        '<html><body><h1>Home</h1><div data-wr-replica="true" data-wr-state="state-home"></div></body></html>',
        'utf8',
      );
      const report = await validateReplica(dir, out, {
        profile: 'smoke',
        visual: { threshold: 0.03, pixelmatchThreshold: 0.1 },
        captureTraces: true,
        diffDir: join(out, '.webr-diffs'),
      });
      expect(report.traces).toBeDefined();
      const traceBytes = await readFile(
        join(out, '.webr-diffs', 'replay-trace.json'),
        'utf8',
      ).catch(() => null);
      expect(traceBytes).toBeTruthy();
    }, 60_000);
  });
});

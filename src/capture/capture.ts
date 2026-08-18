/**
 * Capture orchestration — Phase 2 (Capture Baseline) + Phase 3 (State
 * Explorer / UI State Graph).
 *
 * `capturePackage` is the engine behind `webr capture`. It is the only place
 * in the toolkit that contacts the source website.
 */
import { sha256Hex } from '../checksum.js';
import { TOOL_VERSION, type CaptureMetadata, type Viewport } from '../contracts.js';
import { launchSession } from './browser.js';
import { collectFingerprintSignals, fingerprintString } from './fingerprint.js';
import {
  createHarCollector,
  isLocalizableAsset,
  observeResponses,
  routeOf,
  waitForPageReady,
  type CaptureResult,
  type CapturedAsset,
  type CapturedStateEvidence,
} from './collector.js';
import { DEFAULT_EXPLORE_OPTIONS, explore, type ExploreOptions } from '../explore/explorer.js';
import { assetId, assetLocalPath, writePackage } from './writer.js';

export interface CaptureConfig {
  /** Source URL to capture (entry page). */
  url: string;
  /** Output directory for the `.webr` package. */
  out: string;
  /** Capture viewport. */
  viewport?: Partial<Viewport>;
  /** Explorer budgets. */
  maxStates?: number;
  maxTransitions?: number;
  maxDepth?: number;
  timeBudgetMs?: number;
  /** Emit verbose logs. */
  verbose?: boolean;
}

export interface CaptureOutcome {
  packagePath: string;
  states: number;
  transitions: number;
  assets: number;
  warnings: string[];
}

/**
 * Capture a single entry URL into a `.webr` package, including bounded state
 * exploration. Returns metadata about what was produced.
 */
export async function capturePackage(config: CaptureConfig): Promise<CaptureOutcome> {
  const url = config.url;
  const sourceOrigin = new URL(url).origin;

  const viewport: Viewport = {
    width: config.viewport?.width ?? DEFAULT_EXPLORE_OPTIONS.viewport.width,
    height: config.viewport?.height ?? DEFAULT_EXPLORE_OPTIONS.viewport.height,
    deviceScaleFactor: config.viewport?.deviceScaleFactor ?? 1,
  };

  const exploreOptions: ExploreOptions = {
    ...DEFAULT_EXPLORE_OPTIONS,
    viewport,
    maxStates: config.maxStates ?? DEFAULT_EXPLORE_OPTIONS.maxStates,
    maxTransitions: config.maxTransitions ?? DEFAULT_EXPLORE_OPTIONS.maxTransitions,
    maxDepth: config.maxDepth ?? DEFAULT_EXPLORE_OPTIONS.maxDepth,
    timeBudgetMs: config.timeBudgetMs ?? DEFAULT_EXPLORE_OPTIONS.timeBudgetMs,
  };

  const session = await launchSession(viewport, { verbose: config.verbose });
  const { page } = session;

  const assetMap = new Map<string, CapturedAsset>();
  const transitions: CaptureResult['transitions'] = [];
  const warnings: string[] = [];

  const harCollector = createHarCollector(page, TOOL_VERSION);

  const stopObserving = observeResponses(page, (obs) => {
    if (!isLocalizableAsset(obs)) return;
    if (assetMap.has(obs.url)) return;
    const id = assetId(obs.url);
    const localPath = assetLocalPath(obs.url, obs.body!, assetMap.size);
    assetMap.set(obs.url, {
      id,
      originalUrl: obs.url,
      localPath,
      mimeType: obs.mimeType || 'application/octet-stream',
      sha256: sha256Hex(obs.body!),
      data: obs.body!,
    });
  });

  const captureState = async (fingerprint: string): Promise<CapturedStateEvidence> => {
    await waitForPageReady(page);
    // Record the *actual* observable context (viewport, scroll, URL), which
    // may differ from the session default after resize/scroll/navigation
    // actions produce a distinct state.
    const layout = await page.evaluate(() => ({
      scroll: { x: window.scrollX, y: window.scrollY },
      viewportCss: { width: window.innerWidth, height: window.innerHeight },
    }));
    const vp = page.viewportSize();
    const actualViewport: Viewport = {
      width: vp?.width ?? layout.viewportCss.width,
      height: vp?.height ?? layout.viewportCss.height,
      deviceScaleFactor: 1,
    };
    // Recompute the fingerprint *here*, from the exact DOM that is about to be
    // screenshot-captured. The exploration-time fingerprint can include
    // transient residues that settle during the pre-capture wait; storing a
    // fingerprint that matches the snapshot keeps it reproducible for replay.
    const signals = await page.evaluate(collectFingerprintSignals, [
      page.url(),
      { width: actualViewport.width, height: actualViewport.height },
      layout.scroll,
    ] as [string, { width: number; height: number }, import('../contracts.js').ScrollPosition]);
    fingerprint = fingerprintString(signals);

    const screenshot = await page.screenshot({ type: 'png' });
    const fullpage = exploreOptions.fullPage
      ? await page.screenshot({ type: 'png', fullPage: true })
      : undefined;

    const doc = await page.evaluate(() => ({
      dom: document.documentElement.outerHTML,
      title: document.title,
    }));
    const title = doc.title;

    let computedStyles: Record<string, unknown> | undefined;
    if (exploreOptions.computedStyles) {
      computedStyles = await collectComputedStyles(page);
    }
    let accessibility: Record<string, unknown> | undefined;
    if (exploreOptions.accessibility) {
      accessibility = await collectAccessibility(page);
    }

    const state: CapturedStateEvidence = {
      id: '', // assigned by explorer
      pageId: 'page-1',
      url: page.url(),
      title,
      viewport: actualViewport,
      scroll: layout.scroll,
      artifacts: {
        screenshot,
        fullpage,
        dom: doc.dom,
        computedStyles,
        accessibility,
        har: harCollector.snapshot() as unknown as Record<string, unknown>,
      },
      fingerprint,
    };
    return state;
  };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitForPageReady(page);

    const result = await explore(
      { page, viewport, url, scroll: { x: 0, y: 0 } },
      async (fp) => {
        const s = await captureState(fp);
        return s;
      },
      exploreOptions,
    );

    // Explorer captures the root state first, then discovered states.
    const allStates = result.states;

    for (const t of result.transitions) {
      transitions.push({
        id: t.id,
        from: t.from,
        action: { type: t.action.type, target: t.action.target },
        to: t.to,
      });
    }
    warnings.push(...result.warnings);
    for (const s of result.skipped) {
      if (s.count > 0) warnings.push(`skipped ${s.count} × ${s.reason}`);
    }

    const entryUrl = url;
    const metadata: CaptureMetadata = {
      capturedAt: new Date().toISOString(),
      toolVersion: TOOL_VERSION,
      browser: { name: 'chromium', version: session.browserVersion },
    };

    await writePackage(config.out, {
      metadata,
      sourceOrigin,
      entryUrl,
      page: {
        id: 'page-1',
        url: entryUrl,
        route: routeOf(entryUrl),
        title: allStates[0]?.title,
      },
      states: allStates,
      assets: [...assetMap.values()],
      transitions,
    });

    return {
      packagePath: config.out,
      states: allStates.length,
      transitions: transitions.length,
      assets: assetMap.size,
      warnings,
    };
  } finally {
    stopObserving();
    harCollector.detach();
    await session.close();
  }
}

/** Collect a bounded sample of computed styles for deterministic evidence. */
async function collectComputedStyles(
  page: import('playwright').Page,
): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const props = [
      'color',
      'background-color',
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'display',
      'visibility',
      'opacity',
      'margin',
      'padding',
      'border-color',
      'border-radius',
    ];
    const sampleTags = [
      'html',
      'body',
      'header',
      'nav',
      'main',
      'footer',
      'h1',
      'h2',
      'button',
      'a',
      'input',
      'ul',
    ];
    const out: Record<string, unknown> = {};
    for (const tag of sampleTags) {
      const el = document.querySelector(tag);
      if (!el) continue;
      const cs = getComputedStyle(el);
      out[tag] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    }
    // Also capture class-level style for interactive elements to detect
    // hover/focus/active pseudo-state differences indirectly.
    const interactive = document.querySelectorAll<HTMLElement>(
      'button,a,input,[role="button"],[role="menuitem"]',
    );
    const classes: Record<string, string> = {};
    for (const el of Array.from(interactive).slice(0, 20)) {
      const key =
        el.id || `${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 20)}`;
      classes[key] = el.className ?? '';
    }
    out._interactiveClasses = classes;
    return out;
  });
}

/** Collect a bounded accessibility snapshot for deterministic evidence. */
async function collectAccessibility(
  page: import('playwright').Page,
): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const out: Record<string, unknown> = {};
    const all = document.querySelectorAll('a,button,input,select,textarea,[role]');
    const nodes = Array.from(all)
      .slice(0, 40)
      .map((el) => {
        const role = el.getAttribute('role') ?? null;
        return {
          tag: el.tagName.toLowerCase(),
          role,
          ariaLabel: el.getAttribute('aria-label'),
          ariaExpanded: el.getAttribute('aria-expanded'),
          ariaHidden: el.getAttribute('aria-hidden'),
          text: (el.textContent ?? '').trim().slice(0, 60) || null,
          name:
            el.getAttribute('aria-label') ??
            el.getAttribute('name') ??
            el.getAttribute('placeholder') ??
            null,
        };
      });
    out.nodeCount = nodes.length;
    out.nodes = nodes;
    return out;
  });
}

/**
 * Capture orchestration — Phase 2 (Capture Baseline) + Phase 3 (State
 * Explorer / UI State Graph).
 *
 * `capturePackage` is the engine behind `webr capture`. It is the only place
 * in the toolkit that contacts the source website.
 */
import { sha256Hex } from '../checksum.js';
import {
  TOOL_VERSION,
  type CaptureMetadata,
  type ScrollPosition,
  type Viewport,
} from '../contracts.js';
import { CaptureBlockedError } from '../errors.js';
import { launchSession } from './browser.js';
import { atomicStateCapture, fingerprintString } from './fingerprint.js';
import {
  createHarCollector,
  isLocalizableAsset,
  observeResponses,
  routeOf,
  waitForPageReady,
  classifyStateHealth,
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
  /** Explore budgets. */
  maxStates?: number;
  maxTransitions?: number;
  maxDepth?: number;
  timeBudgetMs?: number;
  /** Skip full-page screenshots (expensive on tall real pages). */
  fullPage?: boolean;
  /** Responsive viewports to capture as first-class states (defaults to desktop+mobile). */
  responsiveViewports?: Viewport[];
  /** Scroll depths of the entry viewport to capture as states. */
  scrolledDepths?: ScrollPosition[];
  /** Emit verbose logs. */
  verbose?: boolean;
  /**
   * When set, capture connects to an already-running authenticated Chrome via
   * CDP (e.g. the Profile Chrome at `http://[::1]:9222` per
   * `07-BROWSER-POLICY.md`) instead of launching a clean headless profile.
   * Required to capture a login-gated product. Defaults to the frozen
   * headless-clean profile when omitted.
   */
  connectCDP?: string;
  /**
   * Golden-Reference validity gate (GOAL-006 P1-2). When set (default), capture
   * refuses to freeze a package whose *entry* state is a WAF/anti-bot challenge
   * page, an error boundary, or an empty document — instead throwing
   * `CaptureBlockedError` with a machine-readable kind. Set to `false` to force
   * capture to proceed and record the (possibly useless) page.
   */
  blockOnInvalidEntry?: boolean;
  /**
   * Multi-route capture (GOAL-007 P2-3). When enabled, after capturing the
   * entry route, capture finds bounded internal same-origin route links in the
   * entry DOM and records an entry state for each as a separate page, producing
   * a real `pages`/`routes` index instead of a single implied `/` route.
   * `false` (default) keeps single-page behavior for full backward
   * compatibility. Pass `{ maxPages, maxDepth }` to bound the crawl.
   */
  followInternalLinks?: boolean | { maxPages: number; maxDepth: number };
  /**
   * Explicit additional same-origin routes (absolute URLs) to capture as
   * separate pages, so a client-routed SPA (whose navigation has no `<a href>`
   * for `followInternalLinks` to discover, e.g. TraeWork) still gets real
   * page/route coverage. Deduplicated, each captured as an entry state.
   */
  routes?: string[];
}

export interface CaptureOutcome {
  packagePath: string;
  states: number;
  transitions: number;
  assets: number;
  warnings: string[];
  /** Top-level page loads performed during exploration (P1-1 metric). */
  pageLoads: number;
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
    ...(config.fullPage !== undefined ? { fullPage: config.fullPage } : {}),
    ...(config.responsiveViewports !== undefined
      ? { responsiveViewports: config.responsiveViewports }
      : {}),
    ...(config.scrolledDepths !== undefined ? { scrolledDepths: config.scrolledDepths } : {}),
    maxStates: config.maxStates ?? DEFAULT_EXPLORE_OPTIONS.maxStates,
    maxTransitions: config.maxTransitions ?? DEFAULT_EXPLORE_OPTIONS.maxTransitions,
    maxDepth: config.maxDepth ?? DEFAULT_EXPLORE_OPTIONS.maxDepth,
    timeBudgetMs: config.timeBudgetMs ?? DEFAULT_EXPLORE_OPTIONS.timeBudgetMs,
  };

  const session = await launchSession(viewport, {
    verbose: config.verbose,
    connectCDP: config.connectCDP,
  });
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

  const captureState = async (
    fingerprint: string,
    pageId: string = 'page-1',
  ): Promise<CapturedStateEvidence> => {
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
    // Atomic DOM + fingerprint capture (evidence self-consistency): the DOM
    // snapshot and the fingerprint signals are collected in the SAME JS turn,
    // so the frozen dom.html can never contradict the recorded fingerprint.
    // (Separate evaluates left a mutation window on live SPAs: timers/lazy
    // content changed the DOM between the fingerprint moment and the
    // serialization, producing golden references no faithful replica could
    // ever reproduce. GOAL TraeWork benchmark root-cause fix.)
    const atomic = await page.evaluate(atomicStateCapture, [
      page.url(),
      { width: actualViewport.width, height: actualViewport.height },
      layout.scroll,
    ] as [string, { width: number; height: number }, import('../contracts.js').ScrollPosition]);
    fingerprint = fingerprintString(atomic.signals);

    const screenshot = await page.screenshot({ type: 'png' });
    const fullpage = exploreOptions.fullPage
      ? await page.screenshot({ type: 'png', fullPage: true })
      : undefined;

    const dom = atomic.dom;
    const title = atomic.title;

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
      pageId,
      url: page.url(),
      title,
      viewport: actualViewport,
      scroll: layout.scroll,
      artifacts: {
        screenshot,
        fullpage,
        dom,
        computedStyles,
        accessibility,
        har: harCollector.snapshot() as unknown as Record<string, unknown>,
      },
      health: classifyStateHealth(dom, title),
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

    // Golden-Reference validity gate (GOAL-005 P0-2): surface any captured
    // state that is an error/challenge/empty page so the operator does not
    // silently freeze a useless screenshot as authoritative evidence.
    for (const s of allStates) {
      if (s.health && s.health !== 'ok') {
        warnings.push(`state ${s.id} health=${s.health} (${s.url}) — not a valid Golden Reference`);
      }
    }

    // Anti-bot / WAF / challenge gate (GOAL-006 P1-2): if the *entry* document
    // is a security-challenge / error / empty page, refuse to freeze it. We
    // never freeze a challenge page as if it were real evidence.
    if (config.blockOnInvalidEntry !== false) {
      const entry = allStates[0];
      if (entry && entry.health && entry.health !== 'ok') {
        throw new CaptureBlockedError(
          entry.health,
          `entry document for ${url} classified as '${entry.health}' (${entry.title ?? 'no title'}) — refusing to freeze a non-real page`,
        );
      }
    }

    for (const t of result.transitions) {
      transitions.push({
        id: t.id,
        from: t.from,
        action: t.action,
        to: t.to,
      });
    }
    warnings.push(...result.warnings);
    for (const s of result.skipped) {
      if (s.count > 0) warnings.push(`skipped ${s.count} × ${s.reason}`);
    }

    // ---- GOAL-007 P2-3: optional multi-route capture ----------------------
    // When enabled, discover bounded internal same-origin route links from the
    // entry route and record an entry-state page per discovered route, so the
    // evidence package has a real pages/routes index rather than a single `/`.
    const extraPages: {
      page: { id: string; url: string; route: string; title?: string };
      states: CapturedStateEvidence[];
    }[] = [];
    // Explicit routes (from `config.routes`) plus routes discovered from the
    // entry DOM's internal `<a href>` links (--follow). Unified so a client-
    // routed SPA (no discoverable anchors) and a classic multi-page site both
    // produce a real pages/routes index.
    const explicitRoutes = (config.routes ?? [])
      .map((r) => {
        try {
          return new URL(r, sourceOrigin).origin === sourceOrigin ? r : null;
        } catch {
          return null;
        }
      })
      .filter((r): r is string => !!r);
    let discoveredRoutes: string[] = [];
    if (config.followInternalLinks) {
      const crawlOpts =
        typeof config.followInternalLinks === 'object'
          ? config.followInternalLinks
          : { maxPages: 5, maxDepth: 1 };
      const entryDom = allStates[0]?.artifacts.dom ?? '';
      discoveredRoutes = discoverInternalRoutes(entryDom, sourceOrigin, crawlOpts.maxPages);
    }
    const route = routeOf(url);
    const routeSet = new Set<string>(); // preserves order, dedupes
    for (const r of [...explicitRoutes, ...discoveredRoutes]) {
      if (routeOf(r) !== route) routeSet.add(r);
    }
    let pageSeq = 2;
    for (const targetRoute of routeSet) {
      const pageId = `page-${pageSeq++}`;
      try {
        await page.goto(targetRoute, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        harCollector.reset();
        const state = await captureState('', pageId);
        // Assign a deterministic id so the page's entry state is addressable.
        state.id = `state-rt-${sha256Hex(targetRoute).slice(0, 10)}`;
        extraPages.push({
          page: {
            id: pageId,
            url: targetRoute,
            route: routeOf(targetRoute),
            title: state.title,
          },
          states: [state],
        });
        warnings.push(`followed internal route ${targetRoute} (${pageId})`);
      } catch {
        warnings.push(`failed to follow internal route ${targetRoute}`);
      }
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
      extraPages,
    });

    return {
      packagePath: config.out,
      states: allStates.length,
      transitions: transitions.length,
      assets: assetMap.size,
      warnings,
      pageLoads: result.pageLoads,
    };
  } finally {
    stopObserving();
    harCollector.detach();
    await session.close();
  }
}

/**
 * Discover bounded internal same-origin route links from a serialized DOM
 * (GOAL-007 P2-3). Returns absolute URLs of internal navigation targets
 * (same-origin, non-anchor, non-static-asset), deduplicated and capped at
 * `maxRoutes`. Used to build a real pages/routes index for multi-page sites.
 */
export function discoverInternalRoutes(
  dom: string,
  sourceOrigin: string,
  maxRoutes: number,
): string[] {
  const seen = new Set<string>();
  const routes: string[] = [];
  const anchorRe = /<a\b[^>]*\bhref=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(dom)) !== null) {
    const raw = m[1];
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:'))
      continue;
    let u: URL;
    try {
      u = new URL(raw, sourceOrigin);
    } catch {
      continue;
    }
    if (u.origin !== sourceOrigin) continue;
    // Skip obvious static-asset / download links.
    if (
      /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|mp4|webm|zip|pdf|json)$/i.test(u.pathname)
    ) {
      continue;
    }
    if (u.hash && u.pathname === '/') continue; // pure in-page anchor to root
    const key = u.origin + u.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push(u.origin + u.pathname + (u.search ? u.search : ''));
    if (routes.length >= maxRoutes) break;
  }
  return routes;
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

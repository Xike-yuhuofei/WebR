/**
 * Offline Validator (`docs/architecture/01` §3, `04-VALIDATION-CONTRACT.md`)
 * — Phase 6.
 *
 * Runs the reconstructed replica locally, enforces source-origin isolation,
 * replays recorded transitions, captures actual screenshots and compares them
 * to Golden References via visual diff. Never contacts the source website.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { lookup } from './mime.js';
import { chromium, type Browser, type Page } from 'playwright';
import { readPackage } from '../packageIO.js';
import type { EvidencePackage, StateRecord, Transition, ActionTarget } from '../contracts.js';
import { routeKeyFor, captureIndex } from '../reconstruct/adapter.js';
import { collectFingerprintSignals, fingerprintString } from '../capture/fingerprint.js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Local replica server (static file serving, no framework)
// ---------------------------------------------------------------------------

export interface ReplicaServer {
  /** Base URL, e.g. http://127.0.0.1:PORT */
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Start a local static server for the replica root. */
export async function startReplicaServer(root: string, port = 0): Promise<ReplicaServer> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    // Path-safety: never serve files outside root.
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const abs = resolve(join(root, rel));
    if (!abs.startsWith(resolve(root))) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const { stat: statFile } = await import('node:fs/promises');
      const info = await statFile(abs);
      // Serve directory indexes so route links like `/about` resolve to
      // `/about/index.html` (the reconstructed replica uses real routes).
      if (info.isDirectory()) {
        const index = join(abs, 'index.html');
        const data = await readFile(index);
        res.writeHead(200, { 'content-type': mimeForPath(index) });
        res.end(data);
        return;
      }
      const data = await readFile(abs);
      res.writeHead(200, { 'content-type': mimeForPath(abs) });
      res.end(data);
    } catch {
      res.writeHead(404).end('Not Found');
    }
  });

  await new Promise<void>((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
  const actualPort = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

function mimeForPath(p: string): string {
  return lookup(extname(p)) ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Browser isolation monitor
// ---------------------------------------------------------------------------

export interface IsolationViolation {
  url: string;
  sourceOrigin: string;
}

/**
 * Attach a request monitor that flags any request to the original source
 * origin. Returns collected violations (offline-isolation is a hard failure).
 *
 * Retained for a narrow, source-origin-specific check. The validator itself
 * uses the stricter {@link monitorNetworkIsolation}, because requirement
 * GOAL-003 is that *any* non-local network access — CDN, third-party fonts,
 * analytics, arbitrary external APIs — is an offline-isolation violation,
 * not merely a request to the captured origin.
 */
export function monitorIsolation(page: Page, sourceOrigin: string): IsolationViolation[] {
  const violations: IsolationViolation[] = [];
  page.on('request', (req) => {
    try {
      const u = new URL(req.url());
      if (u.origin === sourceOrigin) {
        violations.push({ url: req.url(), sourceOrigin });
      }
    } catch {
      // ignore non-URL requests
    }
  });
  return violations;
}

/**
 * Attach a request monitor that flags ANY HTTP(S) request whose origin is not
 * in `allowedOrigins`. Only the local replica origin is allowed; any external
 * HTTP(S) request (CDN, fonts, analytics, API, other hosts) is recorded as a
 * hard failure. Non-HTTP schemes (`data:`, `blob:`, `file:`, `about:`) and
 * opaque URLs are ignored — they make no network round-trip.
 */
export function monitorNetworkIsolation(
  page: Page,
  allowedOrigins: ReadonlySet<string>,
): IsolationViolation[] {
  const violations: IsolationViolation[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!/^https?:/i.test(url)) return; // local/synthetic, no network access
    try {
      const u = new URL(url);
      const origin = u.origin;
      if (origin && !allowedOrigins.has(origin)) {
        violations.push({ url, sourceOrigin: origin });
      }
    } catch {
      // ignore malformed URLs
    }
  });
  return violations;
}

// ---------------------------------------------------------------------------
// Visual diff (pixelmatch + pngjs)
// ---------------------------------------------------------------------------

export interface VisualComparison {
  stateId: string;
  expectedPath: string;
  actualPath: string;
  diffPath: string;
  diffPixels: number;
  totalPixels: number;
  /** Fraction of changed pixels 0..1 */
  diffRatio: number;
  passed: boolean;
}

export interface VisualOptions {
  /** Max allowed changed-pixel ratio (0..1) before a comparison fails. */
  threshold: number;
  /** Max allowed anti-aliasing/dithering tolerance passed to pixelmatch. */
  pixelmatchThreshold: number;
  /**
   * Optional regions (in the normalized comparison canvas) to exclude from the
   * diff — e.g. animation cradles, live counters, cursor/caret regions. Pixels
   * inside a mask are forced identical on both images before comparing, so
   * they never count toward diffRatio. Optional; does not loosen the default.
   */
  mask?: Rectangle[];
  /**
   * Optional per-content-class acceptance threshold. When a caller tags the
   * comparison with a `contentClass`, this lookup may tighten/loosen that
   * class's threshold explicitly. The GLOBAL default `threshold` is unchanged
   * (never loosened). Optional.
   */
  thresholdsByClass?: Record<string, number>;
}

/** Axis-aligned rectangular region (CSS pixel coordinates) used for masking. */
export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_VISUAL_OPTIONS: VisualOptions = {
  threshold: 0.03,
  pixelmatchThreshold: 0.1,
};

/**
 * Nearest-neighbour resize of a decoded PNG to `w`×`h`. Used to compare
 * Golden References that were captured at a different viewport than the
 * replica's actual screenshot.
 */
function resizePng(src: PNG, w: number, h: number): PNG {
  if (src.width === w && src.height === h) return src;
  const dst = new PNG({ width: w, height: h });
  const srcW = src.width;
  const srcH = src.height;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / w));
      const si = (sy * srcW + sx) * 4;
      const di = (y * w + x) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

/**
 * Compare two PNG buffers and write a diff PNG. Returns comparison metrics.
 *
 * Masking (P2-1): any pixel inside a configured mask region is copied from
 * `expected` to `actual` before the diff, so it cannot contribute to
 * `diffRatio`. This lets callers exclude animation cradles / live counters /
 * cursors without loosening the global threshold.
 */
export async function compareScreenshots(
  expectedPng: Buffer,
  actualPng: Buffer,
  diffOutPath: string,
  options: VisualOptions,
  contentClass?: string,
): Promise<Omit<VisualComparison, 'stateId' | 'expectedPath' | 'actualPath'>> {
  const expectedRaw = PNG.sync.read(expectedPng);
  const actualRaw = PNG.sync.read(actualPng);

  // Normalize to a common size: the larger of the two, so a resize never
  // discards observable content.
  const width = Math.max(expectedRaw.width, actualRaw.width);
  const height = Math.max(expectedRaw.height, actualRaw.height);
  const expected = resizePng(expectedRaw, width, height);
  const actual = resizePng(actualRaw, width, height);
  const diff = new PNG({ width, height });

  const { mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(diffOutPath), { recursive: true });

  // Apply masks: force masked pixels identical so they never count as a diff.
  for (const rect of options.mask ?? []) {
    const x0 = Math.max(0, Math.floor(rect.x));
    const y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(width, Math.ceil(rect.x + rect.width));
    const y1 = Math.min(height, Math.ceil(rect.y + rect.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        actual.data[i] = expected.data[i];
        actual.data[i + 1] = expected.data[i + 1];
        actual.data[i + 2] = expected.data[i + 2];
        actual.data[i + 3] = expected.data[i + 3];
      }
    }
  }

  const diffPixels = pixelmatch(expected.data, actual.data, diff.data, width, height, {
    threshold: options.pixelmatchThreshold,
  });
  await import('node:fs/promises').then((fs) => fs.writeFile(diffOutPath, PNG.sync.write(diff)));
  const totalPixels = width * height;
  const diffRatio = totalPixels > 0 ? diffPixels / totalPixels : 1;
  // Per-content-class threshold is an explicit caller choice; the GLOBAL default
  // threshold is never loosened. When no class mapping applies, use `threshold`.
  const effectiveThreshold =
    contentClass && options.thresholdsByClass?.[contentClass] !== undefined
      ? options.thresholdsByClass![contentClass]
      : options.threshold;
  return {
    diffPixels,
    totalPixels,
    diffRatio,
    diffPath: diffOutPath,
    passed: diffRatio <= effectiveThreshold,
  };
}

// ---------------------------------------------------------------------------
// Structural / layout comparison (V-6)
// ---------------------------------------------------------------------------

/**
 * Extract a bounded set of semantic structural signals from serialized HTML:
 * document title and heading outline. Used to compare the replica's DOM
 * against captured evidence without needing the source site.
 */
export function structuralSignalsFromDom(dom: string): { title: string; headings: string[] } {
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(dom);
  const title = titleMatch ? titleMatch[1].trim() : '';
  const headings: string[] = [];
  for (const m of dom.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (text) headings.push(text);
  }
  return { title, headings };
}

/**
 * Compare the captured expected DOM with the actual replica DOM for the
 * state. Missing expected signals are failures; unexpected signals are only
 * informational (a faithful replica may legitimately contain more).
 */
export function compareStructure(
  expectedDom: string,
  actualDom: string,
  stateId: string,
): StructuralComparison {
  const expected = structuralSignalsFromDom(expectedDom);
  const actual = structuralSignalsFromDom(actualDom);
  const missingExpected: string[] = [];
  if (expected.title && expected.title !== actual.title) {
    missingExpected.push(`title "${expected.title}"`);
  }
  for (const h of expected.headings) {
    if (!actual.headings.includes(h)) missingExpected.push(`heading "${h}"`);
  }
  return {
    stateId,
    missingExpected,
    unexpected: [],
    passed: missingExpected.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Validator orchestration
// ---------------------------------------------------------------------------

export type ValidationProfile = 'smoke' | 'standard' | 'full';

export interface ValidateOptions {
  /** Validation profile selecting which states/transitions to test. */
  profile: ValidationProfile;
  /** Visual comparison options. */
  visual: VisualOptions;
  /** Port for the local replica server (0 = ephemeral). */
  port?: number;
  /** Write diff artifacts under this directory (defaults to replica/.webr-diffs). */
  diffDir?: string;
  /**
   * Additional HTTP(S) origins allowed during validation. The replica's own
   * local origin is always allowed; any other origin is an isolation
   * violation. Tests/local tooling may add explicit localhost origins.
   */
  allowedOrigins?: string[];
  /**
   * When true, collect a per-transition replay trace and write it to
   * `<diffDir>/replay-trace.json` (GOAL-007 P2-4, V-8). Off by default for
   * backward compatibility; the report's `traces` field is populated only when
   * enabled.
   */
  captureTraces?: boolean;
}

export const DEFAULT_VALIDATE_OPTIONS: ValidateOptions = {
  profile: 'standard',
  visual: DEFAULT_VISUAL_OPTIONS,
};

export interface StructuralComparison {
  stateId: string;
  /** Key semantic elements present in expected DOM but missing from actual. */
  missingExpected: string[];
  /** Elements present in actual but not in expected (ignored if loose). */
  unexpected: string[];
  passed: boolean;
}

/** Per-transition replay trace (GOAL-007 P2-4, V-8). */
export interface TransitionTrace {
  transitionId: string;
  from: string;
  to: string;
  type: string;
  targetValue: string;
  passed: boolean;
  detail: string;
}

export interface ValidationReport {
  success: boolean;
  profile: ValidationProfile;
  isolation: { passed: boolean; violations: IsolationViolation[] };
  states: { tested: number; passed: number; failed: number };
  transitions: { tested: number; passed: number; failed: number };
  visual: { comparisons: VisualComparison[] };
  structural: { comparisons: StructuralComparison[] };
  failures: string[];
  warnings: string[];
  /** Per-transition replay traces when `captureTraces` is enabled (P2-4). */
  traces?: TransitionTrace[];
}

interface SerializableReport {
  success: boolean;
  profile: ValidationProfile;
  isolation: { passed: boolean; violations: IsolationViolation[] };
  states: { tested: number; passed: number; failed: number };
  transitions: { tested: number; passed: number; failed: number };
  visual: { comparisons: VisualComparison[] };
  structural: { comparisons: StructuralComparison[] };
  failures: string[];
  warnings: string[];
  traces?: TransitionTrace[];
}

/** Select the state ids to test for a profile. */
export function selectStates(pkg: EvidencePackage, profile: ValidationProfile): StateRecord[] {
  const states = [...pkg.states];
  if (profile === 'smoke') return states.slice(0, 1);
  if (profile === 'standard') return states.slice(0, Math.min(5, states.length));
  return states;
}

/** Select the transitions to test for a profile. */
export function selectTransitions(pkg: EvidencePackage, profile: ValidationProfile): Transition[] {
  const t = [...pkg.stateGraph.transitions];
  if (profile === 'smoke') return t.slice(0, 1);
  if (profile === 'standard') return t.slice(0, Math.min(10, t.length));
  return t;
}

// ---------------------------------------------------------------------------
// Observable-state machinery (GOAL-002)
//
// A transition only counts as successful if, after executing its action, the
// replica's *actual observable state* matches the transition's destination
// state — performing the action without a side effect on the DOM is a failure.
// ---------------------------------------------------------------------------

function stateById(pkg: EvidencePackage, id: string): StateRecord | undefined {
  return pkg.states.find((s) => s.id === id);
}

/** Local URL that serves the reconstructed document for a route key. */
function routeUrl(serverUrl: string, route: string): string {
  return route === '/' ? `${serverUrl}/` : `${serverUrl}${route}/`;
}

async function applyViewport(
  page: Page,
  vp: { width: number; height: number } | undefined,
): Promise<void> {
  if (!vp) return;
  const cur = page.viewportSize();
  if (cur && cur.width === vp.width && cur.height === vp.height) return;
  await page.setViewportSize({ width: vp.width, height: vp.height });
}

async function scrollTo(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(([px, py]) => window.scrollTo(px || 0, py || 0), [x, y]);
}

/**
 * Compute the replica's current observable fingerprint (route + viewport +
 * scroll + DOM structural signals). `ctx` lets callers compare DOM structure
 * at a fixed viewport/scroll regardless of the current one, so the check
 * asserts the *state* the action produced rather than transient scroll
 * quantization.
 */
export async function observeFingerprint(
  page: Page,
  ctx?: { viewport?: { width: number; height: number }; scroll?: { x: number; y: number } },
): Promise<string> {
  const layout = await page.evaluate(() => ({
    url: window.location.href,
    vw: window.innerWidth,
    vh: window.innerHeight,
    scroll: { x: window.scrollX, y: window.scrollY },
  }));
  const viewport = ctx?.viewport ?? { width: layout.vw, height: layout.vh };
  const scroll = ctx?.scroll ?? layout.scroll;
  const signals = await page.evaluate(collectFingerprintSignals, [layout.url, viewport, scroll] as [
    string,
    { width: number; height: number },
    import('../contracts.js').ScrollPosition,
  ]);
  return fingerprintString(signals);
}

/** Build `from → transitions[]` adjacency for BFS path resolution. */
function buildAdjacency(pkg: EvidencePackage): Map<string, Transition[]> {
  const adj = new Map<string, Transition[]>();
  for (const t of pkg.stateGraph.transitions) {
    const list = adj.get(t.from) ?? [];
    list.push(t);
    adj.set(t.from, list);
  }
  return adj;
}

/** BFS shortest transition path from `fromId` to `targetId`, or null. */
export function findPath(
  pkg: EvidencePackage,
  fromId: string,
  targetId: string,
): Transition[] | null {
  if (fromId === targetId) return [];
  const adj = buildAdjacency(pkg);
  const prev = new Map<string, Transition | null>();
  const visited = new Set<string>([fromId]);
  const queue: string[] = [fromId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const t of adj.get(cur) ?? []) {
      if (visited.has(t.to)) continue;
      visited.add(t.to);
      prev.set(t.to, t);
      if (t.to === targetId) {
        // Reconstruct the path.
        const path: Transition[] = [];
        let node: string | null = targetId;
        while (node && prev.has(node) && node !== fromId) {
          const step: Transition = prev.get(node) as Transition;
          path.unshift(step);
          node = step.from;
        }
        return path;
      }
      queue.push(t.to);
    }
  }
  return null;
}

/** Route entry state id: the first-captured state on a route (the reconstructed doc). */
function routeEntryId(pkg: EvidencePackage, route: string): string | undefined {
  let entry: { id: string; idx: number } | undefined;
  for (const s of pkg.states) {
    if (routeKeyFor(s.url) !== route) continue;
    const idx = captureIndex(s.id);
    if (!entry || idx < entry.idx) entry = { id: s.id, idx };
  }
  return entry?.id;
}

/**
 * Strip authored class names from a captured CSS selector while preserving
 * ids, tag names and `:nth-of-type` position. The replay mode matches the
 * exact selector (original classes are present); a REBUILD replica follows
 * `05-SOURCE-CONVENTION` (`wr-*` classes), so the same observable element is
 * resolved by structure instead — id + tag + sibling order must be preserved
 * by the rebuild, class names must not gate replay.
 */
export function stripCssClasses(selector: string): string {
  // Remove `.ClassName` tokens wherever they appear (attached to a tag, e.g.
  // `div.SiteHeader-inner`, or chained, e.g. `button.Tab.is-active`). Pseudo
  // selectors (`:nth-of-type`) begin with `:` and are untouched.
  return selector.replace(/\.([A-Za-z_][\w-]*)/g, '');
}

/**
 * Resolve a captured target, trying its primary locator and ordered
 * alternates so that a REBUILD replica (whose authored class names differ
 * from the captured `wr-*`/vendor classes) can still be targeted. Resolution
 * order is stable-first: id → data-testid → aria/text → structural CSS
 * (class-stripped last). Returns a locator usable by Playwright.
 */
export async function resolveTarget(
  page: Page,
  target: { strategy?: string; value?: string; alternates?: ActionTarget[] } | undefined,
): Promise<string | undefined> {
  if (!target || !target.value) return undefined;
  const candidates: ActionTarget[] = [
    { strategy: target.strategy ?? '', value: target.value },
    ...(target.alternates ?? []),
  ];
  for (const c of candidates) {
    const locator = await resolveCandidate(page, c);
    if (locator) return locator;
  }
  return undefined;
}

/** Resolve a single candidate locator against the live replica. */
async function resolveCandidate(page: Page, candidate: ActionTarget): Promise<string | undefined> {
  const { strategy, value } = candidate;
  if (!value) return undefined;
  try {
    if (strategy === 'text') {
      const loc = page.getByText(value, { exact: false }).first();
      if ((await loc.count()) > 0) return `text=${value}`; // text engine for page.click
    } else if (strategy === 'css' || strategy === 'id' || strategy === 'data-testid') {
      const count = await page.locator(value).count();
      if (count > 0) return value;
      const stripped = stripCssClasses(value);
      if (stripped !== value && (await page.locator(stripped).count()) > 0) return stripped;
    } else {
      if ((await page.locator(value).count()) > 0) return value;
    }
  } catch {
    // invalid locator: try next candidate
  }
  return undefined;
}

/** Outcome of executing a recorded action — granular diagnostics (P1-4). */
export interface ActionOutcome {
  ok: boolean;
  /** Why the action failed, for structured reporting. */
  reason?: 'locator-unresolved' | 'execution-error' | void;
  /** Detail message. */
  detail?: string;
}

/**
 * Execute one recorded action on the live replica, targeting `toState` when
 * needed. Returns granular diagnostics: whether the locator resolved, and
 * whether the action executed successfully. This lets validation distinguish
 * "locator could not be resolved on the replica" (a rebuild/evidence gap) from
 * "the action ran but produced the wrong observable result".
 */
export async function executeAction(
  page: Page,
  action: Transition['action'],
  toState?: StateRecord,
): Promise<ActionOutcome> {
  const target = action.target?.value;
  const resolved = await resolveTarget(page, action.target);
  const use = resolved;
  if (target && !use && !['scroll', 'resize', 'navigate', 'press'].includes(action.type)) {
    // A locator-bearing action that cannot resolve its target: report it as a
    // locator failure rather than a generic execution error.
    return {
      ok: false,
      reason: 'locator-unresolved',
      detail: `${action.type}:${action.target?.strategy}:${action.target?.value}`,
    };
  }
  try {
    switch (action.type) {
      case 'click':
        if (use) await page.click(use, { timeout: 3000 });
        else await page.click('body', { timeout: 3000 });
        break;
      case 'hover':
        if (use) await page.hover(use, { timeout: 3000 });
        else await page.hover('body', { timeout: 3000 });
        break;
      case 'focus':
        await page.focus(use ?? 'body');
        break;
      case 'type':
        await page
          .locator(use ?? 'input')
          .first()
          .fill('WebR test input');
        break;
      case 'press':
        await page.keyboard.press(target ?? 'Enter');
        break;
      case 'scroll':
        if (toState) await scrollTo(page, toState.scroll.x, toState.scroll.y);
        else await scrollTo(page, 0, 600);
        break;
      case 'resize':
        if (toState) await applyViewport(page, toState.viewport);
        break;
      case 'navigate':
        if (toState)
          await page.goto(
            `${page.url().split('/').slice(0, 3).join('/')}${routeKeyFor(toState.url)}/`,
            { waitUntil: 'domcontentloaded' },
          );
        break;
      default:
        return {
          ok: false,
          reason: 'execution-error',
          detail: `unsupported action ${action.type}`,
        };
    }
    await page.waitForTimeout(120);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'execution-error',
      detail: `${action.type}:${(err as Error).message}`,
    };
  }
}

/**
 * Establish the recorded context for a state on the replica: navigate to its
 * route, size/scroll to its context, and (when the state is not the route's
 * entry) replay the shortest transition path to it — verifying each step's
 * observable result against the recorded destination fingerprint.
 */
export async function establishState(
  page: Page,
  serverUrl: string,
  pkg: EvidencePackage,
  stateId: string,
): Promise<void> {
  const target = stateById(pkg, stateId);
  if (!target) throw new Error(`unknown state ${stateId}`);
  const route = routeKeyFor(target.url);
  const entry = routeEntryId(pkg, route);
  await applyViewport(page, target.viewport);
  await page.goto(routeUrl(serverUrl, route), { waitUntil: 'domcontentloaded', timeout: 10_000 });
  await page.waitForTimeout(200);
  if (entry === stateId) {
    await scrollTo(page, target.scroll.x, target.scroll.y);
    await page.waitForTimeout(100);
    return;
  }
  if (!entry) throw new Error(`no entry state for route ${route}`);
  const path = findPath(pkg, entry, stateId);
  if (!path) throw new Error(`no transition path from ${entry} to ${stateId}`);
  for (const step of path) {
    const to = stateById(pkg, step.to);
    const outcome = await executeAction(page, step.action, to);
    if (!outcome.ok) {
      throw new Error(
        `transition ${step.id} action failed during context setup (${outcome.reason ?? 'execution-error'}): ${outcome.detail ?? ''}`,
      );
    }
    await page.waitForTimeout(100);
  }
  await scrollTo(page, target.scroll.x, target.scroll.y);
  await page.waitForTimeout(100);
}

export interface TransitionOutcome {
  /** Whether the action executed and the observable state matched `to`. */
  passed: boolean;
  /** Human detail for reporting. */
  detail: string;
}

/**
 * Replay one transition's action and verify the actual observable state
 * corresponds to `transition.to` (task 4). The action executing is NOT
 * sufficient; the observable fingerprint must match.
 */
export async function replayTransitionVerify(
  page: Page,
  t: Transition,
  pkg: EvidencePackage,
  serverUrl: string,
): Promise<TransitionOutcome> {
  const from = stateById(pkg, t.from);
  const to = stateById(pkg, t.to);
  if (!from || !to) return { passed: false, detail: 'missing from/to state' };
  // Establish the from-state context via real interactions.
  await establishState(page, serverUrl, pkg, t.from);
  const outcome = await executeAction(page, t.action, to);
  if (!outcome.ok) {
    return {
      passed: false,
      detail:
        outcome.reason === 'locator-unresolved'
          ? `locator-unresolved: cannot resolve ${outcome.detail} on the replica`
          : `action-execution-error: ${outcome.detail ?? ''} (${t.action.type}:${t.action.target?.value ?? ''})`,
    };
  }
  await page.waitForTimeout(150);
  // Reproduce the recorded destination context (viewport/scroll) so a
  // transition into a responsive/scroll state is compared where that state
  // actually exists. Then measure the action's effect on the observable
  // state (DOM structure + route). "Action succeeded" is not enough — the
  // observable result must correspond to the recorded destination.
  await applyViewport(page, to.viewport);
  await scrollTo(page, to.scroll.x, to.scroll.y);
  await page.waitForTimeout(100);
  const actual = await observeFingerprint(page);
  return actual === to.fingerprint
    ? { passed: true, detail: 'observable state matches destination' }
    : {
        passed: false,
        detail: `observable state does not match: ${t.action.type}:${t.action.target?.value ?? ''} (${routeKeyFor(from.url)}:${t.from} → ${routeKeyFor(to.url)}:${t.to})`,
      };
}

/**
 * Run the full offline validation. Returns the report; throws on package
 * read failure.
 */
export async function validateReplica(
  evidencePath: string,
  replicaPath: string,
  options: ValidateOptions = DEFAULT_VALIDATE_OPTIONS,
): Promise<ValidationReport> {
  const pkg = await readPackage(evidencePath);

  const report: SerializableReport = {
    success: false,
    profile: options.profile,
    isolation: { passed: true, violations: [] },
    states: { tested: 0, passed: 0, failed: 0 },
    transitions: { tested: 0, passed: 0, failed: 0 },
    visual: { comparisons: [] },
    structural: { comparisons: [] },
    failures: [],
    warnings: [],
  };

  const server = await startReplicaServer(replicaPath, options.port ?? 0);
  const browser: Browser = await chromium.launch({
    headless: true,
    args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const diffDir = options.diffDir ?? join(replicaPath, '.webr-diffs');

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();

    // Offline-isolation monitor: the replica's own local origin is the ONLY
    // origin allowed to be reached over HTTP(S). Any CDN / font / analytics /
    // external-API / other-host request is a hard failure (GOAL-003 req 7).
    const allowedOrigins = new Set<string>([
      new URL(server.url).origin,
      ...(options.allowedOrigins ?? []),
    ]);
    const violations = monitorNetworkIsolation(page, allowedOrigins);

    // Replay transitions on the replica and verify the observable result
    // matches the recorded destination (task 4).
    const transitions = selectTransitions(pkg, options.profile);
    const traces: TransitionTrace[] = [];
    for (const t of transitions) {
      report.transitions.tested += 1;
      try {
        const outcome = await replayTransitionVerify(page, t, pkg, server.url);
        if (outcome.passed) {
          report.transitions.passed += 1;
        } else {
          report.transitions.failed += 1;
          report.failures.push(`transition ${t.id}: ${outcome.detail}`);
        }
        traces.push({
          transitionId: t.id,
          from: t.from,
          to: t.to,
          type: t.action.type,
          targetValue: t.action.target?.value ?? '',
          passed: outcome.passed,
          detail: outcome.detail,
        });
      } catch (err) {
        report.transitions.failed += 1;
        report.failures.push(`transition ${t.id} failed: ${(err as Error).message}`);
        traces.push({
          transitionId: t.id,
          from: t.from,
          to: t.to,
          type: t.action.type,
          targetValue: t.action.target?.value ?? '',
          passed: false,
          detail: (err as Error).message,
        });
      }
    }

    // Golden-state screenshot + structural comparison.
    const states = selectStates(pkg, options.profile);
    for (const state of states) {
      report.states.tested += 1;
      try {
        await establishState(page, server.url, pkg, state.id);
        await page.waitForTimeout(150);
        const actual = await page.screenshot({ type: 'png' });
        const expectedPath = join(evidencePath, 'states', state.id, state.artifacts.screenshot);
        const expected = await readFile(expectedPath);
        const diffPath = join(diffDir, `${state.id}.diff.png`);
        const result = await compareScreenshots(expected, actual, diffPath, options.visual);
        const comparison: VisualComparison = {
          stateId: state.id,
          expectedPath: `states/${state.id}/${state.artifacts.screenshot}`,
          actualPath: `replica/.webr-diffs/${state.id}.actual.png`,
          diffPath: `replica/.webr-diffs/${state.id}.diff.png`,
          diffPixels: result.diffPixels,
          totalPixels: result.totalPixels,
          diffRatio: result.diffRatio,
          passed: result.passed,
        };
        report.visual.comparisons.push(comparison);
        // Also persist the actual screenshot for diagnosis.
        const { writeFile } = await import('node:fs/promises');
        await writeFile(join(diffDir, `${state.id}.actual.png`), actual);

        // V-6 structural/layout comparison against captured DOM (when present).
        const expectedDomPath = state.artifacts.dom;
        if (expectedDomPath) {
          const expectedDom = await readFile(
            join(evidencePath, 'states', state.id, expectedDomPath),
            'utf8',
          );
          const actualDom = await page.content();
          const struct = compareStructure(expectedDom, actualDom, state.id);
          report.structural.comparisons.push(struct);
          if (!struct.passed) {
            report.failures.push(
              `structural mismatch for state ${state.id}: ${struct.missingExpected.join(', ')}`,
            );
          }
        }

        if (result.passed) {
          report.states.passed += 1;
        } else {
          report.states.failed += 1;
          report.failures.push(
            `visual mismatch for state ${state.id} (diff ${(result.diffRatio * 100).toFixed(2)}%)`,
          );
        }
      } catch (err) {
        report.states.failed += 1;
        report.failures.push(`state ${state.id} could not be validated: ${(err as Error).message}`);
      }
    }

    report.isolation.violations = violations;
    report.isolation.passed = violations.length === 0;
    if (!report.isolation.passed) {
      const origins = [...new Set(violations.map((v) => v.sourceOrigin))].join(', ');
      report.failures.push(
        `offline-isolation violation: ${violations.length} non-local HTTP(S) request(s) to ${origins}`,
      );
      for (const v of violations) {
        report.warnings.push(`forbidden external request: ${v.url}`);
      }
    }

    // GOAL-007 P2-4: persist per-transition replay traces when requested.
    if (options.captureTraces) {
      report.traces = traces;
      const { writeFile } = await import('node:fs/promises');
      await writeFile(
        join(diffDir, 'replay-trace.json'),
        JSON.stringify(traces, null, 2) + '\n',
        'utf8',
      );
    }

    // Acceptance: no failures, isolation clean.
    report.success =
      report.failures.length === 0 &&
      report.isolation.passed &&
      report.states.failed === 0 &&
      report.transitions.failed === 0;
  } finally {
    await browser.close();
    await server.close();
  }

  return report;
}

/** Render the human-readable validation report. */
export function renderValidationReport(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push(`success: ${report.success}`);
  lines.push(`profile: ${report.profile}`);
  lines.push(`isolation: ${report.isolation.passed ? 'clean' : 'VIOLATED'}`);
  for (const v of report.isolation.violations) lines.push(`  forbidden request: ${v.url}`);
  lines.push(`states: ${report.states.passed}/${report.states.tested} passed`);
  lines.push(`transitions: ${report.transitions.passed}/${report.transitions.tested} passed`);
  for (const c of report.visual.comparisons) {
    const mark = c.passed ? 'pass' : 'FAIL';
    lines.push(
      `  visual[${mark}] ${c.stateId} diff=${(c.diffRatio * 100).toFixed(2)}% (${c.diffPath})`,
    );
  }
  for (const c of report.structural.comparisons) {
    const mark = c.passed ? 'pass' : 'FAIL';
    lines.push(`  structural[${mark}] ${c.stateId}`);
    for (const m of c.missingExpected) lines.push(`    missing: ${m}`);
  }
  for (const f of report.failures) lines.push(`failure: ${f}`);
  return lines.join('\n');
}

/** Convert a report to the machine-readable JSON shape. */
export function reportToJson(report: ValidationReport): string {
  return JSON.stringify(report, null, 2);
}

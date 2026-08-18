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
import type { EvidencePackage, StateRecord, Transition } from '../contracts.js';
import { buildReconstructionSpec, replicaRouteFor } from '../reconstruct/adapter.js';
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
 */
export async function compareScreenshots(
  expectedPng: Buffer,
  actualPng: Buffer,
  diffOutPath: string,
  options: VisualOptions,
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

  const diffPixels = pixelmatch(expected.data, actual.data, diff.data, width, height, {
    threshold: options.pixelmatchThreshold,
  });
  await import('node:fs/promises').then((fs) => fs.writeFile(diffOutPath, PNG.sync.write(diff)));
  const totalPixels = width * height;
  const diffRatio = totalPixels > 0 ? diffPixels / totalPixels : 1;
  return {
    diffPixels,
    totalPixels,
    diffRatio,
    diffPath: diffOutPath,
    passed: diffRatio <= options.threshold,
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
  const sourceOrigin = pkg.manifest.source.origin;

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

    // Isolation monitor: flag any request to the source origin.
    const violations = monitorIsolation(page, sourceOrigin);

    // Replay transitions on the replica.
    const transitions = selectTransitions(pkg, options.profile);
    for (const t of transitions) {
      report.transitions.tested += 1;
      try {
        await navigateToState(page, server.url, pkg, t.from);
        const ok = await replayTransition(page, t);
        if (ok) {
          report.transitions.passed += 1;
        } else {
          report.transitions.failed += 1;
          report.failures.push(`transition ${t.id} did not reach expected state`);
        }
      } catch (err) {
        report.transitions.failed += 1;
        report.failures.push(`transition ${t.id} failed: ${(err as Error).message}`);
      }
    }

    // Golden-state screenshot + structural comparison.
    const states = selectStates(pkg, options.profile);
    for (const state of states) {
      report.states.tested += 1;
      try {
        await navigateToState(page, server.url, pkg, state.id);
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
      report.failures.push(
        `offline-isolation violation: ${violations.length} request(s) to ${sourceOrigin}`,
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

/** Navigate to the replica page corresponding to a given evidence state. */
async function navigateToState(
  page: Page,
  serverUrl: string,
  pkg: EvidencePackage,
  stateId: string,
): Promise<void> {
  const spec = buildReconstructionSpec(pkg);
  const routeDir = replicaRouteFor(spec, stateId);
  const url = `${serverUrl}/${routeDir}/index.html`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 });
  await page.waitForTimeout(150);
}

/** Replay a single recorded transition action on the replica. */
async function replayTransition(page: Page, t: Transition): Promise<boolean> {
  try {
    const action = t.action;
    const target = action.target?.value;
    switch (action.type) {
      case 'click':
        await page.click(target ?? 'body', { timeout: 3_000 });
        break;
      case 'hover':
        await page.hover(target ?? 'body', { timeout: 3_000 });
        break;
      case 'focus':
        await page.focus(target ?? 'body');
        break;
      case 'type':
        await page.focus(target ?? 'body');
        await page.keyboard.type('WebR validate input');
        break;
      case 'press':
        await page.keyboard.press(target ?? 'Enter');
        break;
      case 'navigate':
        await page.goto(`${page.url().split('/').slice(0, 3).join('/')}/${target}`, {
          waitUntil: 'domcontentloaded',
        });
        break;
      default:
        return false;
    }
    await page.waitForTimeout(100);
    return true;
  } catch {
    return false;
  }
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

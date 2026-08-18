/**
 * Evidence Collector — normalizes live-browser observations into the
 * Evidence Package contract (`docs/architecture/02`).
 *
 * This module runs only during the Capture phase, where source-site access is
 * allowed. Nothing here may be reused by `reconstruct` or `validate`.
 */
import type { Page } from 'playwright';
import type { CaptureMetadata, ScrollPosition, Viewport } from '../contracts.js';

export interface CaptureOptions {
  /** Viewport used for the capture session. */
  viewport: Viewport;
  /** True to also write a full-page screenshot per state. */
  fullPage?: boolean;
  /** True to also write computed-style evidence per state. */
  computedStyles?: boolean;
  /** True to also write accessibility evidence per state. */
  accessibility?: boolean;
  /** True to also write a HAR per state (network evidence). */
  har?: boolean;
}

export interface CapturedStateEvidence {
  id: string;
  pageId: string;
  url: string;
  title?: string;
  viewport: Viewport;
  scroll: ScrollPosition;
  artifacts: {
    screenshot: Buffer;
    fullpage?: Buffer;
    dom: string;
    domJson?: Record<string, unknown>;
    computedStyles?: Record<string, unknown>;
    accessibility?: Record<string, unknown>;
    har?: Record<string, unknown>;
  };
  /** Fingerprint covering DOM structure + computed behavior, see `fingerprint.ts`. */
  fingerprint: string;
}

export interface CapturedAsset {
  id: string;
  originalUrl: string;
  localPath: string;
  mimeType: string;
  sha256: string;
  data: Buffer;
}

export interface CaptureResult {
  metadata: CaptureMetadata;
  page: { id: string; url: string; route: string; title?: string };
  states: CapturedStateEvidence[];
  assets: CapturedAsset[];
  transitions: { from: string; action: unknown; to: string; id: string }[];
  warnings: string[];
}

/** Wait for the page to reach a quiescent, screenshot-ready condition. */
export async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  // Let deferred layouts/animations settle briefly before observing.
  await page.waitForTimeout(400);
}

function parseUrl(url: string): URL {
  return new URL(url);
}

/** Route path for a URL (pathname + search). */
export function routeOf(url: string): string {
  const u = parseUrl(url);
  return u.pathname + (u.search ? `?${u.search}` : '');
}

export interface ResponseObservation {
  url: string;
  status: number;
  mimeType: string;
  body?: Buffer;
  headers: Record<string, string>;
}

/**
 * Attach a network listener that records static-resource responses so the
 * writer can localize them. Returns a teardown function.
 */
export function observeResponses(
  page: Page,
  onResponse: (obs: ResponseObservation) => void,
): () => void {
  const handler = async (response: import('playwright').Response) => {
    try {
      const url = response.url();
      const status = response.status();
      const mimeType = response.headers()['content-type']?.split(';')[0] ?? '';
      // Only body-bearing static resources get localized. Non-200 responses
      // are recorded but not saved as assets.
      const body = await response.body().catch(() => undefined);
      onResponse({ url, status, mimeType, body, headers: response.headers() });
    } catch {
      // Ignore responses that cannot be read (redirects, aborted, etc.).
    }
  };
  page.on('response', handler);
  return () => {
    page.off('response', handler);
  };
}

/**
 * Decide whether a response should be localized as a package asset.
 *
 * Localizes any body-bearing 2xx resource so the reconstruction can run fully
 * offline: same-origin static assets, cross-origin/CDN assets (stylesheets,
 * images, fonts, scripts), and JSON/API payloads. This is what makes it safe
 * to disconnect the source *and* the CDN origins after capture.
 *
 * We deliberately exclude:
 *   - data: URIs (inline, nothing to fetch separately);
 *   - `text/html` documents (the main document is kept as state DOM, and
 *     other HTML documents are content, not reusable resources);
 *   - empty bodies and non-2xx responses.
 */
export function isLocalizableAsset(obs: ResponseObservation): boolean {
  if (!obs.body || obs.body.length === 0) return false;
  if (obs.url.startsWith('data:')) return false;
  if (obs.status < 200 || obs.status >= 300) return false;
  if (obs.mimeType === 'text/html') return false;
  try {
    new URL(obs.url);
  } catch {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Network / HAR evidence (Phase 2 "network/HAR baseline")
// ---------------------------------------------------------------------------

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: { method: string; url: string; httpVersion: string; headers: Record<string, string> };
  response: {
    status: number;
    statusText: string;
    mimeType: string;
    headers: Record<string, string>;
  };
  _resourceType: string;
}

/** A minimal HAR-like log, sufficient for the network/HAR baseline. */
export interface HarLog {
  log: {
    version: '1.2';
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
}

export interface HarCollector {
  /** Snapshot of entries recorded so far. */
  snapshot(): HarLog;
  /** Reset the log (e.g. before a new state capture). */
  reset(): void;
  /** Detach all listeners. */
  detach(): void;
}

/**
 * Attach request/response listeners that build a HAR-like network log for
 * evidence. This is the "network/HAR baseline" deliverable of Phase 2.
 */
export function createHarCollector(page: Page, creatorVersion: string): HarCollector {
  const entries: HarEntry[] = [];
  const startedAt = Date.now();

  const onRequest = (request: import('playwright').Request) => {
    try {
      entries.push({
        startedDateTime: new Date(startedAt + (Date.now() - startedAt)).toISOString(),
        time: -1,
        request: {
          method: request.method(),
          url: request.url(),
          httpVersion: 'HTTP/1.1',
          headers: request.headers(),
        },
        response: { status: 0, statusText: '', mimeType: '', headers: {} },
        _resourceType: request.resourceType(),
      });
    } catch {
      // ignore
    }
  };

  const onResponse = (response: import('playwright').Response) => {
    try {
      const url = response.url();
      const entry = entries.find((e) => e.request.url === url && e.response.status === 0);
      if (!entry) return;
      entry.response = {
        status: response.status(),
        statusText: '',
        mimeType: response.headers()['content-type']?.split(';')[0] ?? '',
        headers: response.headers(),
      };
      entry.time = Date.now() - startedAt;
    } catch {
      // ignore
    }
  };

  page.on('request', onRequest);
  page.on('response', onResponse);

  return {
    snapshot: () => ({
      log: {
        version: '1.2',
        creator: { name: 'webr-capture', version: creatorVersion },
        entries: [...entries],
      },
    }),
    reset: () => {
      entries.length = 0;
    },
    detach: () => {
      page.off('request', onRequest);
      page.off('response', onResponse);
    },
  };
}

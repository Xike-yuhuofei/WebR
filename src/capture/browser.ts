/**
 * Browser session management for the Capture Engine (`docs/architecture/01` §3).
 *
 * Uses Playwright + Chromium (frozen in `00-FROZEN-DECISIONS.md` D-004).
 * Capture is the only phase allowed to access the source website.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { DEFAULT_BROWSER_NAME, type Viewport } from '../contracts.js';

export interface BrowserSessionOptions {
  /** Browser binary channel/executable to launch, defaults to bundled chromium. */
  executablePath?: string;
  /** Emit verbose browser logs to stderr. */
  verbose?: boolean;
  /**
   * When set, connect to an ALREADY-RUNNING Chrome via CDP instead of
   * launching a fresh headless instance. Used to capture an authenticated /
   * login-gated product with the project's Profile Chrome
   * (`docs/architecture/07-BROWSER-POLICY.md`, CDP `http://[::1]:9222`).
   *
   * The captured page is opened in the inspected browser's default context so
   * it inherits the logged-in session. On close we ONLY close that page —
   * never the shared browser (owners may have other tabs open).
   */
  connectCDP?: string;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  browserVersion: string;
  close(): Promise<void>;
}

/**
 * Deterministic media/color preference shim injected on every captured page so
 * screenshots are reproducible regardless of the operating system default.
 */
function reducedMotionInitScript(): string {
  return `() => {
    if ('matchMedia' in window) {
      const mm = window.matchMedia.bind(window);
      const reduced = () => ({ matches: true, media: '(prefers-reduced-motion: reduce)' });
      Object.defineProperty(window, 'matchMedia', {
        value: (q) => (q === '(prefers-reduced-motion: reduce)' ? reduced() : mm(q)),
        configurable: true,
      });
    }
  }`;
}

/**
 * Launch a fresh Chromium session with a clean, deterministic profile.
 * Screenshots/audio/fonts are disabled to keep evidence reproducible.
 */
export async function launchSession(
  viewport: Viewport,
  options: BrowserSessionOptions = {},
): Promise<BrowserSession> {
  // CDP-connected capture: reuse an already-running authenticated Chrome
  // (Profile Chrome, `07-BROWSER-POLICY.md`). Needed when the target product
  // is behind a login that a fresh headless profile cannot see.
  if (options.connectCDP) {
    return connectSession(viewport, options);
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: options.executablePath,
    args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    // Deterministic user agent so evidence does not vary by host environment.
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 WebR-Capture/0.1',
  });

  const page = await context.newPage();
  await page.addInitScript(reducedMotionInitScript());

  const version = await browser.version();
  if (options.verbose) {
    process.stderr.write(`webr: launched ${DEFAULT_BROWSER_NAME} ${version}\n`);
  }

  return {
    browser,
    context,
    page,
    browserVersion: version,
    close: async () => {
      await browser.close();
    },
  };
}

/**
 * Connect to an existing Chrome via CDP (e.g. the authenticated Profile Chrome
 * on `http://[::1]:9222`). Opens a new page in the inspected browser's default
 * context so the captured page inherits the logged-in session. On close only
 * the created page is closed; the shared browser and the user's other tabs are
 * never touched.
 */
async function connectSession(
  viewport: Viewport,
  options: BrowserSessionOptions,
): Promise<BrowserSession> {
  const browser = await chromium.connectOverCDP(options.connectCDP as string);
  const context = (browser.contexts()[0] ?? (await browser.newContext())) as BrowserContext;
  const page = await context.newPage();
  // Size the capture page to the requested viewport (the shared default
  // context keeps its own offset/device-scale-factor, which is intentional).
  await page.setViewportSize({ width: viewport.width, height: viewport.height }).catch(() => {});
  await page.addInitScript(reducedMotionInitScript());

  const version = await browser.version();
  if (options.verbose) {
    process.stderr.write(
      `webr: connected over CDP (${DEFAULT_BROWSER_NAME} ${version}, session reused)\n`,
    );
  }

  return {
    browser,
    context,
    page,
    browserVersion: version,
    close: async () => {
      // ONLY the page we opened is closed. Never `browser.close()` — the
      // inspected Chrome is shared and may own other tabs/sessions.
      await page.close().catch(() => {});
    },
  };
}

export { DEFAULT_BROWSER_NAME };

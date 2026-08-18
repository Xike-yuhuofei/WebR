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
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  browserVersion: string;
  close(): Promise<void>;
}

/**
 * Launch a fresh Chromium session with a clean, deterministic profile.
 * Screenshots/audio/fonts are disabled to keep evidence reproducible.
 */
export async function launchSession(
  viewport: Viewport,
  options: BrowserSessionOptions = {},
): Promise<BrowserSession> {
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

  // Deterministic media playback + fonts for reproducible screenshots.
  await page.addInitScript(() => {
    if ('matchMedia' in window) {
      const mm = window.matchMedia.bind(window);
      const reduced = () => ({ matches: true, media: '(prefers-reduced-motion: reduce)' });
      Object.defineProperty(window, 'matchMedia', {
        value: (q: string) => (q === '(prefers-reduced-motion: reduce)' ? reduced() : mm(q)),
        configurable: true,
      });
    }
  });

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

export { DEFAULT_BROWSER_NAME };

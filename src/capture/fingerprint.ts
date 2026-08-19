/**
 * State fingerprinting (`docs/architecture/01` §5).
 *
 * A fingerprint summarizes the observable browser condition of a state so the
 * State Explorer can deduplicate equivalent states. It must be deterministic
 * across captures of the same page, and change when the observable state
 * changes (DOM structure, text, visibility, focus/overlay, scroll).
 *
 * The fingerprint is computed in-page over a curated, normalized view of the
 * document, so it is stable and bounded regardless of page size.
 */
import { sha256Hex } from '../checksum.js';
import type { ScrollPosition } from '../contracts.js';

export interface FingerprintInput {
  url: string;
  viewport: { width: number; height: number };
  scroll: ScrollPosition;
  /** Active/focused element descriptor, when captured. */
  activeElement?: string | null;
  /** Open overlay/menu/modal descriptors, when captured. */
  openOverlays?: string[];
}

/**
 * Compute a fingerprint from normalized in-page signals. The heavier DOM
 * extraction happens in-page via `collectFingerprintSignals`; this function
 * hashes the resulting canonical string.
 */
export function fingerprintString(signals: string[]): string {
  return `sha256:${sha256Hex(signals.join('\u0000'))}`;
}

/**
 * Self-contained fingerprint signal collector. Designed to run inside
 * `page.evaluate`, it must not reference any module-scope binding (Playwright
 * serializes the function body and executes it in the browser). Arguments are
 * passed as a single array `[url, viewport, scroll]`.
 */
export function collectFingerprintSignals(
  arg: [string, { width: number; height: number }, ScrollPosition],
): string[] {
  const [url, viewport, scroll] = arg;
  const signals: string[] = [];
  // Compare the *route* (pathname + query), not the origin: the replica runs
  // on a different host/port than the captured source, so an origin-sensitive
  // URL signal could never match between capture and validation.
  // Trailing slashes are normalized (`/about/` == `/about`) so that the
  // replica's route URLs (served as `<route>/`) reproduce the same fingerprint
  // as the captured route (`/about`) — a determinism fix, not a laxity change.
  let route = url;
  try {
    const u = new URL(url);
    const pathname = u.pathname.replace(/\/+$/, '') || '/';
    route = pathname + u.search;
  } catch {
    // keep raw url when it cannot be parsed
  }
  signals.push(`url:${route}`);
  signals.push(`viewport:${viewport.width}x${viewport.height}`);
  // Scroll is a positional signal, not an observable *state*: an exact
  // `scrollY` differs by sub-pixel quantization between capture and replay,
  // which produces false transition failures. A coarse on/off discriminator
  // keeps scroll-dependent states distinct (e.g. a scroll-revealed header)
  // while remaining reproducible; exact scroll is recorded separately in
  // each state's metadata for context setup.
  signals.push(`scrolled:${scroll.x > 0 || scroll.y > 0 ? 1 : 0}`);

  if (typeof document === 'undefined') return signals;

  signals.push(`title:${document.title}`);

  const count = new Map<string, number>();
  const visibleInteractive = new Set<string>();
  const hiddenCounts = new Map<string, number>();
  const disabledCounts = new Map<string, number>();

  const walker = document.createTreeWalker(document.body ?? document.documentElement);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      // Ignore reconstructed-replica tracer artifacts so a displayed replica
      // marker never perturbs the observable fingerprint (it is intentionally
      // hidden from view but present in the DOM for structural checks).
      if (el.hasAttribute('data-wr-replica')) {
        node = walker.nextNode();
        continue;
      }
      const tag = el.tagName.toLowerCase();
      count.set(tag, (count.get(tag) ?? 0) + 1);
      const style = getComputedStyle(el);
      const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && !el.hidden;
      if (isVisible) {
        const role = el.getAttribute('role');
        if (
          el.matches?.(
            'a[href],button,input,select,textarea,[contenteditable="true"],[role="button"],[role="menuitem"],[role="tab"]',
          ) ??
          (role && ['button', 'link', 'menuitem', 'tab'].includes(role))
        ) {
          visibleInteractive.add(tag);
        }
      } else {
        hiddenCounts.set(tag, (hiddenCounts.get(tag) ?? 0) + 1);
      }
      if ((el as HTMLButtonElement).disabled === true) {
        disabledCounts.set(tag, (disabledCounts.get(tag) ?? 0) + 1);
      }
    }
    node = walker.nextNode();
  }

  for (const [tag, n] of [...count.entries()].sort()) {
    signals.push(`tag:${tag}=${n}`);
  }
  for (const [tag, n] of [...hiddenCounts.entries()].sort()) {
    signals.push(`hidden:${tag}=${n}`);
  }
  for (const [tag, n] of [...disabledCounts.entries()].sort()) {
    signals.push(`disabled:${tag}=${n}`);
  }
  for (const tag of [...visibleInteractive].sort()) {
    signals.push(`interactive:${tag}`);
  }

  // aria-expanded / aria-hidden / open dialogs (excluding replica tracers)
  let expanded = 0;
  let ariaHidden = 0;
  let dialogs = 0;
  for (const el of document.querySelectorAll<HTMLElement>('[aria-expanded]')) {
    if (el.hasAttribute('data-wr-replica')) continue;
    if (el.getAttribute('aria-expanded') === 'true') expanded += 1;
  }
  for (const el of document.querySelectorAll<HTMLElement>('[aria-hidden]')) {
    if (el.hasAttribute('data-wr-replica')) continue;
    if (el.getAttribute('aria-hidden') === 'true') ariaHidden += 1;
  }
  for (const el of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) {
    if (el.open) dialogs += 1;
  }
  signals.push(`aria-expanded:${expanded}`);
  signals.push(`aria-hidden:${ariaHidden}`);
  signals.push(`open-dialogs:${dialogs}`);

  // active element (focus). Identified by tag only: the focused element's
  // class name is authored-source convention (`wr-*`, `05-SOURCE-CONVENTION`)
  // rather than observable state, so it must not gate replay parity between a
  // captured site and an independently rebuilt replica.
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body) {
    signals.push(`focus:${active.tagName.toLowerCase()}`);
  }

  // Input/textarea values: typing must create an observable, distinct state.
  const namedValues: string[] = [];
  for (const el of document.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >('input,textarea,select')) {
    const name = el.getAttribute('name') ?? el.id ?? el.tagName.toLowerCase();
    let value = '';
    if ('value' in el) value = String(el.value);
    if (el.tagName.toLowerCase() === 'select') value = (el as HTMLSelectElement).value;
    if (value) namedValues.push(`${name}:${value}`);
  }
  for (const v of [...namedValues].sort()) signals.push(`value:${v}`);

  return signals;
}

/** Convenience: full fingerprint for the current page state. */
export async function fingerprintPage(
  page: import('playwright').Page,
  url: string,
  viewport: { width: number; height: number },
  scroll: ScrollPosition,
): Promise<string> {
  const signals = await page.evaluate(collectFingerprintSignals, [url, viewport, scroll] as [
    string,
    { width: number; height: number },
    ScrollPosition,
  ]);
  return fingerprintString(signals);
}

/**
 * Atomic state capture (evidence self-consistency, GOAL TraeWork benchmark).
 *
 * Serializes the DOM AND collects the fingerprint signals in the SAME
 * JavaScript turn, so the frozen `dom.html` and the recorded `fingerprint`
 * are always mutually consistent. On a live SPA, separate `evaluate` calls
 * (signals → screenshot → DOM) leave a mutation window: timers/lazy content
 * can change the DOM between the fingerprint moment and the serialization,
 * producing a Golden Reference whose DOM contradicts its own fingerprint —
 * unreproducible by ANY faithful replica. Executing both in one turn closes
 * the race by construction.
 *
 * The collector's source is embedded via `Function.prototype.toString`
 * (it is self-contained by design); the result carries
 * `{ dom, title, signals }` for the caller to hash and freeze.
 */
export type AtomicStateCapture = (
  arg: [string, { width: number; height: number }, ScrollPosition],
) => { dom: string; title: string; signals: string[] };

export function buildAtomicStateCapture(): AtomicStateCapture {
  const collectorSource = collectFingerprintSignals.toString();
  const fn = new Function(
    'arg',
    `"use strict";
const [url, viewport, scroll] = arg;
const dom = document.documentElement.outerHTML;
const title = document.title;
const collect = (${collectorSource});
const signals = collect([url, viewport, scroll]);
return { dom, title, signals };`,
  ) as AtomicStateCapture;
  return fn;
}

/**
 * Shared atomic-capture instance. Built once; safe to pass to
 * `page.evaluate` (Playwright serializes the function source).
 */
export const atomicStateCapture = buildAtomicStateCapture();

/**
 * State Explorer (`docs/architecture/01` §3).
 *
 * Discovers interactive elements, executes bounded actions, fingerprints and
 * deduplicates observable states, and records transitions for the UI State
 * Graph. Prioritizes interaction coverage over brute-force enumeration.
 */
import type { Page } from 'playwright';
import { sha256Hex } from '../checksum.js';
import type { ActionType, ScrollPosition, Viewport } from '../contracts.js';
import type { CapturedStateEvidence, CaptureOptions } from '../capture/collector.js';
import { collectFingerprintSignals, fingerprintString } from '../capture/fingerprint.js';

export interface ExploreOptions extends CaptureOptions {
  /** Maximum number of distinct states to explore. */
  maxStates: number;
  /** Maximum transitions to record. */
  maxTransitions: number;
  /** Maximum exploration depth (BFS depth) from the root state. */
  maxDepth: number;
  /** Maximum time budget in ms. */
  timeBudgetMs: number;
}

export const DEFAULT_EXPLORE_OPTIONS: ExploreOptions = {
  viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  maxStates: 40,
  maxTransitions: 120,
  maxDepth: 6,
  timeBudgetMs: 120_000,
  fullPage: true,
  computedStyles: true,
  accessibility: true,
};

export interface DiscoveredAction {
  type: ActionType;
  /** A stable, reproducible locator for replay. */
  target: { strategy: 'css'; value: string } | { strategy: 'text'; value: string };
  /** Human-readable label for logs/tracing. */
  label: string;
  /** Whether the target is keyboard-only (input/textarea/select). */
  keyboard?: boolean;
}

export interface ExploreTransition {
  id: string;
  from: string;
  action: DiscoveredAction;
  to: string;
}

export interface ExploreResult {
  states: CapturedStateEvidence[];
  transitions: ExploreTransition[];
  /** Map state id → sequence of transitions to reach it from root. */
  pathTo: Map<string, ExploreTransition[]>;
  warnings: string[];
  exploredCount: number;
  skipped: { reason: string; count: number }[];
}

/** Stable transition id derived from source + action + destination. */
export function transitionId(
  from: string,
  actionType: ActionType,
  label: string,
  to: string,
): string {
  return `transition-${sha256Hex(`${from}|${actionType}|${label}|${to}`).slice(0, 12)}`;
}

/**
 * Discover the interactive elements currently present in the page and the
 * actions worth exploring for each. Deduplicated by normalized selector so the
 * same logical element is not explored repeatedly.
 */
export async function discoverActions(page: Page): Promise<DiscoveredAction[]> {
  const actions = await page.evaluate(() => {
    const out: DiscoveredAction[] = [];
    const seen = new Set<string>();

    const selectors =
      'a[href],button,[role="button"],input,select,textarea,[role="menuitem"],[role="tab"],[role="link"],[contenteditable="true"],summary';

    // Build a stable, ideally unique CSS selector for an element. Preferring
    // id, otherwise a structural path (tag + class + nth-of-type). A text
    // locator is ambiguous (e.g. the same label in both the desktop nav and
    // the hidden mobile menu), so we only fall back to text when no stable
    // selector is computable.
    const stableSelector = (el: Element): string | null => {
      const idOf = (e: Element): string => (e as HTMLElement).id;
      if (idOf(el)) return `#${CSS.escape(idOf(el))}`;
      const parts: string[] = [];
      let node: Element | null = el;
      while (node) {
        const tag = node.tagName.toLowerCase();
        const id = idOf(node);
        if (id) {
          parts.unshift(`#${CSS.escape(id)}`);
          break;
        }
        let sel = tag;
        const cls = Array.from(node.classList)
          .slice(0, 3)
          .map((c) => `.${CSS.escape(c)}`)
          .join('');
        if (cls) sel += cls;
        const parent: Element | null = node.parentElement;
        if (parent) {
          const cur: Element = node;
          const sameTag: Element[] = Array.from(parent.children).filter(
            (c: Element) => c.tagName === cur.tagName,
          );
          if (sameTag.length > 1) {
            const nth = sameTag.indexOf(cur) + 1;
            sel += `:nth-of-type(${nth})`;
          }
        }
        parts.unshift(sel);
        if (parts.length > 8) break;
        node = parent;
      }
      return parts.join(' > ');
    };

    const add = (el: Element, type: ActionType, label?: string) => {
      const selector = stableSelector(el) ?? '';
      const key = type + ':' + selector;
      if (seen.has(key)) return;
      seen.add(key);
      const target = selector
        ? { strategy: 'css' as const, value: selector }
        : {
            strategy: 'text' as const,
            value: (el.textContent ?? '').trim().slice(0, 60) || el.tagName.toLowerCase(),
          };
      out.push({
        type,
        target,
        label:
          label ??
          `${type}:${(el.textContent ?? '').trim().slice(0, 40) || el.tagName.toLowerCase()}`,
      });
    };

    for (const el of document.querySelectorAll<HTMLElement>(selectors)) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const tag = el.tagName.toLowerCase();
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      if (tag === 'a' || tag === 'summary' || el.getAttribute('role') === 'link') {
        add(el, 'click');
      } else if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        el.getAttribute('role') === 'textbox'
      ) {
        add(el, 'focus');
        const input = el as HTMLInputElement;
        if ((tag === 'input' && input.type !== 'hidden') || tag === 'textarea') {
          add(el, 'type', `type:${input.type ?? 'text'}:${input.name ?? input.id ?? 'field'}`);
        }
      } else if (
        tag === 'button' ||
        el.getAttribute('role') === 'button' ||
        el.getAttribute('role') === 'menuitem' ||
        el.getAttribute('role') === 'tab'
      ) {
        add(el, 'click');
      }
    }

    // Hover discovery: find elements that reveal content on hover (menu
    // triggers). We scan stylesheets for `:hover` rules (hover-dependent
    // layout/visibility) and also accept `aria-haspopup`/`[data-menu]`
    // triggers. The hovered element is the selector segment before the first
    // `:hover`.
    const hoverSelectors = new Set<string>();
    for (const sheet of document.styleSheets) {
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin/opaque stylesheet: unreadable, skip
      }
      if (!rules) continue;
      const queue: CSSRule[] = Array.from(rules);
      while (queue.length) {
        const rule = queue.shift()!;
        if ('cssRules' in rule) queue.push(...Array.from((rule as CSSGroupingRule).cssRules));
        if (rule instanceof CSSStyleRule && rule.selectorText.includes(':hover')) {
          const trigger = /([^{,]+):hover/.exec(rule.selectorText);
          if (trigger && trigger[1].trim()) hoverSelectors.add(trigger[1].trim());
        }
      }
    }
    for (const sel of hoverSelectors) {
      try {
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          if (!(el.id || el.getAttribute('data-wr-evidence'))) continue;
          add(el, 'hover', `hover:${sel}`);
        }
      } catch {
        // invalid selector: ignore
      }
    }
    if (!seen.has('hover:aria-haspopup')) {
      for (const el of document.querySelectorAll<HTMLElement>('[aria-haspopup]')) {
        const vs = getComputedStyle(el);
        if (vs.display === 'none' || vs.visibility === 'hidden') continue;
        add(el, 'hover', 'hover:aria-haspopup');
      }
    }

    // Viewport-level actions: scroll (document) and resize (responsive state).
    // These are captured as evidence targets so replay can reproduce them.
    const docScrollable =
      document.documentElement.scrollHeight > window.innerHeight ||
      document.body.scrollHeight > window.innerHeight;
    if (docScrollable && !seen.has('scroll:document')) {
      seen.add('scroll:document');
      out.push({
        type: 'scroll',
        target: { strategy: 'css', value: 'document' },
        label: 'scroll:document',
      });
    }
    // A bounded resize probe for responsive evidence.
    if (!seen.has('resize:viewport')) {
      seen.add('resize:viewport');
      out.push({
        type: 'resize',
        target: { strategy: 'css', value: 'viewport' },
        label: 'resize:viewport',
      });
    }

    return out as DiscoveredAction[];
  });

  return actions;
}

export interface ExploreContext {
  page: Page;
  viewport: Viewport;
  url: string;
  scroll: ScrollPosition;
}

/**
 * Execute a discovered action and return true if the page changed meaningfully
 * (a new fingerprint would be produced by a subsequent capture). The caller
 * captures the post-action state separately.
 */
export async function performAction(
  page: Page,
  action: DiscoveredAction,
): Promise<{ ok: boolean; warning?: string }> {
  try {
    switch (action.type) {
      case 'click':
        await page.click(action.target.value, { timeout: 3_000 }).catch(async () => {
          // text-strategy fallback
          await page.click(`text=${action.target.value}`, { timeout: 3_000 });
        });
        break;
      case 'focus':
        await page.focus(action.target.value);
        break;
      case 'hover':
        await page.hover(action.target.value, { timeout: 3000 }).catch(async () => {
          await page.hover(`text=${action.target.value}`, { timeout: 3000 });
        });
        break;
      case 'type':
        await page.focus(action.target.value).catch(() => {});
        await page
          .locator(action.target.value)
          .first()
          .fill('WebR test input')
          .catch(async () => {
            await page.locator(`text=${action.target.value}`).first().fill('WebR test input');
          });
        break;
      case 'press':
        await page.keyboard.press(action.target.value as never);
        break;
      case 'scroll':
        await page.evaluate(() => {
          const el = document.scrollingElement ?? document.documentElement;
          if (el.scrollHeight > el.clientHeight) {
            window.scrollTo(0, Math.min(el.scrollHeight, el.clientHeight * 0.8));
          }
        });
        break;
      case 'resize':
        // Deterministic responsive probe: half the current viewport width.
        await page.setViewportSize({
          width: Math.max(320, Math.floor((page.viewportSize()?.width ?? 1024) / 2)),
          height: page.viewportSize()?.height ?? 768,
        });
        break;
      default:
        return { ok: false, warning: `action ${action.type} not supported yet` };
    }
    await page.waitForTimeout(250);
    return { ok: true };
  } catch (err) {
    return { ok: false, warning: (err as Error).message };
  }
}

/**
 * Run bounded breadth-first exploration starting from the root state.
 * Captures each discovered state and records transitions. Loop-safe: states
 * are deduplicated by fingerprint, and budgets (states/transitions/depth/time)
 * bound the exploration.
 */
export async function explore(
  ctx: ExploreContext,
  captureState: (fingerprint: string) => Promise<CapturedStateEvidence>,
  options: ExploreOptions,
): Promise<ExploreResult> {
  const warnings: string[] = [];
  const skipped: { reason: string; count: number }[] = [];
  const recordSkip = (reason: string) => {
    const entry = skipped.find((s) => s.reason === reason);
    if (entry) entry.count += 1;
    else skipped.push({ reason, count: 1 });
  };

  const start = Date.now();
  const withinBudget = () => Date.now() - start < options.timeBudgetMs;

  // State id is content-derived from the fingerprint for determinism.
  const stateIdFor = (fp: string, seq: number): string => {
    const h = sha256Hex(fp).slice(0, 10);
    return `state-${h}-${seq}`;
  };

  const states: CapturedStateEvidence[] = [];
  const transitions: ExploreTransition[] = [];
  const pathTo = new Map<string, ExploreTransition[]>();

  const rootSignals = await ctx.page.evaluate(collectFingerprintSignals, [
    ctx.url,
    ctx.viewport,
    ctx.scroll,
  ] as [string, { width: number; height: number }, ScrollPosition]);
  const rootFp = fingerprintString(rootSignals);
  const rootId = stateIdFor(rootFp, states.length);
  const rootState = await captureState(rootFp);
  rootState.id = rootId;
  states.push(rootState);
  pathTo.set(rootId, []);

  // BFS queue of { id, depth, path }
  interface QueueItem {
    id: string;
    depth: number;
    path: ExploreTransition[];
  }
  const queue: QueueItem[] = [{ id: rootId, depth: 0, path: [] }];
  const visited = new Set<string>([rootId]);

  /** Restore the original viewport before each exploration round. */
  const resetViewport = async (): Promise<void> => {
    const cur = ctx.page.viewportSize();
    if (cur && (cur.width !== ctx.viewport.width || cur.height !== ctx.viewport.height)) {
      await ctx.page.setViewportSize({
        width: ctx.viewport.width,
        height: ctx.viewport.height,
      });
    }
  };

  while (queue.length > 0 && withinBudget()) {
    const current = queue.shift()!;
    if (current.depth >= options.maxDepth) {
      recordSkip('max-depth');
      continue;
    }

    // Reset to the current state deterministically: navigate back to the root
    // URL then replay the recorded path is expensive; instead we replay the
    // path on the same page (navigate to root first).
    await resetViewport();
    await ctx.page
      .goto(ctx.url, { waitUntil: 'domcontentloaded', timeout: 10_000 })
      .catch(() => {});
    await replayPath(ctx.page, current.path);

    const discovered = await discoverActions(ctx.page);
    if (discovered.length === 0) {
      recordSkip('no-actions');
      continue;
    }

    for (const action of discovered) {
      if (!withinBudget()) break;
      if (transitions.length >= options.maxTransitions) {
        recordSkip('max-transitions');
        break;
      }

      // Return to the current node before each action.
      await resetViewport();
      await ctx.page
        .goto(ctx.url, { waitUntil: 'domcontentloaded', timeout: 10_000 })
        .catch(() => {});
      await replayPath(ctx.page, current.path);

      const { ok } = await performAction(ctx.page, action);
      if (!ok) {
        recordSkip('action-failed');
        continue;
      }
      await ctx.page.waitForTimeout(150);

      // Fingerprint the *actual* observable context: after resize/scroll the
      // viewport/scroll differ from the session defaults, and clicking a link
      // changes the URL. Capturing these makes each state genuinely distinct.
      const layout = await ctx.page.evaluate(() => ({
        url: window.location.href,
        vw: window.innerWidth,
        vh: window.innerHeight,
        scroll: { x: window.scrollX, y: window.scrollY },
      }));
      const signals = await ctx.page.evaluate(collectFingerprintSignals, [
        layout.url,
        { width: layout.vw, height: layout.vh },
        layout.scroll,
      ] as [string, { width: number; height: number }, ScrollPosition]);
      const fp = fingerprintString(signals);

      let toId = [...states].find((s) => s.fingerprint === fp)?.id;
      if (!toId) {
        if (states.length >= options.maxStates) {
          recordSkip('max-states');
          continue;
        }
        const newState = await captureState(fp);
        // Re-dedupe by the *captured* fingerprint: exploration-time residues
        // can settle before capture, so the reproducible fingerprint may not
        // equal the pre-capture `fp`. If the captured DOM already exists,
        // reuse that state rather than creating a near-duplicate.
        const match = [...states].find((s) => s.fingerprint === newState.fingerprint);
        if (match) {
          toId = match.id;
        } else {
          newState.id = stateIdFor(fp, states.length);
          toId = newState.id;
          states.push(newState);
          const path = [...current.path, { id: '', from: current.id, action, to: toId }];
          pathTo.set(toId, path);
        }
      }

      // Record the transition (dedupe identical transitions).
      const t: ExploreTransition = { id: '', from: current.id, action, to: toId };
      const exists = transitions.some(
        (x) =>
          x.from === t.from &&
          x.action.type === t.action.type &&
          x.action.target.value === t.action.target.value &&
          x.to === t.to,
      );
      if (!exists) {
        t.id = transitionId(t.from, t.action.type, t.action.target.value, t.to);
        transitions.push(t);
      }

      if (!visited.has(toId)) {
        visited.add(toId);
        queue.push({ id: toId, depth: current.depth + 1, path: pathTo.get(toId)! });
      }
    }
  }

  // Recompute path metadata now that transition ids are assigned.
  for (const [sid, path] of pathTo) {
    const withIds = path.map((t) => ({
      ...t,
      id: t.id || transitionId(t.from, t.action.type, t.action.target.value, t.to),
    }));
    pathTo.set(sid, withIds);
  }

  if (!withinBudget()) warnings.push('exploration-time-budget-exceeded');

  return {
    states,
    transitions,
    pathTo,
    warnings,
    exploredCount: transitions.length,
    skipped,
  };
}

/** Replay a recorded path of actions on the current page. */
export async function replayPath(page: Page, path: ExploreTransition[]): Promise<void> {
  for (const step of path) {
    const action = step.action;
    const { ok } = await performAction(page, action);
    if (!ok) {
      // Best-effort: continue to keep exploration moving.
      await page.waitForTimeout(100);
    }
  }
}

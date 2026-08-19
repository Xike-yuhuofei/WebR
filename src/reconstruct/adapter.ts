/**
 * Reconstruction Adapter (`docs/architecture/01` §3) — Phase 5.
 *
 * Exposes frozen evidence to a reconstruction workflow and produces a local
 * replica. Reconstruction must not access the original source origin; every
 * path here is derived purely from the local Evidence Package.
 *
 * GOAL-002 change: the replica is a genuinely dynamic site, not a set of
 * static per-state snapshots. Each route is reconstructed as ONE document
 * (the route's entry DOM) plus its own runtime: the site's localized JS is
 * kept, cross-origin/CDN assets are localized and rewritten, and recorded
 * API payloads are replayed through a local fetch shim. Recorded states that
 * share a route therefore live in a single file that changes at runtime —
 * multiple states never overwrite one route file.
 */
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { lookup } from '../validate/mime.js';
import type { EvidencePackage, PageRecord, StateRecord } from '../contracts.js';

export interface ReconstructionSpec {
  format: 'webr-reconstruction-spec';
  version: '1.0.0';
  source: { origin: string; entryUrl: string };
  pages: {
    id: string;
    route: string;
    title?: string;
    entryState: string;
    states: string[];
  }[];
  states: {
    id: string;
    url: string;
    title?: string;
    viewport: { width: number; height: number; deviceScaleFactor: number };
    artifacts: { screenshot?: string; dom?: string; domJson?: string };
    fingerprint: string;
    /**
     * Enriched structural outline (P2-2): document title + full h1-h6 heading
     * text, extracted from the captured DOM. Populated when `domMap` is
     * supplied to {@link buildReconstructionSpec} so an independent rebuild
     * agent can reproduce the recorded title/heading structure without
     * reverse-engineering the raw DOM.
     */
    outline?: { title?: string; headings: string[] };
    /**
     * Enriched visible interactive targets (P2-2): stable id/role/text locators
     * found on the page at this state, so authored `wr-*` source can expose the
     * same observable interaction surface (id / role / text) the validator
     * resolves class-agnostically.
     */
    targets?: { id?: string; role?: string | null; text?: string; tag?: string }[];
  }[];
  transitions: {
    id: string;
    from: string;
    action: { type: string; target: { strategy: string; value: string } };
    to: string;
  }[];
  assets: { id: string; originalUrl: string; localPath: string; mimeType: string }[];
}

/** Extract title + full heading outline from serialized HTML (P2-2). */
export function outlineFromDom(dom: string): { title?: string; headings: string[] } {
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(dom);
  const title = titleMatch ? titleMatch[1].trim() : undefined;
  const headings: string[] = [];
  for (const m of dom.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = m[2]
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;|\u0020/g, ' ')
      .trim();
    if (text) headings.push(text);
  }
  return { ...(title ? { title } : {}), headings };
}

/**
 * Extract visible interactive targets (id / role / text / tag) from serialized
 * HTML (P2-2). Class-agnostic by design: only stable attributes are reported so
 * the agent knows what id/role/text surface to make reachable.
 *
 * A lightweight serialized-HTML parser covers the common cases (a/button/input
 * with id/aria/text); a full DOM walk is not needed for agent guidance.
 */
export function targetsFromDomMinimal(dom: string): {
  id?: string;
  role?: string | null;
  text?: string;
  tag?: string;
}[] {
  const out: { id?: string; role?: string | null; text?: string; tag?: string }[] = [];
  const re = /<(a|button|input|select|textarea|summary)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(dom)) !== null && count < 60) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const inner = m[3]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;|\s+/g, ' ')
      .trim();
    const idMatch = /(?:^|\s)id=["']([^"']*)["']/i.exec(attrs);
    const roleMatch = /(?:^|\s)role=["']([^"']*)["']/i.exec(attrs);
    // Skip hidden / non-rendered inputs.
    if (tag === 'input' && /type=["']hidden["']/i.test(attrs)) continue;
    out.push({
      ...(idMatch ? { id: idMatch[1] } : {}),
      role: roleMatch ? roleMatch[1] : null,
      ...(inner ? { text: inner.slice(0, 60) } : {}),
      tag,
    });
    count += 1;
  }
  return out;
}

/**
 * Derive a Reconstruction Spec from the frozen Evidence Package. The spec is
 * an agent-neutral description of what to rebuild; it never references
 * original-site URLs as build inputs (they are provenance metadata only).
 *
 * `domMap` (optional, P2-2) maps stateId → serialized DOM; when supplied, each
 * state is enriched with its title/heading `outline` and stable interactive
 * `targets` so an independent rebuild agent can reproduce the recorded
 * structure without re-deriving it from raw DOM.
 */
export function buildReconstructionSpec(
  pkg: EvidencePackage,
  domMap?: Record<string, string>,
): ReconstructionSpec {
  const pages = pkg.pages.map((p) => ({
    id: p.id,
    route: p.route,
    title: p.title,
    entryState: p.stateIds[0] ?? '',
    states: p.stateIds,
  }));

  const states: ReconstructionSpec['states'] = pkg.states.map((s) => {
    const dom = domMap?.[s.id];
    const enriched: ReconstructionSpec['states'][number] = {
      id: s.id,
      url: s.url,
      title: s.title,
      viewport: s.viewport,
      artifacts: {
        screenshot: s.artifacts.screenshot,
        dom: s.artifacts.dom,
        domJson: s.artifacts.domJson,
      },
      fingerprint: s.fingerprint,
    };
    if (dom !== undefined) {
      const outline = outlineFromDom(dom);
      if (outline.title !== undefined || outline.headings.length > 0) {
        enriched.outline = outline;
      }
      const targets = targetsFromDomMinimal(dom);
      if (targets.length > 0) enriched.targets = targets;
    }
    return enriched;
  });

  const transitions = pkg.stateGraph.transitions.map((t) => ({
    id: t.id,
    from: t.from,
    action: t.action as { type: string; target: { strategy: string; value: string } },
    to: t.to,
  }));

  const assets = pkg.assets.assets.map((a) => ({
    id: a.id,
    originalUrl: a.originalUrl,
    localPath: a.localPath,
    mimeType: a.mimeType,
  }));

  return {
    format: 'webr-reconstruction-spec',
    version: '1.0.0',
    source: { origin: pkg.manifest.source.origin, entryUrl: pkg.manifest.source.entryUrl },
    pages,
    states,
    transitions,
    assets,
  };
}

/**
 * Verify the spec contains no *unlocalized* source-origin resource references
 * that would force reconstruction to re-contact the source site. Assets are
 * provenance metadata: they are allowed as long as a local path exists.
 * Returns the list of offending references when a denial is needed.
 */
export function sourceOriginDenied(
  spec: ReconstructionSpec,
  origin: string,
  localizedPaths?: Set<string>,
): { denied: boolean; refs: string[] } {
  const deniedRefs: string[] = [];
  for (const a of spec.assets) {
    if (!a.originalUrl.startsWith(origin)) continue;
    // Asset is localized (has a local path) → allowed as provenance.
    if (localizedPaths && !localizedPaths.has(a.localPath)) {
      deniedRefs.push(a.originalUrl);
    } else if (!localizedPaths && !a.localPath) {
      deniedRefs.push(a.originalUrl);
    }
  }
  return { denied: deniedRefs.length > 0, refs: deniedRefs };
}

/**
 * Scan generated replica files for any remaining source-origin URL
 * references. The reconstructed site must not load resources from the
 * original origin; a hit here is a hard failure. We scan HTML, JS and CSS so
 * a leftover fetch/xhr/import to the source origin is caught at build time.
 */
export async function scanReplicaForSourceOrigin(
  replicaPath: string,
  origin: string,
): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const hits: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
      } else if (/\.(html?|js|css|mjs|json)$/.test(e.name)) {
        const text = await readFile(abs, 'utf8');
        if (text.includes(origin)) {
          hits.push(`${abs.replace(replicaPath, '')}`);
        }
      }
    }
  };
  await walk(replicaPath);
  return hits;
}

export interface ReplicaBuildOptions {
  /** Copy localized assets into the replica's public dir (default true). */
  copyAssets?: boolean;
}

export function mimeTypeFor(path: string, fallback = 'application/octet-stream'): string {
  return lookup(path.slice(path.lastIndexOf('.'))) ?? fallback;
}

/** Absolute route key for a captured URL (pathname, trailing slashes trimmed). */
export function routeKeyFor(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return '/';
  }
}

/**
 * Capture-order index embedded in a state id (the `-N` suffix). State ids are
 * content-derived, so we cannot rely on array order (`readdir` order is
 * arbitrary); the sequence suffix gives the true capture order and thus the
 * identity of each route's entry state (the first time that route was seen).
 */
export function captureIndex(stateId: string): number {
  const m = /-(\d+)$/.exec(stateId);
  return m ? parseInt(m[1], 10) : 0;
}

/** Local URL within the replica for a localized asset (rooted absolute). */
function localAssetUrl(localPath: string): string {
  return `/${localPath.replace(/^\/+/, '')}`;
}

/** Group states into a Map<routeKey, StateRecord[]> preserving capture order. */
export function groupStatesByRoute(spec: ReconstructionSpec): Map<string, typeof spec.states> {
  const map = new Map<string, typeof spec.states>();
  for (const state of spec.states) {
    const key = routeKeyFor(state.url);
    const bucket = map.get(key) ?? [];
    bucket.push(state);
    // Keep each route bucket in capture order; bucket[0] is the entry state.
    bucket.sort((a, b) => captureIndex(a.id) - captureIndex(b.id));
    map.set(key, bucket);
  }
  return map;
}

/**
 * Build a dynamic HTML replica from the Reconstruction Spec.
 *
 * Layout per route `<route>/index.html` (plus `index.html` for `/`):
 *   1. the route's *entry* DOM is the document (its state includes the
 *      API-rendered content, so no fetch is required to paint);
 *   2. every localized asset URL (same-origin and cross-origin) is rewritten
 *      to the local cache;
 *   3. a fetch shim replays recorded API/network payloads locally, so the
 *      site's own JS keeps working offline;
 *   4. the site's own JS is kept and runs against the local assets, so all
 *      interactions (menu, modal, tabs, form, scroll header, mobile menu)
 *      are genuinely implemented by the replica rather than stored snapshots.
 */
export async function buildReplica(
  spec: ReconstructionSpec,
  evidencePath: string,
  replicaPath: string,
  options: ReplicaBuildOptions = {},
): Promise<void> {
  await mkdir(replicaPath, { recursive: true });

  // Copy localized assets (same + cross-origin) into the replica tree.
  if (options.copyAssets ?? true) {
    for (const asset of spec.assets) {
      const src = join(evidencePath, asset.localPath);
      try {
        await stat(src);
      } catch {
        continue; // missing asset: validator reports it later
      }
      const dest = join(replicaPath, asset.localPath);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
    }
  }

  const routes = groupStatesByRoute(spec);

  // Build one dynamic document per route.
  for (const [route, routeStates] of routes) {
    const entry = routeStates[0];
    const domPath = entry.artifacts.dom;
    if (!domPath) continue;
    const dom = await readFile(join(evidencePath, 'states', entry.id, domPath), 'utf8');
    const html = pageFromDom(dom, entry, spec);
    const routeDir = route === '/' ? '' : `./${route.replace(/^\/+/, '')}`;
    const absDir = join(replicaPath, routeDir);
    await mkdir(absDir, { recursive: true });
    await writeFile(join(absDir, 'index.html'), html, 'utf8');
  }
}

/**
 * Rewrite a captured entry DOM into an offline replica document:
 *   – rewrite all localized asset URLs (same-origin and CDN) to local paths;
 *   – inject a fetch shim that replays recorded API payloads offline;
 *   – add a visible replica marker for validation tracing.
 */
function pageFromDom(
  dom: string,
  state: { id: string; title?: string },
  spec: ReconstructionSpec,
): string {
  const origin = spec.source.origin;
  let html = dom;

  // 1) Rewrite asset references (absolute URLs, and same-origin relative
  //    pathname references) to the local cache.
  const absoluteRe = new Map<string, string>();
  const pathRe = new Map<string, string>();
  for (const asset of spec.assets) {
    const local = localAssetUrl(asset.localPath);
    absoluteRe.set(asset.originalUrl, local);
    try {
      const isOrigin = new URL(asset.originalUrl).origin === origin;
      if (isOrigin) pathRe.set(new URL(asset.originalUrl).pathname, local);
    } catch {
      // ignore malformed provenance URLs
    }
  }
  for (const [from, to] of absoluteRe) {
    html = html.split(from).join(to);
  }
  for (const [fromPath, to] of pathRe) {
    if (fromPath === '/') continue;
    html = html.split(fromPath).join(to);
  }

  // 2) Inject a fetch shim that replays recorded network payloads (API/JSON)
  //    from the local asset cache, keyed by request pathname.
  const fetchMap = spec.assets
    .filter((a) => {
      try {
        return new URL(a.originalUrl)?.pathname;
      } catch {
        return false;
      }
    })
    .map((a) => {
      const path = new URL(a.originalUrl).pathname;
      return { p: path, f: localAssetUrl(a.localPath) };
    });
  const shimBlock = `<script>
(function(){var MAP=${JSON.stringify(fetchMap)};var nativeFetch=window.fetch.bind(window);
window.fetch=function(input,init){var u=(typeof input==='string')?new URL(input,location.href):(input&&input.url)?new URL(input.url):null;
if(u){for(var i=0;i<MAP.length;i++){if(u.pathname===MAP[i].p){return nativeFetch(MAP[i].f,init);}}}
return nativeFetch.apply(window,arguments);};})();
</script>`;
  html = html.replace('</head>', `${shimBlock}</head>`);

  // 3) Add a replica marker for evidence tracing (hidden from view so it never
  //    pollutes visual diffs; still present in DOM for structural checks).
  const marker = `<div class="wr-ReplicaBanner" data-wr-replica="true" data-wr-state="${state.id}" style="display:none" aria-hidden="true">Reconstructed replica</div>`;
  html = html.replace('</body>', `${marker}\n</body>`);
  return html;
}

export type { PageRecord, StateRecord };

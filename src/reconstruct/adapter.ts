/**
 * Reconstruction Adapter (`docs/architecture/01` §3) — Phase 5.
 *
 * Exposes frozen evidence to a reconstruction workflow and produces a local
 * replica. Reconstruction must not access the original source origin; every
 * path here is derived purely from the local Evidence Package.
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
  }[];
  transitions: {
    id: string;
    from: string;
    action: { type: string; target: { strategy: string; value: string } };
    to: string;
  }[];
  assets: { id: string; originalUrl: string; localPath: string; mimeType: string }[];
}

/**
 * Derive a Reconstruction Spec from the frozen Evidence Package. The spec is
 * an agent-neutral description of what to rebuild; it never references
 * original-site URLs as build inputs (they are provenance metadata only).
 */
export function buildReconstructionSpec(pkg: EvidencePackage): ReconstructionSpec {
  const pages = pkg.pages.map((p) => ({
    id: p.id,
    route: p.route,
    title: p.title,
    entryState: p.stateIds[0] ?? '',
    states: p.stateIds,
  }));

  const states = pkg.states.map((s) => ({
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
  }));

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
 * Scan generated replica HTML files for any remaining source-origin URL
 * references. The reconstructed site must not load resources from the
 * original origin; a hit here is a hard failure.
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
      } else if (/\.html?$/.test(e.name)) {
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

/**
 * Build a static HTML replica from the Reconstruction Spec. Each state becomes
 * a route page rendered from its captured DOM; assets are served locally.
 * This is a minimal adapter demonstration: it produces a runnable local site
 * with zero source-origin dependencies.
 */
export async function buildReplica(
  spec: ReconstructionSpec,
  evidencePath: string,
  replicaPath: string,
  options: ReplicaBuildOptions = {},
): Promise<void> {
  await mkdir(replicaPath, { recursive: true });

  // Copy localized assets into the replica's public tree, preserving the
  // package-relative path so internal references keep working.
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

  // Write per-state HTML pages under the same route structure as evidence.
  for (const state of spec.states) {
    const domPath = state.artifacts.dom;
    if (!domPath) continue;
    const dom = await readFile(join(evidencePath, 'states', state.id, domPath), 'utf8');
    const page = pageFromDom(dom, state, spec);
    const routeDir = replicaRouteFor(spec, state.id);
    await mkdir(join(replicaPath, routeDir), { recursive: true });
    await writeFile(join(replicaPath, routeDir, 'index.html'), page, 'utf8');
  }

  // Write the entry page (route "/").
  const entry = spec.pages.find((p) => p.route === '/') ?? spec.pages[0];
  if (entry && entry.entryState) {
    const src = join(replicaPath, replicaRouteFor(spec, entry.entryState), 'index.html');
    const dest = join(replicaPath, 'index.html');
    try {
      await stat(src);
      await copyFile(src, dest);
    } catch {
      // fall through: no entry page available
    }
  }
}

/** Map a state to a safe local route directory (never the source URL). */
export function replicaRouteFor(spec: ReconstructionSpec, stateId: string): string {
  const page = spec.pages.find((p) => p.states.includes(stateId));
  const route = page?.route ?? '/';
  const clean = route
    .split('?')[0]
    .replace(/[^a-zA-Z0-9_/-]/g, '-')
    .replace(/^\/+|\/+$/g, '');
  return clean ? `routes/${clean}` : 'routes/home';
}

/**
 * Rewrite a captured DOM page so source-origin resource references resolve to
 * local assets, and add a visible replica marker for validation tracing.
 */
function pageFromDom(
  dom: string,
  state: { id: string; title?: string },
  spec: ReconstructionSpec,
): string {
  const origin = spec.source.origin;
  let html = dom;

  // Replace absolute source-origin resource URLs with local asset paths.
  for (const asset of spec.assets) {
    const original = asset.originalUrl;
    if (!original.startsWith(origin)) continue;
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const replacement = `assets/${asset.localPath.replace(/^assets\//, '')}`;
    html = html.replace(new RegExp(escaped, 'g'), replacement);
  }

  // Strip any remaining <link> to source-origin stylesheets (offline rule).
  html = html.replace(
    new RegExp(`<link[^>]+href=["']${escapeRe(origin)}[^"']*["'][^>]*>`, 'g'),
    '',
  );

  // Add a replica marker for evidence tracing.
  const marker = `<div class="wr-ReplicaBanner" data-wr-replica="true" data-wr-state="${state.id}">Reconstructed replica</div>`;
  html = html.replace('</body>', `${marker}\n</body>`);
  return html;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type { PageRecord, StateRecord };

/**
 * Evidence Writer (`docs/architecture/01` §3).
 *
 * Normalizes captured observations into the Evidence Package contract and
 * writes the canonical on-disk layout (`docs/architecture/02` §2). Keeps all
 * references package-relative and computes integrity hashes.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sha256Hex } from '../checksum.js';
import type {
  Asset,
  AssetIndex,
  CaptureMetadata,
  Checksums,
  Manifest,
  PageIndex,
  PageRecord,
  StateGraph,
  StateRecord,
} from '../contracts.js';
import { FORMAT_PACKAGE, PACKAGE_VERSION } from '../contracts.js';
import type { CapturedAsset, CapturedStateEvidence } from './collector.js';

const DEFAULT_INDEXES = {
  pages: 'pages/index.json',
  transitions: 'transitions/state-graph.json',
  assets: 'assets/index.json',
  checksums: 'checksums.json',
} as const;

/**
 * Deterministic asset local path: derive from origin-host + filename, falling
 * back to a content hash when no stable filename exists. Kept package-relative
 * and collision-resistant via a short content prefix.
 */
export function assetLocalPath(assetUrl: string, body: Buffer, index: number): string {
  let base: string;
  try {
    const u = new URL(assetUrl);
    const pathname = u.pathname.split('/').filter(Boolean).pop() ?? '';
    base = pathname || `asset-${index}`;
  } catch {
    base = `asset-${index}`;
  }
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '-').slice(-80) || `asset-${index}`;
  const hash = sha256Hex(body).slice(0, 10);
  const ext = safe.includes('.') ? safe.slice(safe.lastIndexOf('.')) : '';
  const stem = ext ? safe.slice(0, safe.lastIndexOf('.')) : safe;
  return `assets/files/${stem}-${hash}${ext}`;
}

/** Stable id for an asset derived from its original URL. */
export function assetId(assetUrl: string): string {
  return `asset-${sha256Hex(assetUrl).slice(0, 12)}`;
}

export interface WrittenPackage {
  manifest: Manifest;
  page: PageRecord;
  states: StateRecord[];
  graph: StateGraph;
  assets: AssetIndex;
  checksums: Checksums;
}

/**
 * Build an in-memory Evidence Package from captured evidence, then persist it
 * to the canonical layout at `outDir`. Recomputes checksums over all canonical
 * artifacts.
 */
export async function writePackage(
  outDir: string,
  evidence: {
    metadata: CaptureMetadata;
    sourceOrigin: string;
    entryUrl: string;
    page: { id: string; url: string; route: string; title?: string };
    states: CapturedStateEvidence[];
    assets: CapturedAsset[];
    transitions: { id: string; from: string; action: unknown; to: string }[];
  },
): Promise<WrittenPackage> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'states'), { recursive: true });

  const manifest: Manifest = {
    format: FORMAT_PACKAGE,
    version: PACKAGE_VERSION,
    capture: evidence.metadata,
    source: { origin: evidence.sourceOrigin, entryUrl: evidence.entryUrl },
    indexes: { ...DEFAULT_INDEXES },
  };

  const page: PageRecord = {
    id: evidence.page.id,
    url: evidence.page.url,
    route: evidence.page.route,
    stateIds: evidence.states.map((s) => s.id),
    ...(evidence.page.title ? { title: evidence.page.title } : {}),
  };

  const stateRecords: StateRecord[] = [];
  const files: Record<string, Buffer> = {};
  const checksums: Checksums = {};

  const put = (rel: string, data: Buffer | string) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    files[rel] = buf;
    checksums[rel] = sha256Hex(buf);
  };

  // ---- states ----
  for (const state of evidence.states) {
    const stateDir = `states/${state.id}`;
    const artifacts: StateRecord['artifacts'] = {
      screenshot: 'screenshot.png',
      dom: 'dom.html',
    };

    put(`${stateDir}/screenshot.png`, state.artifacts.screenshot);
    if (state.artifacts.fullpage) {
      put(`${stateDir}/fullpage.png`, state.artifacts.fullpage);
      artifacts.fullpage = 'fullpage.png';
    }
    put(`${stateDir}/dom.html`, state.artifacts.dom);
    if (state.artifacts.domJson) {
      put(`${stateDir}/dom.json`, JSON.stringify(state.artifacts.domJson, null, 2) + '\n');
      artifacts.domJson = 'dom.json';
    }
    if (state.artifacts.computedStyles) {
      put(
        `${stateDir}/computed-styles.json`,
        JSON.stringify(state.artifacts.computedStyles, null, 2) + '\n',
      );
      artifacts.computedStyles = 'computed-styles.json';
    }
    if (state.artifacts.accessibility) {
      put(
        `${stateDir}/accessibility.json`,
        JSON.stringify(state.artifacts.accessibility, null, 2) + '\n',
      );
      artifacts.accessibility = 'accessibility.json';
    }
    if (state.artifacts.har) {
      put(`${stateDir}/page.har`, JSON.stringify(state.artifacts.har, null, 2) + '\n');
      artifacts.har = 'page.har';
    }

    stateRecords.push({
      id: state.id,
      pageId: evidence.page.id,
      url: state.url,
      viewport: state.viewport,
      scroll: state.scroll,
      artifacts,
      fingerprint: state.fingerprint,
      ...(state.title ? { title: state.title } : {}),
    });

    put(
      `${stateDir}/metadata.json`,
      JSON.stringify(
        {
          id: state.id,
          pageId: evidence.page.id,
          url: state.url,
          viewport: state.viewport,
          scroll: state.scroll,
          artifacts,
          fingerprint: state.fingerprint,
          ...(state.title ? { title: state.title } : {}),
        },
        null,
        2,
      ) + '\n',
    );
  }

  // ---- assets ----
  const assetRecords: Asset[] = [];
  for (const asset of evidence.assets) {
    put(asset.localPath, asset.data);
    assetRecords.push({
      id: asset.id,
      originalUrl: asset.originalUrl,
      localPath: asset.localPath,
      mimeType: asset.mimeType,
      sha256: asset.sha256,
    });
  }
  const assetIndex: AssetIndex = { assets: assetRecords };

  // ---- graph ----
  const graph: StateGraph = {
    nodes: stateRecords.map((s) => s.id),
    transitions: evidence.transitions.map((t) => ({
      id: t.id,
      from: t.from,
      action: t.action as StateGraph['transitions'][number]['action'],
      to: t.to,
    })),
  };

  // ---- page index ----
  const pageIndex: PageIndex = { pages: [page] };

  // ---- write canonical JSON ----
  put('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  put('pages/index.json', JSON.stringify(pageIndex, null, 2) + '\n');
  put('transitions/state-graph.json', JSON.stringify(graph, null, 2) + '\n');
  put('assets/index.json', JSON.stringify(assetIndex, null, 2) + '\n');

  // checksums covers all canonical files (excluding itself)
  const checksumEntries = Object.entries(checksums).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const checksumFile: Checksums = Object.fromEntries(checksumEntries);
  files['checksums.json'] = Buffer.from(JSON.stringify(checksumFile, null, 2) + '\n', 'utf8');

  for (const [rel, buf] of Object.entries(files)) {
    const abs = join(outDir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buf);
  }

  return {
    manifest,
    page,
    states: stateRecords,
    graph,
    assets: assetIndex,
    checksums: checksumFile,
  };
}

export { DEFAULT_INDEXES };

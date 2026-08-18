import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex } from './checksum.js';
import { FORMAT_PACKAGE, SUPPORTED_FEATURES, type EvidencePackage } from './contracts.js';
import { MANIFEST_FILE, STATE_METADATA_FILE } from './packageIO.js';

/** A single validation finding. */
export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

/** Category buckets used to summarize findings. */
export type IssueCategory =
  'manifest' | 'version' | 'files' | 'references' | 'relativePaths' | 'checksums';

export interface ValidationResult {
  valid: boolean;
  format: string;
  version: string;
  /** Whether this reader supports the package's major version. */
  formatSupported: boolean;
  checksumsVerified: boolean;
  issues: ValidationIssue[];
  counts: Record<IssueCategory, number>;
}

const EMPTY_COUNTS = (): Record<IssueCategory, number> => ({
  manifest: 0,
  version: 0,
  files: 0,
  references: 0,
  relativePaths: 0,
  checksums: 0,
});

/** True if a package reference is relative, portable and cannot escape the package. */
export function isPackageRelative(p: string): boolean {
  if (p === '') return true;
  if (p.startsWith('\\\\')) return false; // windows unc
  if (/^[a-zA-Z]:[\\/]/.test(p)) return false; // windows drive
  if (p.startsWith('/')) return false; // absolute posix / package root
  // Reject `..` segments that could escape the package root.
  if (p.split(/[\\/]/).includes('..')) return false;
  return true;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate an in-memory Evidence Package against its on-disk layout at
 * `rootDir`. Covers schema/version validity, required-file presence,
 * referential integrity, package-relative path portability and SHA-256
 * checksum integrity (`docs/architecture/04` V-1).
 *
 * Checks here are structural `valid`-level only. Freeze-readiness (`valid` vs
 * `freeze-ready`) is a Phase 4 concern and is intentionally not evaluated here.
 */
export async function validatePackage(
  pkg: EvidencePackage,
  rootDir: string,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const counts = EMPTY_COUNTS();
  const add = (category: IssueCategory, code: string, message: string, path?: string) => {
    counts[category] += 1;
    issues.push({ code, message, path });
  };

  const { manifest, pages, states, stateGraph, assets, checksums } = pkg;

  // ---- manifest & version ----
  if (manifest.format !== FORMAT_PACKAGE) {
    add(
      'manifest',
      'unsupported-format',
      `Unsupported format "${manifest.format}". Expected "${FORMAT_PACKAGE}".`,
      MANIFEST_FILE,
    );
  }

  const version = manifest.version;
  let formatSupported = true;
  const majorMatch = /^(\d+)(?:\.|$)/.exec(version ?? '');
  if (!majorMatch) {
    formatSupported = false;
    add('version', 'malformed-version', `Malformed package version "${version}".`, MANIFEST_FILE);
  } else if (Number(majorMatch[1]) !== SUPPORTED_FEATURES.majorVersion) {
    formatSupported = false;
    add(
      'version',
      'unsupported-version',
      `Unsupported package major version "${version}". This reader supports major ${SUPPORTED_FEATURES.majorVersion}.`,
      MANIFEST_FILE,
    );
  }

  // ---- uniqueness ----
  const pageIds = pages.map((p) => p.id);
  const stateIds = states.map((s) => s.id);
  const duplicated = (list: string[]) => new Set(list.filter((v, i) => list.indexOf(v) !== i));
  for (const id of duplicated(pageIds)) {
    add('references', 'duplicate-page-id', `Duplicate page id "${id}".`);
  }
  for (const id of duplicated(stateIds)) {
    add('references', 'duplicate-state-id', `Duplicate state id "${id}".`);
  }
  for (const id of duplicated(assets.assets.map((a) => a.id))) {
    add('references', 'duplicate-asset-id', `Duplicate asset id "${id}".`);
  }

  // ---- references: pages -> states, states -> pages ----
  const stateSet = new Set(stateIds);
  const pageSet = new Set(pageIds);
  const pageForState = new Map<string, string>();
  for (const page of pages) {
    for (const sid of page.stateIds) {
      if (!stateSet.has(sid)) {
        add(
          'references',
          'dangling-page-state',
          `Page "${page.id}" references unknown state "${sid}".`,
        );
      }
    }
  }
  for (const state of states) {
    pageForState.set(state.id, state.pageId);
    if (!pageSet.has(state.pageId)) {
      add(
        'references',
        'dangling-state-page',
        `State "${state.id}" references unknown page "${state.pageId}".`,
      );
    }
  }

  // ---- references: state graph ----
  const graphNodeSet = new Set(stateGraph.nodes);
  for (const node of stateGraph.nodes) {
    if (!stateSet.has(node)) {
      add('references', 'graph-unknown-node', `State graph contains unknown node "${node}".`);
    }
  }
  for (const t of stateGraph.transitions) {
    if (!graphNodeSet.has(t.from)) {
      add(
        'references',
        'graph-unknown-from',
        `Transition "${t.id}" starts at unknown node "${t.from}".`,
      );
    }
    if (!graphNodeSet.has(t.to)) {
      add('references', 'graph-unknown-to', `Transition "${t.id}" ends at unknown node "${t.to}".`);
    }
  }

  // ---- indexed files exist ----
  const indexes = manifest.indexes ?? {};
  const indexPaths = [indexes.pages, indexes.transitions, indexes.assets, indexes.checksums].filter(
    Boolean,
  ) as string[];
  for (const ip of indexPaths) {
    if (!isPackageRelative(ip)) {
      add(
        'relativePaths',
        'absolute-index-path',
        `Index path is not package-relative: "${ip}".`,
        MANIFEST_FILE,
      );
    }
    if (!(await fileExists(join(rootDir, ip)))) {
      add('files', 'missing-index', `Missing indexed file: "${ip}".`, ip);
    }
  }

  // ---- state artifacts exist & relative ----
  for (const state of states) {
    const relativeDir = `states/${state.id}`;
    let metadataPath = `${relativeDir}/${STATE_METADATA_FILE}`;
    if (!isPackageRelative(metadataPath)) {
      add(
        'relativePaths',
        'absolute-state-path',
        `State path is not package-relative: "${metadataPath}".`,
        state.id,
      );
    } else {
      metadataPath = join(rootDir, relativeDir, STATE_METADATA_FILE);
      if (!(await fileExists(metadataPath))) {
        add(
          'files',
          'missing-state-metadata',
          `Missing state metadata at "${relativeDir}/${STATE_METADATA_FILE}".`,
          state.id,
        );
      }
    }
    for (const [kind, artifactPath] of Object.entries(state.artifacts)) {
      if (artifactPath === undefined) continue;
      const fullRel = `${relativeDir}/${artifactPath}`;
      // The stored artifact value itself must be package-relative (and must
      // not escape the package), independent of the state-dir prefix.
      if (!isPackageRelative(artifactPath) || !isPackageRelative(fullRel)) {
        add(
          'relativePaths',
          'absolute-state-artifact',
          `State artifact path is not package-relative: "${fullRel}".`,
          state.id,
        );
        continue;
      }
      const absArtifact = join(rootDir, relativeDir, artifactPath);
      if (!(await fileExists(absArtifact))) {
        add('files', 'missing-state-artifact', `Missing ${kind} artifact "${fullRel}".`, state.id);
      }
    }
  }

  // ---- asset local paths exist & relative ----
  for (const asset of assets.assets) {
    if (!isPackageRelative(asset.localPath)) {
      add(
        'relativePaths',
        'absolute-asset-path',
        `Asset path is not package-relative: "${asset.localPath}".`,
        asset.id,
      );
      continue;
    }
    if (!(await fileExists(join(rootDir, asset.localPath)))) {
      add('files', 'missing-asset', `Missing localized asset "${asset.localPath}".`, asset.id);
    }
  }

  // ---- checksums ----
  let checksumsVerified = true;
  for (const [relPath, expectedHex] of Object.entries(checksums)) {
    if (!isPackageRelative(relPath)) {
      add(
        'relativePaths',
        'absolute-checksum-path',
        `Checksum path is not package-relative: "${relPath}".`,
      );
      checksumsVerified = false;
      continue;
    }
    let actual: string;
    try {
      actual = sha256Hex(await readFile(join(rootDir, relPath)));
    } catch {
      actual = '<missing>';
    }
    if (actual.toLowerCase() !== expectedHex.toLowerCase()) {
      add(
        'checksums',
        'checksum-mismatch',
        `Checksum mismatch for "${relPath}". Expected ${expectedHex}, got ${actual === '<missing>' ? 'missing file' : actual}.`,
        relPath,
      );
      checksumsVerified = false;
    }
  }

  const valid =
    formatSupported &&
    counts.manifest === 0 &&
    counts.files === 0 &&
    counts.references === 0 &&
    counts.relativePaths === 0 &&
    counts.checksums === 0 &&
    checksumsVerified;

  return {
    valid,
    format: manifest.format,
    version,
    formatSupported,
    checksumsVerified,
    issues,
    counts,
  };
}

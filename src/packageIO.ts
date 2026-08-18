import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  AssetIndex,
  Checksums,
  EvidencePackage,
  Manifest,
  PageIndex,
  StateGraph,
  StateRecord,
} from './contracts.js';
import { PackageNotFoundError, PackageReadError } from './errors.js';

export const STATE_DIR = 'states';
export const MANIFEST_FILE = 'manifest.json';
export const STATE_METADATA_FILE = 'metadata.json';

/** Default canonical index paths used when `manifest.indexes` is absent. */
export const DEFAULT_INDEXES = {
  pages: 'pages/index.json',
  transitions: 'transitions/state-graph.json',
  assets: 'assets/index.json',
  checksums: 'checksums.json',
} as const;

async function assertDirectory(dir: string): Promise<void> {
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) {
      throw new PackageNotFoundError(`Evidence path is not a directory: ${dir}`);
    }
  } catch (err) {
    if (err instanceof PackageNotFoundError) throw err;
    throw new PackageNotFoundError(`Evidence package not found at: ${dir}`);
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    throw new PackageReadError(`Failed to read evidence file: ${filePath}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new PackageReadError(`Malformed JSON in evidence file: ${filePath}`);
  }
}

/** Read the manifest at `<dir>/manifest.json`. */
export async function readManifest(dir: string): Promise<Manifest> {
  return readJsonFile<Manifest>(join(dir, MANIFEST_FILE));
}

async function readStates(rootDir: string): Promise<StateRecord[]> {
  const statesDir = join(rootDir, STATE_DIR);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(statesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const records: StateRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metadataPath = join(statesDir, entry.name, STATE_METADATA_FILE);
    const record = await readJsonFile<StateRecord>(metadataPath);
    records.push(record);
  }
  return records;
}

/**
 * Deserialize an Evidence Package from its on-disk canonical layout at `dir`.
 * Throws {@link PackageNotFoundError} or {@link PackageReadError} on failure.
 */
export async function readPackage(dir: string): Promise<EvidencePackage> {
  await assertDirectory(dir);
  const manifest = await readManifest(dir);
  const indexes = manifest.indexes ?? DEFAULT_INDEXES;

  const pages = (await readJsonFile<PageIndex>(join(dir, indexes.pages))).pages ?? [];
  const stateGraph = await readJsonFile<StateGraph>(join(dir, indexes.transitions));
  const assets = await readJsonFile<AssetIndex>(join(dir, indexes.assets));
  const checksums = await readJsonFile<Checksums>(join(dir, indexes.checksums));
  const states = await readStates(dir);

  return { manifest, pages, states, stateGraph, assets, checksums };
}

/** Human-readable name of a package directory (for CLI output). */
export function packageDisplayName(dir: string): string {
  return basename(dir);
}

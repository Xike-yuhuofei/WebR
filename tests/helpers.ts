import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sha256 = (buf: Buffer | string): string =>
  createHash('sha256').update(buf).digest('hex');

export const FIXTURE_DIR = new URL('../fixtures/minimal.webr/', import.meta.url).pathname;

/** Recursively copy a directory (used to get a mutable copy of the fixture). */
async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const sAbs = join(src, e.name);
    const dAbs = join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(sAbs, dAbs);
    } else {
      await writeFile(dAbs, await readFile(sAbs));
    }
  }
}

/** Create an independent copy of the committed minimal fixture in a temp dir. */
export async function duplicateFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'webr-fixture-'));
  await copyDir(FIXTURE_DIR, dir);
  return dir;
}

/** Read a mutable copy of any committed fixture directory. */
export async function duplicateFixtureDir(fixtureDir: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'webr-fixture-'));
  await copyDir(fixtureDir, dir);
  return dir;
}

/**
 * Recompute `checksums.json` from the current on-disk contents of `dir`.
 * Used after mutating a package so only the intended defect remains.
 */
export async function rebuildChecksums(dir: string): Promise<void> {
  const files = await collectFiles(dir);
  const checksums: Record<string, string> = {};
  // exclude checksums.json itself from the set we compute over
  for (const rel of files) {
    checksums[rel] = sha256(await readFile(join(dir, rel)));
  }
  await writeFile(join(dir, 'checksums.json'), JSON.stringify(checksums, null, 2) + '\n');
}

async function collectFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await collectFiles(abs, rel)));
    else if (rel !== 'checksums.json') out.push(rel);
  }
  return out;
}

export async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

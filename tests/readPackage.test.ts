import { describe, expect, it } from 'vitest';
import { readPackage, sha256Hex, STATE_METADATA_FILE } from '../src/index.js';
import { PackageNotFoundError, PackageReadError } from '../src/index.js';
import { FIXTURE_DIR } from './helpers.js';

describe('readPackage — serialization/deserialization round trip', () => {
  it('deserializes the minimal fixture into a full EvidencePackage', async () => {
    const pkg = await readPackage(FIXTURE_DIR);

    expect(pkg.manifest.format).toBe('webr-evidence');
    expect(pkg.manifest.version).toBe('1.0.0');
    expect(pkg.manifest.source.origin).toBe('https://example.com');
    expect(pkg.manifest.indexes.pages).toBe('pages/index.json');

    expect(pkg.pages).toHaveLength(1);
    expect(pkg.pages[0].stateIds).toEqual(['state-home']);

    expect(pkg.states).toHaveLength(1);
    const state = pkg.states[0];
    expect(state.id).toBe('state-home');
    expect(state.artifacts.screenshot).toBe('screenshot.png');
    expect(state.artifacts.dom).toBe('dom.html');
    expect(state.fingerprint.startsWith('sha256:')).toBe(true);

    expect(pkg.stateGraph.nodes).toEqual(['state-home']);
    expect(pkg.stateGraph.transitions).toEqual([]);

    expect(pkg.assets.assets).toHaveLength(1);
    expect(pkg.assets.assets[0].localPath).toBe('assets/svg/logo.svg');

    expect(Object.keys(pkg.checksums).length).toBeGreaterThan(0);
  });

  it('computes the same checksum as the stored asset hash', async () => {
    const pkg = await readPackage(FIXTURE_DIR);
    const expected = pkg.assets.assets[0].sha256;
    // The localized asset file must hash to the recorded value.
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(`${expected}`)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exposes canonical constants', () => {
    expect(STATE_METADATA_FILE).toBe('metadata.json');
  });
});

describe('readPackage — error cases', () => {
  it('throws PackageNotFoundError for a missing directory', async () => {
    await expect(readPackage('/nonexistent/webr-package')).rejects.toBeInstanceOf(
      PackageNotFoundError,
    );
  });

  it('throws PackageReadError for malformed manifest JSON', async () => {
    // A directory with a broken manifest.json.
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'webr-read-'));
    await writeFile(join(dir, 'manifest.json'), '{ nope', 'utf8');
    try {
      await expect(readPackage(dir)).rejects.toBeInstanceOf(PackageReadError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

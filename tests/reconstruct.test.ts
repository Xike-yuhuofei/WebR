/**
 * Phase 5 — Reconstruction Adapter tests.
 *
 * Verifies that a replica can be built from frozen evidence with the source
 * origin unavailable, that source-origin references are surfaced as failures,
 * and that adapter details do not leak into Evidence Package semantics.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildReconstructionSpec,
  buildReplica,
  sourceOriginDenied,
  readPackage,
  mimeTypeFor,
} from '../src/index.js';
import { cleanup, duplicateFixture, FIXTURE_DIR } from './helpers.js';

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map(cleanup));
});

async function fresh(): Promise<string> {
  const d = await duplicateFixture();
  tempDirs.push(d);
  return d;
}

describe('Phase 5 — reconstruction spec', () => {
  it('derives a spec from the frozen evidence without source access', async () => {
    const pkg = await readPackage(FIXTURE_DIR);
    const spec = buildReconstructionSpec(pkg);
    expect(spec.format).toBe('webr-reconstruction-spec');
    expect(spec.version).toBe('1.0.0');
    expect(spec.states.length).toBe(1);
    expect(spec.transitions.length).toBe(0);
    expect(spec.assets.length).toBe(1);
    // Source origin stays as provenance metadata, not a build input.
    expect(spec.source.origin).toBe('https://example.com');
  });

  it('source-origin references are surfaced as a denial when unlocalized', async () => {
    const pkg = await readPackage(FIXTURE_DIR);
    const spec = buildReconstructionSpec(pkg);
    // A spec whose asset points at the origin but has NO local path must be denied.
    const evil = {
      ...spec,
      assets: [
        {
          id: 'asset-x',
          originalUrl: 'https://example.com/secret.css',
          localPath: '', // not localized → forbidden
          mimeType: 'text/css',
        },
      ],
    };
    const deny = sourceOriginDenied(evil, 'https://example.com');
    expect(deny.denied).toBe(true);
    expect(deny.refs).toContain('https://example.com/secret.css');

    // A localized asset with the same origin is provenance, not a violation.
    const localized = new Set(['assets/files/secret.css']);
    const ok = sourceOriginDenied(
      {
        ...evil,
        assets: [{ ...evil.assets[0], localPath: 'assets/files/secret.css' }],
      },
      'https://example.com',
      localized,
    );
    expect(ok.denied).toBe(false);
  });
});

describe('Phase 5 — replica generation', () => {
  it('builds a runnable replica with locally-served assets', async () => {
    const evidenceDir = await fresh();
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const out = await mkdtemp(join(tmpdir(), 'webr-replica-build-'));
    tempDirs.push(out);

    const pkg = await readPackage(evidenceDir);
    const spec = buildReconstructionSpec(pkg);
    const deny = sourceOriginDenied(spec, pkg.manifest.source.origin);
    expect(deny.denied).toBe(false);

    await buildReplica(spec, evidenceDir, out);

    // Entry page + per-state route + copied assets exist.
    await stat(join(out, 'index.html'));
    const entries = await readdir(out);
    expect(entries).toContain('routes');
    // The fixture has one asset (logo.svg) copied locally at its localPath.
    expect(spec.assets.length).toBeGreaterThan(0);
    await stat(join(out, spec.assets[0].localPath));
  });

  it('replica HTML contains no source-origin resource URLs', async () => {
    const evidenceDir = await fresh();
    const { mkdtemp, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const out = await mkdtemp(join(tmpdir(), 'webr-replica-build2-'));
    tempDirs.push(out);

    const pkg = await readPackage(evidenceDir);
    const spec = buildReconstructionSpec(pkg);
    await buildReplica(spec, evidenceDir, out);

    const html = await readFile(join(out, 'index.html'), 'utf8');
    expect(html).not.toContain('https://example.com');
    // The replica marker is present for evidence tracing.
    expect(html).toContain('data-wr-replica="true"');
  });

  it('mimeTypeFor maps known extensions', () => {
    expect(mimeTypeFor('x.css')).toBe('text/css');
    expect(mimeTypeFor('x.png')).toBe('image/png');
    expect(mimeTypeFor('x.bin')).toBe('application/octet-stream');
  });
});

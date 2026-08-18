import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli, EXIT_CODES } from '../src/index.js';
import { FIXTURE_DIR } from './helpers.js';

interface Out {
  stdout: string;
  stderr: string;
}

async function run(args: string[]): Promise<{ code: number; out: Out }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const spyOut = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  const spyErr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  try {
    const code = await runCli(args);
    return { code, out: { stdout: stdout.join(''), stderr: stderr.join('') } };
  } finally {
    spyOut.mockRestore();
    spyErr.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CLI — global options', () => {
  it('prints version and exits 0', async () => {
    const { code, out } = await run(['--version']);
    expect(code).toBe(EXIT_CODES.success);
    expect(out.stdout).toContain('webr 0.1.0');
  });

  it('prints help and exits 0 for --help', async () => {
    const { code, out } = await run(['--help']);
    expect(code).toBe(EXIT_CODES.success);
    expect(out.stdout).toContain('Usage:');
  });

  it('prints usage and exits 2 when invoked without a command', async () => {
    const { code, out } = await run([]);
    expect(code).toBe(EXIT_CODES.invalidArguments);
    expect(out.stdout).toContain('Usage:');
  });

  it('exits 2 for an unknown command', async () => {
    const { code, out } = await run(['frobnicate']);
    expect(code).toBe(EXIT_CODES.invalidArguments);
    expect(out.stderr).toContain('unknown command');
  });

  it('exits 2 for an unknown option', async () => {
    const { code } = await run(['--bogus']);
    expect(code).toBe(EXIT_CODES.invalidArguments);
  });
});

describe('CLI — the four commands exist with documented help', () => {
  it('lists all four commands in help output', async () => {
    const { out } = await run(['--help']);
    for (const cmd of ['capture', 'audit', 'reconstruct', 'validate']) {
      expect(out.stdout).toContain(cmd);
    }
  });
});

describe('CLI — audit', () => {
  it('validates the minimal fixture and exits 0', async () => {
    const { code, out } = await run(['audit', FIXTURE_DIR]);
    expect(code).toBe(EXIT_CODES.success);
    expect(out.stdout).toContain('valid');
  });

  it('emits machine-readable JSON with --json', async () => {
    const { code, out } = await run(['audit', FIXTURE_DIR, '--json']);
    expect(code).toBe(EXIT_CODES.success);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.command).toBe('audit');
    expect(parsed.success).toBe(true);
  });

  it('exits 3 for an invalid package', async () => {
    const { duplicateFixture } = await import('./helpers.js');
    const { readFile, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const dir = await duplicateFixture();
    try {
      // Corrupt a file so the package becomes invalid.
      const shot = join(dir, 'states/state-home/screenshot.png');
      await writeFile(shot, (await readFile(shot)) + Buffer.from('x'));
      const { code, out } = await run(['audit', dir]);
      expect(code).toBe(EXIT_CODES.invalidEvidence);
      expect(out.stdout).toContain('invalid');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 when audit is missing its argument', async () => {
    const { code } = await run(['audit']);
    expect(code).toBe(EXIT_CODES.invalidArguments);
  });

  it('exits 1 when the evidence path does not exist', async () => {
    const { code, out } = await run(['audit', '/does/not/exist.webr']);
    expect(code).toBe(EXIT_CODES.commandFailure);
    expect(out.stderr).toContain('error');
  });
});

describe('CLI — reconstruct (Phase 5)', () => {
  it('reconstructs a replica from the minimal fixture and exits 0', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const out = await mkdtemp(join(tmpdir(), 'webr-replica-'));
    try {
      const { code, out: cliOut } = await run(['reconstruct', FIXTURE_DIR, '--out', out]);
      expect(code).toBe(EXIT_CODES.success);
      expect(cliOut.stdout).toContain('reconstructed');
    } finally {
      await import('node:fs/promises').then((fs) => fs.rm(out, { recursive: true, force: true }));
    }
  });

  it('reconstruct exits 2 when missing argument', async () => {
    const { code } = await run(['reconstruct']);
    expect(code).toBe(EXIT_CODES.invalidArguments);
  });
});

describe('CLI — capture shell', () => {
  it('capture exits 2 when missing <url>', async () => {
    const { code } = await run(['capture']);
    expect(code).toBe(EXIT_CODES.invalidArguments);
  });

  it('capture exits 2 when missing --out', async () => {
    const { code } = await run(['capture', 'https://example.com']);
    expect(code).toBe(EXIT_CODES.invalidArguments);
  });
});

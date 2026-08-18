#!/usr/bin/env node

import { PackageNotFoundError, PackageReadError } from './errors.js';
import { PACKAGE_VERSION, TOOL_VERSION } from './contracts.js';
import { packageDisplayName } from './packageIO.js';

/**
 * CLI exit-code contract (`docs/architecture/03` §8). Values are frozen for
 * v1. Do not silently redefine.
 */
export const EXIT_CODES = {
  success: 0,
  commandFailure: 1,
  invalidArguments: 2,
  invalidEvidence: 3,
  isolationViolation: 4,
  thresholdsNotMet: 5,
} as const;

const PROGRAM = 'webr';

interface CliOptions {
  help: boolean;
  version: boolean;
  json: boolean;
  verbose: boolean;
  quiet: boolean;
  out?: string;
  args: string[];
}

function printHelp(): string {
  return `${PROGRAM} — local-first Web Reconstruction Toolkit (v${TOOL_VERSION})

Usage:
  webr capture <url> --out <evidence-path>
  webr audit <evidence-path>
  webr reconstruct <evidence-path> --out <replica-path>
  webr validate <evidence-path> <replica-path>

Commands:
  capture      Capture browser-observable evidence into a Website Evidence Package
  audit        Validate package integrity and evidence completeness (offline)
  reconstruct  Reconstruct a local replica from frozen evidence (offline)
  validate     Validate a replica against Golden References (offline)

Options:
  --help, -h    Show this help
  --version, -v Show version
  --json        Emit machine-readable JSON (where supported)
  --verbose     Verbose output
  --quiet       Suppress non-essential output
  --out <path>  Explicit output path

Exit codes:
  0 success · 1 command failure · 2 invalid arguments · 3 invalid evidence
  4 source-origin isolation violation · 5 validation thresholds not met
`;
}

function printVersion(): string {
  return `${PROGRAM} ${TOOL_VERSION} (webr-evidence v${PACKAGE_VERSION})`;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    help: false,
    version: false,
    json: false,
    verbose: false,
    quiet: false,
    args: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--version':
      case '-v':
        opts.version = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--quiet':
        opts.quiet = true;
        break;
      case '--out': {
        const v = argv[++i];
        if (v === undefined) throw new Error('--out requires a value');
        opts.out = v;
        break;
      }
      default:
        if (a.startsWith('--out=')) {
          opts.out = a.slice('--out='.length);
        } else if (a.startsWith('-') && a !== '-') {
          throw new Error(`Unknown option: ${a}`);
        } else {
          opts.args.push(a);
        }
    }
  }
  return opts;
}

async function runAudit(evidencePath: string, opts: CliOptions): Promise<number> {
  try {
    const { auditPackage, renderAudit } = await import('./audit/audit.js');
    const audit = await auditPackage(evidencePath);
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({
          command: 'audit',
          success: audit.valid,
          version: audit.version,
          format: 'webr-evidence',
          formatSupported: audit.formatSupported,
          checksumsVerified: audit.checksumsVerified,
          valid: audit.valid,
          freezeReady: audit.freezeReady,
          coverage: audit.coverage,
          externalDependencies: audit.externalDependencies,
          freezeBlockers: audit.freezeBlockers,
          summary: audit.counts,
          warnings: audit.issues.filter((i) => i.code === 'checksum-mismatch'),
          errors: audit.issues,
        }),
      );
    } else if (!opts.quiet) {
      process.stdout.write(
        `${packageDisplayName(evidencePath)}: ${audit.valid ? 'valid' : 'invalid'} · ${audit.freezeReady ? 'freeze-ready' : 'not freeze-ready'} (format webr-evidence ${audit.version})\n`,
      );
      const printed = renderAudit(audit);
      if (printed) process.stdout.write(printed + '\n');
    }
    return audit.valid ? EXIT_CODES.success : EXIT_CODES.invalidEvidence;
  } catch (err) {
    if (err instanceof PackageNotFoundError || err instanceof PackageReadError) {
      if (opts.json) {
        process.stdout.write(
          JSON.stringify({
            command: 'audit',
            success: false,
            version: PACKAGE_VERSION,
            summary: {},
            warnings: [],
            errors: [err.message],
          }),
        );
      } else {
        process.stderr.write(`webr: error: ${err.message}\n`);
      }
      return EXIT_CODES.commandFailure;
    }
    throw err;
  }
}

async function runCapture(url: string, opts: CliOptions): Promise<number> {
  const out = opts.out;
  if (!out) {
    process.stderr.write('webr: error: capture requires --out <path>\n');
    return EXIT_CODES.invalidArguments;
  }
  try {
    const { capturePackage } = await import('./capture/capture.js');
    const outcome = await capturePackage({ url, out, verbose: opts.verbose });
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({
          command: 'capture',
          success: true,
          version: PACKAGE_VERSION,
          summary: {
            packagePath: outcome.packagePath,
            states: outcome.states,
            transitions: outcome.transitions,
            assets: outcome.assets,
          },
          warnings: outcome.warnings,
          errors: [],
        }),
      );
    } else {
      process.stdout.write(
        `captured ${outcome.states} state(s), ${outcome.transitions} transition(s), ${outcome.assets} asset(s) → ${outcome.packagePath}\n`,
      );
      for (const w of outcome.warnings) process.stdout.write(`warning: ${w}\n`);
    }
    return EXIT_CODES.success;
  } catch (err) {
    const msg = (err as Error).message;
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({
          command: 'capture',
          success: false,
          version: PACKAGE_VERSION,
          summary: {},
          warnings: [],
          errors: [msg],
        }),
      );
    } else {
      process.stderr.write(`webr: error: capture failed: ${msg}\n`);
    }
    return EXIT_CODES.commandFailure;
  }
}

async function runReconstruct(evidencePath: string, opts: CliOptions): Promise<number> {
  const out = opts.out;
  if (!out) {
    process.stderr.write('webr: error: reconstruct requires --out <path>\n');
    return EXIT_CODES.invalidArguments;
  }
  try {
    const { readPackage } = await import('./packageIO.js');
    const {
      buildReconstructionSpec,
      buildReplica,
      sourceOriginDenied,
      scanReplicaForSourceOrigin,
    } = await import('./reconstruct/adapter.js');
    const pkg = await readPackage(evidencePath);
    const spec = buildReconstructionSpec(pkg);
    const localized = new Set(spec.assets.map((a) => a.localPath));
    const deny = sourceOriginDenied(spec, pkg.manifest.source.origin, localized);
    if (deny.denied) {
      const msg = `reconstruct denied: unlocalized source-origin asset (${deny.refs.join(', ')})`;
      if (opts.json) {
        process.stdout.write(
          JSON.stringify({
            command: 'reconstruct',
            success: false,
            version: PACKAGE_VERSION,
            summary: {},
            warnings: [],
            errors: [msg],
          }),
        );
      } else {
        process.stderr.write(`webr: error: ${msg}\n`);
      }
      return EXIT_CODES.isolationViolation;
    }
    await buildReplica(spec, evidencePath, out);
    // Post-build isolation check: generated HTML must not reference the origin.
    const originHits = await scanReplicaForSourceOrigin(out, pkg.manifest.source.origin);
    if (originHits.length > 0) {
      const msg = `reconstruct produced source-origin references in ${originHits.join(', ')}`;
      if (opts.json) {
        process.stdout.write(
          JSON.stringify({
            command: 'reconstruct',
            success: false,
            version: PACKAGE_VERSION,
            summary: {},
            warnings: [],
            errors: [msg],
          }),
        );
      } else {
        process.stderr.write(`webr: error: ${msg}\n`);
      }
      return EXIT_CODES.isolationViolation;
    }
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({
          command: 'reconstruct',
          success: true,
          version: PACKAGE_VERSION,
          summary: {
            replicaPath: out,
            states: spec.states.length,
            transitions: spec.transitions.length,
            assets: spec.assets.length,
          },
          warnings: [],
          errors: [],
        }),
      );
    } else {
      process.stdout.write(
        `reconstructed ${spec.states.length} state(s) from ${evidencePath} → ${out}\n`,
      );
    }
    return EXIT_CODES.success;
  } catch (err) {
    const msg = (err as Error).message;
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({
          command: 'reconstruct',
          success: false,
          version: PACKAGE_VERSION,
          summary: {},
          warnings: [],
          errors: [msg],
        }),
      );
    } else {
      process.stderr.write(`webr: error: reconstruct failed: ${msg}\n`);
    }
    return EXIT_CODES.commandFailure;
  }
}

async function runValidate(
  evidencePath: string,
  replicaPath: string,
  opts: CliOptions,
): Promise<number> {
  try {
    const { validateReplica, renderValidationReport } = await import('./validate/validator.js');
    const report = await validateReplica(evidencePath, replicaPath);
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({
          command: 'validate',
          success: report.success,
          version: PACKAGE_VERSION,
          summary: {
            profile: report.profile,
            states: report.states,
            transitions: report.transitions,
            isolation: report.isolation,
            visualComparisons: report.visual.comparisons.length,
          },
          warnings: report.warnings,
          errors: report.failures,
        }),
      );
    } else {
      process.stdout.write(renderValidationReport(report) + '\n');
    }
    if (!report.success) {
      if (report.failures.some((f) => f.startsWith('offline-isolation'))) {
        return EXIT_CODES.isolationViolation;
      }
      return EXIT_CODES.thresholdsNotMet;
    }
    return EXIT_CODES.success;
  } catch (err) {
    const msg = (err as Error).message;
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({
          command: 'validate',
          success: false,
          version: PACKAGE_VERSION,
          summary: {},
          warnings: [],
          errors: [msg],
        }),
      );
    } else {
      process.stderr.write(`webr: error: validate failed: ${msg}\n`);
    }
    return EXIT_CODES.commandFailure;
  }
}

/**
 * Run the CLI with `argv` (excluding node/script) and return the exit code.
 * Deterministic, non-interactive, safe for Agent and CI invocation.
 */
export async function runCli(argv: string[]): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`webr: error: ${(err as Error).message}\n`);
    return EXIT_CODES.invalidArguments;
  }

  if (opts.version) {
    process.stdout.write(printVersion() + '\n');
    return EXIT_CODES.success;
  }
  if (opts.help || opts.args.length === 0) {
    process.stdout.write(printHelp());
    return opts.help ? EXIT_CODES.success : EXIT_CODES.invalidArguments;
  }

  const [command, ...rest] = opts.args;

  switch (command) {
    case 'audit': {
      const evidencePath = rest[0];
      if (!evidencePath) {
        process.stderr.write('webr: error: audit requires an <evidence-path>\n');
        return EXIT_CODES.invalidArguments;
      }
      return runAudit(evidencePath, opts);
    }
    case 'capture': {
      const url = rest[0];
      if (!url) {
        process.stderr.write('webr: error: capture requires a <url>\n');
        return EXIT_CODES.invalidArguments;
      }
      return runCapture(url, opts);
    }
    case 'reconstruct': {
      const evidencePath = rest[0];
      if (!evidencePath) {
        process.stderr.write('webr: error: reconstruct requires an <evidence-path>\n');
        return EXIT_CODES.invalidArguments;
      }
      return runReconstruct(evidencePath, opts);
    }
    case 'validate': {
      const evidencePath = rest[0];
      const replicaPath = rest[1];
      if (!evidencePath || !replicaPath) {
        process.stderr.write('webr: error: validate requires <evidence-path> <replica-path>\n');
        return EXIT_CODES.invalidArguments;
      }
      return runValidate(evidencePath, replicaPath, opts);
    }
    default:
      process.stderr.write(`webr: error: unknown command "${command}"\n\n${printHelp()}`);
      return EXIT_CODES.invalidArguments;
  }
}

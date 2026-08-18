/**
 * Completeness Auditor (`docs/architecture/01` §3) — Phase 4.
 *
 * Evaluates whether a package is structurally valid (`valid`) and additionally
 * whether it is ready to be disconnected from the source site (`freezeReady`).
 * A valid package is not automatically freeze-ready. Audit never requires
 * source-site access.
 */
import { readPackage } from '../packageIO.js';
import { validatePackage, type ValidationResult } from '../validator.js';
import type { EvidencePackage, ManifestIndexes, StateRecord, Transition } from '../contracts.js';

export interface CoverageMetrics {
  pages: { total: number; withStates: number };
  states: { total: number; withScreenshot: number; withDom: number; golden: number };
  transitions: { total: number; replayable: number };
  viewports: {
    /** Distinct viewport strings observed, e.g. "1440x900". */
    distinct: string[];
    required: string[];
  };
  assets: { total: number; localized: number; external: number };
}

export interface FreezePolicy {
  /** Minimum states required to be freeze-ready. */
  minStates: number;
  /** Minimum transitions required (0+ for interactive capture). */
  minTransitions: number;
  /** Minimum distinct viewports required. */
  minViewports: number;
  /** Required viewport strings, e.g. ["1440x900"]. */
  requiredViewports: string[];
}

export const DEFAULT_FREEZE_POLICY: FreezePolicy = {
  minStates: 1,
  minTransitions: 0,
  minViewports: 1,
  requiredViewports: [],
};

export interface AuditResult {
  /** Structural validity (schema/version/files/references/checksums). */
  valid: boolean;
  /** Policy-based evidence completeness for offline reconstruction. */
  freezeReady: boolean;
  version: string;
  formatSupported: boolean;
  checksumsVerified: boolean;
  coverage: CoverageMetrics;
  /** Unresolved external (non-localized) resource references. */
  externalDependencies: { originalUrl: string; reason: string }[];
  /** Explicit reasons the package is not freeze-ready. */
  freezeBlockers: string[];
  issues: ValidationResult['issues'];
  counts: ValidationResult['counts'];
}

const viewportKey = (s: StateRecord): string =>
  `${s.viewport.width}x${s.viewport.height}@${s.viewport.deviceScaleFactor}`;

/** Identify a state as a Golden Reference (has screenshot + stable context). */
function isGoldenState(s: StateRecord): boolean {
  return Boolean(s.artifacts.screenshot) && s.viewport.width > 0 && s.viewport.height > 0;
}

/** True if a transition is replayable (has a resolvable target + action). */
function isReplayable(t: Transition): boolean {
  return Boolean(t.action && t.action.type && t.action.target && t.action.target.value);
}

/**
 * Run the completeness audit against `evidencePath`. Combines structural
 * validation (Phase 1 `validatePackage`) with coverage and freeze-policy
 * evaluation.
 */
export async function auditPackage(
  evidencePath: string,
  policy: FreezePolicy = DEFAULT_FREEZE_POLICY,
): Promise<AuditResult> {
  const pkg: EvidencePackage = await readPackage(evidencePath);
  const structural = await validatePackage(pkg, evidencePath);

  const { pages, states, stateGraph, assets } = pkg;

  const viewports = [...new Set(states.map(viewportKey))];
  const requiredViewports = policy.requiredViewports;

  const coverage: CoverageMetrics = {
    pages: {
      total: pages.length,
      withStates: pages.filter((p) => p.stateIds.length > 0).length,
    },
    states: {
      total: states.length,
      withScreenshot: states.filter((s) => s.artifacts.screenshot).length,
      withDom: states.filter((s) => s.artifacts.dom).length,
      golden: states.filter(isGoldenState).length,
    },
    transitions: {
      total: stateGraph.transitions.length,
      replayable: stateGraph.transitions.filter(isReplayable).length,
    },
    viewports: {
      distinct: viewports,
      required: requiredViewports,
    },
    assets: {
      total: assets.assets.length,
      localized: assets.assets.filter((a) => a.localPath).length,
      external: 0,
    },
  };

  // Unresolved external dependencies: original URLs in the state DOM that are
  // not satisfied by a localized asset. This is a best-effort static scan.
  const externalDependencies: AuditResult['externalDependencies'] = [];
  const localizedByUrl = new Set(assets.assets.map((a) => a.originalUrl));
  const externalOrigin = pkg.manifest.source?.origin;
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  for (const state of states) {
    const domPath = state.artifacts.dom;
    if (!domPath) continue;
    let dom: string;
    try {
      dom = await readFile(join(evidencePath, 'states', state.id, domPath), 'utf8');
    } catch {
      continue;
    }
    // Scan src/href references pointing at the source origin.
    const refs = dom.matchAll(/(?:src|href)=["']([^"']+)["']/g);
    for (const m of refs) {
      const ref = m[1];
      if (!ref.startsWith('http://') && !ref.startsWith('https://')) continue;
      try {
        const u = new URL(ref);
        if (externalOrigin && u.origin === externalOrigin) {
          if (!localizedByUrl.has(ref) && !localizedByUrl.has(u.origin + u.pathname)) {
            if (!externalDependencies.some((d) => d.originalUrl === ref)) {
              externalDependencies.push({
                originalUrl: ref,
                reason: 'source-origin resource without localized asset',
              });
            }
          }
        }
      } catch {
        // ignore malformed URLs
      }
    }
  }
  coverage.assets.external = externalDependencies.length;

  // ---- freeze blockers ----
  const freezeBlockers: string[] = [];
  if (!structural.valid) freezeBlockers.push('package is not structurally valid');
  if (coverage.states.total < policy.minStates)
    freezeBlockers.push(`only ${coverage.states.total} state(s); minimum ${policy.minStates}`);
  if (coverage.transitions.total < policy.minTransitions)
    freezeBlockers.push(
      `only ${coverage.transitions.total} transition(s); minimum ${policy.minTransitions}`,
    );
  if (coverage.viewports.distinct.length < policy.minViewports)
    freezeBlockers.push(
      `only ${coverage.viewports.distinct.length} distinct viewport(s); minimum ${policy.minViewports}`,
    );
  for (const rv of requiredViewports) {
    if (!viewports.includes(rv)) freezeBlockers.push(`required viewport "${rv}" not captured`);
  }
  for (const dep of externalDependencies) {
    freezeBlockers.push(`unresolved external dependency: ${dep.originalUrl}`);
  }
  if (coverage.states.golden === 0 && policy.minStates > 0) {
    freezeBlockers.push('no Golden Reference states captured');
  }

  const freezeReady = freezeBlockers.length === 0;

  return {
    valid: structural.valid,
    freezeReady,
    version: structural.version,
    formatSupported: structural.formatSupported,
    checksumsVerified: structural.checksumsVerified,
    coverage,
    externalDependencies,
    freezeBlockers,
    issues: structural.issues,
    counts: structural.counts,
  };
}

/** Render a human-readable audit summary block. */
export function renderAudit(result: AuditResult): string {
  const lines: string[] = [];
  lines.push(`valid: ${result.valid}`);
  lines.push(`freeze-ready: ${result.freezeReady}`);
  lines.push(`version: ${result.version}`);
  lines.push('coverage:');
  lines.push(
    `  pages: ${result.coverage.pages.withStates}/${result.coverage.pages.total} with states`,
  );
  lines.push(
    `  states: ${result.coverage.states.total} (screenshots ${result.coverage.states.withScreenshot}, golden ${result.coverage.states.golden})`,
  );
  lines.push(
    `  transitions: ${result.coverage.transitions.total} (replayable ${result.coverage.transitions.replayable})`,
  );
  lines.push(`  viewports: ${result.coverage.viewports.distinct.join(', ') || '(none)'}`);
  lines.push(
    `  assets: ${result.coverage.assets.localized}/${result.coverage.assets.total} localized`,
  );
  if (result.externalDependencies.length > 0) {
    lines.push('external dependencies:');
    for (const dep of result.externalDependencies) {
      lines.push(`  ${dep.originalUrl} — ${dep.reason}`);
    }
  }
  if (result.freezeBlockers.length > 0) {
    lines.push('freeze blockers:');
    for (const b of result.freezeBlockers) lines.push(`  - ${b}`);
  }
  return lines.join('\n');
}

export type { ManifestIndexes };

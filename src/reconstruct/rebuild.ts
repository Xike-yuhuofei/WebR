/**
 * Rebuild Mode (`docs/architecture/01` §3, `06-IMPLEMENTATION-ROADMAP`
 * Phase 5) — GOAL-003.
 *
 * `replay` uses the captured entry DOM and the original (localized) runtime.
 * `rebuild` is the Independent-Agent Reconstruction path: it creates a truly
 * blank authored-source workspace and hands a coding Agent ONLY the frozen
 * evidence (via a Reconstruction Spec) plus the canonical WebR documents.
 * The Agent must generate NEW implementation code — never the captured DOM as
 * final HTML, never the original JS bundle as the replica runtime. Only
 * content assets (images / fonts / SVG / video / audio) may be reused.
 */
import { copyFile, mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mimeTypeFor, buildReconstructionSpec } from './adapter.js';
import type { ReconstructionSpec } from './adapter.js';
import type { Asset } from '../contracts.js';

/** The two reconstruction modes. `replay` remains the backward-compatible default. */
export type ReconstructionMode = 'replay' | 'rebuild';

/**
 * A reusable content asset. Only renderable/audible content (images, fonts,
 * SVG, video, audio) may be reused verbatim in a rebuild. CSS, JS, JSON and
 * HTML are implementation/runtime deps and must be re-authored or mocked by
 * the Agent — reusing them would make a rebuild a disguised replay.
 */
export function isReusableContentAsset(asset: Pick<Asset, 'mimeType' | 'localPath'>): boolean {
  const t = asset.mimeType ?? mimeTypeFor(asset.localPath ?? '');
  if (t === 'image/svg+xml') return true;
  return /^(image|font|video|audio)\//i.test(t);
}

/** Human label for a mode, used in CLI/spec output. */
export function modeLabel(mode: ReconstructionMode): string {
  return mode === 'rebuild' ? 'rebuild (agent-authored)' : 'replay (captured runtime)';
}

const README = `# WebR Rebuild Workspace

This is a **blank, authored-source workspace** for reconstructing a website from
a frozen WebR Evidence Package. It contains no captured HTML and no captured
runtime — every implementation file must be written by a coding Agent.

## Rules (GOAL-003)

1. The Agent may read ONLY:
   - \`spec.json\` (the derived Reconstruction Spec);
   - the frozen Evidence Package it was derived from;
   - the WebR canonical docs (docs/architecture/00..06, docs/agents/).
   The original website must never be contacted.
2. The Agent must **generate new implementation code**. You may NOT:
   - copy a captured DOM snapshot as the final HTML;
   - ship the original site's JS bundle as the replica runtime;
   - depend on the original CSS/JS as final implementation deps.
3. Content assets under \`public/\` (images, fonts, SVG, video, audio) are the
   only captured artifacts allowed to be reused as-is.
4. Authored source MUST follow docs/architecture/05-SOURCE-CONVENTION.md:
   \`wr-*\` component classes, \`is-*\` state classes, \`--wr-*\` design tokens,
   semantic HTML, consistent formatting.
5. The Agent must re-implement (from evidence + spec): hover menu, modal,
   tabs, form/input, scroll header, mobile/responsive menu, routes, animation,
   and API mock/replay behavior.

## Layout to produce

\`\`\`
public/            # served web root (index.html, routes/, assets/)
  index.html       # entry route "/"
  <route>/index.html   # any additional routes from spec.pages
  app.js           # authored runtime (interactions + API mocks)
  styles.css       # authored styles using --wr-* tokens
  cdn/…            # reused content assets (copied from evidence)
\`\`\`

## Verify

\`webr validate <evidence> <workspace>/public --profile full\`

The rebuild passes when full-profile validation returns \`success=true\` with a
clean offline-isolation report and \`transitions.failed = 0\`.
`;

const PLACEHOLDER = ''; // keeps empty scaffold directories tracked

/**
 * Build a Reconstruction Spec enriched with per-state title/heading `outline`
 * and interactive `targets` for agent guidance (P2-2), by reading each state's
 * captured DOM from the frozen evidence. Falls back to the caller's spec when
 * the evidence package cannot be read (e.g. schema-variant edge cases).
 */
async function enrichedSpec(
  evidencePath: string,
  spec: ReconstructionSpec,
): Promise<ReconstructionSpec> {
  try {
    const { readPackage } = await import('../packageIO.js');
    const pkg = await readPackage(evidencePath);
    const domMap: Record<string, string> = {};
    for (const s of pkg.states) {
      if (!s.artifacts.dom) continue;
      try {
        domMap[s.id] = await readFile(join(evidencePath, 'states', s.id, s.artifacts.dom), 'utf8');
      } catch {
        // a state missing its DOM just stays un-enriched
      }
    }
    return buildReconstructionSpec(pkg, domMap);
  } catch {
    return spec;
  }
}

/**
 * Create a blank rebuild workspace from frozen evidence. Copies only reusable
 * content assets, writes an enriched Reconstruction Spec (title/heading outline
 * + interactive targets per state), and leaves every implementation concern to
 * the Agent.
 */
export async function scaffoldRebuildWorkspace(
  spec: ReconstructionSpec,
  evidencePath: string,
  out: string,
): Promise<void> {
  const publicDir = join(out, 'public');
  const srcDir = join(out, 'src');
  await mkdir(publicDir, { recursive: true });
  await mkdir(srcDir, { recursive: true });

  // Write the Agent-facing Reconstruction Spec (enriched with DOM-derived
  // outline/targets so an independent agent can reproduce the recorded
  // structure without reverse-engineering the raw DOM).
  const finalSpec = await enrichedSpec(evidencePath, spec);
  await writeFile(join(out, 'spec.json'), JSON.stringify(finalSpec, null, 2) + '\n');
  await writeFile(join(out, 'README.md'), README);
  await writeFile(join(srcDir, '.gitkeep'), PLACEHOLDER);

  // Reuse only content assets (images/fonts/SVG/video/audio).
  let copied = 0;
  for (const asset of spec.assets) {
    if (!asset.localPath) continue;
    if (!isReusableContentAsset(asset)) continue;
    const src = join(evidencePath, asset.localPath);
    const dest = join(publicDir, asset.localPath);
    try {
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
      copied += 1;
    } catch {
      // missing asset: reported by the validator later
    }
  }
  void copied;
}

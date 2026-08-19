# WebR

WebR is a **local-first Web Reconstruction Toolkit**.

Its purpose is to capture sufficient browser-observable evidence from a website while the source is available, freeze that evidence locally, then let an Agent reconstruct and validate the site **without reopening or depending on the original website**.

## Canonical workflow

```text
Capture → Audit → Reconstruct → Validate
```

## Core artifact

WebR uses a versioned **Website Evidence Package (`*.webr`)** as the canonical handoff between capture and reconstruction.

The package is designed to contain evidence such as:

- pages/routes
- UI states
- interaction transitions / UI State Graph
- screenshots / Golden References
- DOM and accessibility evidence
- computed-style evidence
- assets
- network responses/HAR where captured
- relevant browser storage
- animation/recording evidence
- integrity metadata

## Planned CLI

```bash
webr capture <url> --out <path>
webr audit <evidence-path>
webr reconstruct <evidence-path> --out <replica-path>
webr validate <evidence-path> <replica-path>
```

Only `capture` may require access to the original website. Reconstruction and validation must remain isolated from the source origin.

## Implementation status

The following roadmap phases are implemented (`docs/architecture/06-IMPLEMENTATION-ROADMAP.md`):

- **Phase 1 — Foundation / Contract Layer**: Evidence Package v1 schemas, package I/O, SHA-256 integrity, structural validator, CLI shells.
- **Phase 2 — Capture Baseline**: Playwright + Chromium capture (screenshots, full-page shots, DOM snapshot, accessibility, computed-style evidence, asset localization, capture metadata).
- **Phase 3 — State Explorer / UI State Graph**: interactive-element discovery, action vocabulary, content-derived fingerprint deduplication, bounded BFS exploration, transition recording.
- **Phase 4 — Completeness Audit / Evidence Freeze**: structural validity vs. freeze-readiness, coverage metrics, unresolved external dependency report, Golden Reference coverage.
- **Phase 5 — Reconstruction Adapter**: Reconstruction Spec generation, static replica build from local evidence, source-origin deny policy.
- **Phase 6 — Offline Validator**: local replica server, transition replay, visual diff (pixelmatch) against Golden References, offline-isolation monitoring, machine-readable report.

### Quick start

```bash
# 1. Capture a site into an evidence package (only this step needs network).
webr capture https://example.com --out ./example.webr

# 2. Audit the package (offline). `valid` means structurally valid;
#    `freeze-ready` means complete enough to disconnect from the source.
webr audit ./example.webr

# 3. Reconstruct a local replica from the frozen evidence (offline).
webr reconstruct ./example.webr --out ./replica

# 4. Validate the replica against Golden References (offline).
webr validate ./example.webr ./replica
```

Exit codes follow `docs/architecture/03` §8: `0` success, `1` command failure, `2` invalid arguments, `3` invalid evidence, `4` source-origin isolation violation, `5` validation thresholds not met.

### Development

```bash
npm install
npx playwright install chromium   # required for capture/validate
npm run build
npm test
npm run lint
npm run format:check
```

The capture and validate integration tests launch Chromium against a
controlled local test site; they do not require network access.

## On-demand workflows and browser policy

- **Realtime Debug Workflow** (`docs/agents/realtime-debug-workflow.md`) — on-demand workflow for reproducing, observing, collecting evidence from, and debugging a real web page at runtime (`真实操作 → 观察状态变化 → 获取证据 → 再诊断/修改`). It does not change the default flow.
- **Browser Policy** (`docs/architecture/07-BROWSER-POLICY.md`) — project-wide rule: any WebR activity that needs a live web page MUST use the specified Profile Chrome (CDP `9222`, `$HOME/chrome-debug-profile`). Default Chrome, temporary profiles, headless browsers, and other profiles are forbidden. Default target page: `https://work.trae.cn/`.

## Architecture status

The v1 architecture is frozen at the specification level. Implementation
progresses through the roadmap phases above.

## Canonical architecture documents

- `00-FROZEN-DECISIONS.md`
- `01-SYSTEM-ARCHITECTURE.md`
- `02-EVIDENCE-PACKAGE-SPEC.md`
- `03-CLI-CONTRACT.md`
- `04-VALIDATION-CONTRACT.md`
- `05-SOURCE-CONVENTION.md`
- `06-IMPLEMENTATION-ROADMAP.md`
- `07-BROWSER-POLICY.md`

These documents are the project source of truth. Chat history and Agent prompts are not substitutes for the canonical repository contracts.

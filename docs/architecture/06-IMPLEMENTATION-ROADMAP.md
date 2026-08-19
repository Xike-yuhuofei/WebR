# 06 — Implementation Roadmap

## Purpose

This roadmap translates the frozen architecture into staged implementation work. Each phase must preserve the contracts in `00`–`05` and include automated tests for its acceptance criteria.

## Phase 0 — Canonical foundation

Status: architecture documentation established.

Deliverables:

- `AGENTS.md`
- frozen architecture documents
- explicit deferred-decision list

Exit criteria:

- Agents can determine what is frozen vs deferred without relying on chat history.

## Phase 1 — Foundation / Contract Layer

Goal: create a buildable/testable project with versioned Evidence Package contracts and stable CLI entry points.

Deliverables:

- project/workspace structure
- Evidence Package v1 schemas/data models
- entities for manifest, page, state, transition, asset and integrity metadata
- serialization/deserialization
- package-relative reference validation
- SHA-256 integrity support
- CLI shells for `capture`, `audit`, `reconstruct`, `validate`
- formatter/linter/test baseline
- minimal valid `.webr` fixture

Acceptance criteria:

1. project builds successfully
2. automated tests pass
3. a minimal valid Evidence Package can be created, serialized, read and validated
4. invalid version/reference/checksum cases have tests
5. the four CLI commands exist with documented help, even if later phases still contain explicit `not implemented` behavior

Do **not** implement the full collector or reconstruction engine in this phase.

## Phase 2 — Capture Baseline

Goal: capture a deterministic single page and produce valid local evidence.

Deliverables:

- Playwright + CDP integration
- page navigation/capture lifecycle
- viewport screenshot
- DOM snapshot
- basic accessibility snapshot when available
- basic CSS/computed-style capture strategy
- asset observation/localization baseline
- network/HAR baseline
- capture metadata

Acceptance criteria:

- a simple authorized test site produces a schema-valid package
- core captured resources resolve locally
- package passes Phase-1 structural audit
- capture behavior has integration tests against controlled local fixtures

## Phase 3 — State Explorer / UI State Graph

Goal: model meaningful interactive states and transitions.

Deliverables:

- interactive-element discovery
- action vocabulary implementation
- state fingerprint/deduplication strategy
- bounded exploration policy
- transition recording
- support for representative hover/focus/click/typing/scroll/resize cases

Acceptance criteria:

- controlled interactive fixtures produce the expected State Graph
- duplicate equivalent states are bounded
- loops do not cause unbounded exploration
- state/transition replay metadata is serializable and validated

## Phase 4 — Completeness Audit / Evidence Freeze

Goal: determine whether a package is structurally valid and whether it is ready to be disconnected from the source site.

Deliverables:

- schema/integrity audit
- missing-reference and missing-asset detection
- unresolved external dependency report
- page/state/transition coverage metrics
- viewport/responsive coverage metrics
- Golden Reference coverage
- explicit `valid` vs `freeze-ready` result

Acceptance criteria:

- known incomplete fixtures fail freeze readiness for explicit reasons
- structurally valid but low-coverage packages are not mislabeled complete
- audit requires no source-site access

## Phase 5 — Reconstruction Adapter

Goal: let a coding Agent consume only the frozen package and build a replica.

Deliverables:

- local evidence inspection interface
- Reconstruction Spec generation/derivation
- agent adapter boundary
- source-origin deny policy during reconstruction
- example Agent instructions/workflow

Acceptance criteria:

- reconstruction can run with the source origin unavailable
- attempts to use source-origin resources are surfaced as failures
- adapter-specific details do not leak into Evidence Package semantics

## Phase 6 — Offline Validator

Goal: automatically test replica behavior against Golden References.

Deliverables:

- local replica launch/connect contract
- transition replay
- screenshot capture
- visual diff artifacts
- structural/layout checks where evidence exists
- network/isolation monitoring
- machine-readable validation report

Acceptance criteria:

- controlled correct replica passes configured acceptance policy
- controlled visual/interaction failures are detected
- forbidden source-origin request causes hard failure
- failed checks preserve diagnostic artifacts

## Phase 7 — Packaging / Distribution

Goal: make the CLI straightforward to install and invoke locally and from Agents.

Deliverables:

- versioning/release workflow
- npm distribution if compatible with chosen runtime
- macOS/Linux/Windows distribution path where feasible
- CI release checks
- user-facing README/docs

Acceptance criteria:

- a clean environment can install and run `webr --help`
- released package reports its version and Evidence Package compatibility

## Phase 8 — Optional Desktop GUI

Not part of v1 core.

Potential scope:

- URL/capture configuration
- capture progress
- UI State Graph visualization
- evidence browser
- completeness dashboard
- screenshot/pixel diff viewer

The GUI must wrap core contracts; it may not fork the architecture.

---

# Immediate Agent Goal — GOAL-001

Use this goal for the first implementation iteration:

> **Goal:** Establish the WebR v0.1 Foundation / Contract Layer.
>
> Before coding, read `AGENTS.md` and all referenced canonical architecture documents.
>
> Complete only:
>
> 1. initialize the project structure;
> 2. implement Evidence Package v1 data models/schemas;
> 3. implement manifest, page, state, transition, asset and integrity contracts;
> 4. establish stable CLI shells for `capture`, `audit`, `reconstruct`, `validate`;
> 5. establish format/lint/test infrastructure;
> 6. add automated tests for the core contracts;
> 7. create a minimal valid Evidence Package fixture;
> 8. report any deferred technical decisions that must be resolved before Phase 2.
>
> Do not implement the full website collector, Reconstruction Agent, desktop GUI, or alter frozen decisions.
>
> **Done when:** the project builds/tests successfully and a minimal legal Evidence Package can be created, serialized, loaded and validated.

## Agent execution rule

Each future iteration should receive **one bounded Goal**. Durable decisions discovered during implementation belong in repository documentation/ADRs, not only in prompts or chat transcripts.

---

# Immediate Agent Goal — GOAL-002 (completed)

> **Goal:** Benchmark Site + dynamic replay replica + observable-state validation.

Delivered the controlled two-origin Benchmark Site (`src/benchmark/site.ts`),
a dynamic per-route replay replica, and observable-state transition validation
(`observeFingerprint`). See `tests/benchmark.test.ts`.

---

# Immediate Agent Goal — GOAL-003 — Independent Agent Reconstruction

> **Goal:** prove a Coding Agent can independently rebuild the Benchmark Site in
> a blank project from a frozen Evidence Package, without the source/CDN.

Core workflow:

`Capture → Audit → Freeze Evidence → Source/CDN Offline → Empty Reconstruction Workspace → Agent Reconstruction → Full Validate`

## Deliverables

1. **Two reconstruction modes.** `webr reconstruct --mode replay|rebuild`.
   - `replay` (default) reuses captured HTML/CSS/JS for a high-fidelity offline
     replay.
   - `rebuild` creates a truly blank authored-source workspace (`spec.json`,
     agent `README.md`, reused content assets only — no captured DOM/JS/CSS).
2. **Agent readable inputs.** Only the Evidence Package, the derived
   Reconstruction Spec, and the WebR canonical docs; the original site is never
   accessed.
3. **Agent-authored implementation.** The Agent re-implements hover menu,
   modal, tabs, form/input, scroll header, mobile/responsive menu, routes,
   animation, and API mock/replay. Content assets (images/fonts/SVG/video) may
   be reused.
4. **Authored source convention.** `wr-*` classes, `is-*` state classes,
   `--wr-*` tokens, semantic HTML, consistent formatting (see `05`).
5. **Deterministic validation.** `webr validate --profile full` itself returns
   `success=true`, `transitions.failed=0` — no test-side carve-out for `resize`.
   Root causes fixed: route trailing-slash normalization, and class-agnostic
   fingerprint focus signal + class-stripped action-locator resolution.
6. **Hardened offline isolation.** Validate hard-fails ANY non-local HTTP(S)
   request (source origin, CDN, fonts, analytics, external APIs), not only the
   source origin.
7. **Rebuild Benchmark Regression** (`tests/rebuild.test.ts`): source/CDN off,
   empty workspace scaffolded, Agent-authored replica populated, full-profile
   validation exits `0`.

## Completion criteria

`webr validate <evidence> <replica> --profile full` returns success with all
required states, transitions and isolation checks passing — with no original-site
access and no original-site runtime JS/CSS dependency.

## Agent execution rule

Each future iteration should receive **one bounded Goal**. Durable decisions discovered during implementation belong in repository documentation/ADRs, not only in prompts or chat transcripts.

# 00 — Frozen Decisions

**Status:** FROZEN  
**Scope:** WebR v1 architecture  
**Change policy:** These decisions may change only after explicit user authorization. Implementation convenience is not sufficient reason to change them.

## Product definition

WebR is a **local-first Web Reconstruction Toolkit** for rebuilding a web experience from a previously captured evidence package without reopening or querying the original website during reconstruction.

## Frozen decisions

### D-001 — Core workflow

The canonical workflow is:

`Capture → Audit → Reconstruct → Validate`

- **Capture** may access the original website.
- **Audit** evaluates the captured package and must not require the original website.
- **Reconstruct** must not access the original website.
- **Validate** must not access the original website.

### D-002 — Offline isolation is an invariant

After capture is frozen, reconstruction and validation must not depend on the original origin, its CDN, APIs, fonts, scripts, images, or other online resources from that site.

Any attempted dependency on the original site during `reconstruct` or `validate` is a correctness failure, not a warning.

### D-003 — Canonical intermediate representation

The main handoff artifact is a versioned **Website Evidence Package**. It is the canonical IR between capture and reconstruction.

Agent prompts are not the system of record for durable project knowledge.

### D-004 — Capture engine

The capture engine uses **Playwright + Chrome DevTools Protocol (CDP)** as the primary browser-observation stack.

Capture is limited to information observable from an authorized browser session. WebR does not require private source code, private backend implementation, database access, authentication bypass, or exploitation.

### D-005 — State-oriented evidence

WebR captures **observable UI states**, not merely pages.

The package models interactions as a directed **UI State Graph**:

`State --Action--> State`

Important observable state includes default, hover, focus, active, selected, expanded/collapsed, loading, empty, error/success, scroll-dependent state, responsive state, route state, and modal/menu/tab state when present.

### D-006 — Golden references

Captured screenshots and state/transition evidence are **Golden References** for offline validation.

Validation must be able to replay recorded actions against the reconstructed site and compare the result to stored evidence.

### D-007 — Product form

The v1 core product is a **local CLI**. Core behavior must not depend on a GUI.

The stable public command surface is:

- `webr capture`
- `webr audit`
- `webr reconstruct`
- `webr validate`

A desktop GUI is post-v1 and may only wrap the same core contracts.

### D-008 — Agent independence

WebR must not bind reconstruction knowledge to one coding agent.

Codex/Claude/Cursor/MCP/other integrations are adapters around stable WebR contracts. The Evidence Package and CLI remain agent-independent.

### D-009 — Source convention

Authored reconstruction source follows:

- WHATWG-compatible semantic HTML
- SUIT CSS-inspired component naming
- WebR namespace for authored component classes/tokens
- explicit state classes
- consistent automatic formatting (Prettier where supported)

The detailed contract is defined in `05-SOURCE-CONVENTION.md`.

### D-010 — Validation over demo convenience

A visually convincing single screenshot is not sufficient. WebR prioritizes reproducible evidence, interaction coverage, responsive behavior, offline isolation, and deterministic validation over quick demos.

### D-011 — Distribution direction

The intended distribution model is:

- GitHub repository
- single local CLI
- npm-installable package when implementation permits
- cross-platform release artifacts for macOS/Linux/Windows when feasible
- Homebrew distribution may be added later

The implementation language/runtime is **not frozen yet**.

## Explicitly out of scope for v1

- recovering private website source code
- reproducing private databases or backend internals
- bypassing login, authorization, anti-bot, DRM, or access controls
- depending on the original website after capture
- GUI-first architecture
- exhaustive brute-force enumeration of all combinatorial UI states

## Deferred decisions

The following are intentionally not frozen yet:

- implementation language/runtime
- package manager and monorepo tooling
- reconstruction framework (React/Vue/etc.)
- exact visual-diff thresholds
- exact state-exploration scoring algorithm
- final binary packaging mechanism

Agents must not silently promote a deferred decision into a frozen architectural rule.

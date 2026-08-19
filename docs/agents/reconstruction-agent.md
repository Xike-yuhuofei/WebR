# Reconstruction Agent Workflow

**Phase 5 deliverable — example Agent instructions/workflow.**

This document is the durable, agent-neutral guidance for a coding Agent that
reconstructs a website from a frozen WebR Evidence Package. It is an adapter
around the stable Evidence Package contract (`docs/architecture/02`); it does
not change that contract.

## Roles and boundaries

| Role          | Required access | Purpose                                           |
| ------------- | --------------- | ------------------------------------------------- |
| `capture`     | source site     | collect evidence into a `*.webr` package          |
| `audit`       | local only      | confirm the package is `valid` and `freeze-ready` |
| `reconstruct` | local only      | build a replica from frozen evidence              |
| `validate`    | local only      | check the replica against Golden References       |

A reconstruction Agent must **never** open, query, or depend on the original
source origin, its CDN, APIs, fonts, scripts or images after evidence freeze.

## Two reconstruction modes

`webr reconstruct <evidence> --out <path> [--mode replay|rebuild]`

### `replay` (default)

Reuse the captured HTML/CSS/JS to produce a high-fidelity offline replay. This
is the fastest path when the captured runtime is self-contained; it still
localizes assets and rewrites the captured DOM so nothing reaches the source
origin.

### `rebuild` (Independent Agent Reconstruction — GOAL-003)

Create a **truly blank authored-source workspace** for a coding Agent that
independently re-implements the site from frozen evidence only.

- The workspace contains **no captured DOM** and **no captured runtime**: only
  a derived `spec.json`, an agent `README.md`, and reused _content_ assets
  (images / fonts / SVG / video / audio).
- The Agent must **generate new implementation code**. It may NOT:
  - copy a captured DOM snapshot as the final HTML;
  - ship the original JS bundle as the replica runtime;
  - depend on the original CSS/JS as final implementation deps.
- Authored source must follow `docs/architecture/05-SOURCE-CONVENTION.md`
  (`wr-*` classes, `is-*` state classes, `--wr-*` tokens, semantic HTML).
- The Agent must re-implement: hover menu, modal, tabs, form/input, scroll
  header, mobile/responsive menu, routes, animation, and API mock/replay.
- The validator resolves captured actions class-agnostically (id + tag +
  sibling order), so authored `wr-*` classes replay the same observable
  interactions recorded from the original classes.

## Inputs the Agent consumes

Run `webr audit <evidence-path>` first. The Agent should read:

- `manifest.json` — capture metadata and source provenance (metadata only).
- `pages/index.json` — page/route families and their states.
- `states/<id>/metadata.json` — viewport, scroll, artifacts, fingerprint.
- `states/<id>/dom.html` — the observable DOM at that state.
- `states/<id>/computed-styles.json` — computed-style evidence (when captured).
- `states/<id>/accessibility.json` — accessibility evidence (when captured).
- `transitions/state-graph.json` — the UI State Graph (actions between states).
- `assets/index.json` — localized assets and their original URLs.

The Reconstruction Spec (`webr reconstruct --mode rebuild` derives `spec.json`)
is a convenience view of the same facts; the Evidence Package remains the
source of truth.

## Workflow

1. **Audit.** `webr audit <evidence-path>`. Only proceed to reconstruction when
   the package is `freeze-ready` (or the human explicitly overrides the gate).
2. **Inventory.** Read pages, states, and the transition graph. Note the
   viewport(s) and the Golden Reference states that `validate` will check.
3. **Reconstruct.** Choose a mode.
   - `replay` — reuse captured HTML/CSS/JS for a fast high-fidelity offline
     replay.
   - `rebuild` — `webr reconstruct <evidence> --out <workspace> --mode rebuild`
     scaffolds a blank authored-source workspace, then author fresh code
     (HTML/CSS/JS) so that each state's observable behavior (DOM, text, layout,
     interaction) is reproducible from local evidence.
   - Map captured content assets (images/fonts/SVG/video) to local files; never
     fetch from the source origin.
   - Keep authored source following
     `docs/architecture/05-SOURCE-CONVENTION.md` (`wr-` namespaced component
     classes, `is-` state classes, `--wr-` tokens).
4. **Self-check isolation.** Ensure no generated page references the source
   origin or any external CDN/font/analytics/API. `webr reconstruct` already
   refuses unlocalized source-origin assets and scans generated HTML; a manual
   grep for the origin is a good second check.
5. **Validate.** `webr validate <evidence-path> <replica-path> --profile full`.
   Any non-local HTTP(S) request -source origin, CDN, fonts, analytics, external
   APIs- is a hard `offline-isolation violation` (exit code 4). A rebuilt
   replica passes only when `success=true`, `transitions.failed=0` and every
   isolation check is clean.

## Acceptance semantics

A replica is validated only when, per `docs/architecture/04`:

1. evidence input is valid,
2. there are no offline-isolation violations,
3. required Golden States are reproducible,
4. required transitions pass,
5. configured visual/structural thresholds are met.

Visual evidence is a Golden Reference, not a suggestion: do not silently
weaken diff tolerance to make a test pass.

## Example Agent prompt

```text
Reconstruct the site from the evidence package at ./example.webr into
./replica using only local evidence. First run `webr audit ./example.webr`
and read the package files listed in docs/agents/reconstruction-agent.md.
Never contact https://example.com or any of its resources. Follow
docs/architecture/05-SOURCE-CONVENTION.md for authored source. When done, run
`webr validate ./example.webr ./replica` and iterate until it passes with a
clean isolation report and exit code 0.
```

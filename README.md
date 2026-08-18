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

## Architecture status

The v1 architecture is currently frozen at the specification level. Implementation begins with the Foundation / Contract Layer.

Start here:

1. [`AGENTS.md`](./AGENTS.md)
2. [`docs/architecture/00-FROZEN-DECISIONS.md`](./docs/architecture/00-FROZEN-DECISIONS.md)
3. [`docs/architecture/06-IMPLEMENTATION-ROADMAP.md`](./docs/architecture/06-IMPLEMENTATION-ROADMAP.md)

## Canonical architecture documents

- `00-FROZEN-DECISIONS.md`
- `01-SYSTEM-ARCHITECTURE.md`
- `02-EVIDENCE-PACKAGE-SPEC.md`
- `03-CLI-CONTRACT.md`
- `04-VALIDATION-CONTRACT.md`
- `05-SOURCE-CONVENTION.md`
- `06-IMPLEMENTATION-ROADMAP.md`

These documents are the project source of truth. Chat history and Agent prompts are not substitutes for the canonical repository contracts.

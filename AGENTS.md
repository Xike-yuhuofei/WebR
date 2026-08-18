# WebR Agent Instructions

WebR is a local-first Web Reconstruction Toolkit.

Before starting any implementation work, read these canonical documents in order:

1. `docs/architecture/00-FROZEN-DECISIONS.md`
2. `docs/architecture/01-SYSTEM-ARCHITECTURE.md`
3. `docs/architecture/02-EVIDENCE-PACKAGE-SPEC.md`
4. `docs/architecture/03-CLI-CONTRACT.md`
5. `docs/architecture/04-VALIDATION-CONTRACT.md`
6. `docs/architecture/05-SOURCE-CONVENTION.md`
7. `docs/architecture/06-IMPLEMENTATION-ROADMAP.md`

## Rules

- The files above are the project's canonical source of truth.
- Do not modify frozen decisions unless the user explicitly authorizes an architecture change.
- Do not redesign an already frozen contract for implementation convenience.
- Reconstruction and validation must not depend on access to the original website.
- Do not weaken evidence capture, offline isolation, or validation guarantees to make a demo easier.
- Prefer stable data contracts before feature implementation.
- Every implementation phase must include automated tests for its acceptance criteria.
- When repository code conflicts with a frozen decision, preserve the frozen decision and report the conflict.
- Keep agent prompts task-scoped; durable project knowledge belongs in the repository documentation.

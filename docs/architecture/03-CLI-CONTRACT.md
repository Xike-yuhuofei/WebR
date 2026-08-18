# 03 — CLI Contract

**Status:** Frozen public command surface for v1.

## 1. Stable commands

```bash
webr capture <url> --out <path>
webr audit <evidence-path>
webr reconstruct <evidence-path> --out <replica-path>
webr validate <evidence-path> <replica-path>
```

The exact internal implementation is deferred. The command semantics below are canonical.

## 2. `webr capture`

Purpose: collect browser-observable evidence from an authorized source website and produce a Website Evidence Package.

Baseline behavior:

- launch/control a Chromium browser through Playwright + CDP
- collect page/state/asset/network evidence according to capture policy
- localize observable resources where possible
- build/update the UI State Graph
- write a versioned package
- produce capture summary and unresolved-evidence warnings

The command may access the source website.

Example:

```bash
webr capture https://example.com --out ./example.webr
```

## 3. `webr audit`

Purpose: evaluate package integrity and evidence completeness without reopening the source website.

Baseline checks:

- schema/version validity
- checksum integrity
- referential integrity
- required artifacts present
- unresolved external-resource references
- page/state/transition coverage summary
- viewport/responsive coverage summary
- Golden Reference availability

`audit` must distinguish:

- **valid package** — structural validity
- **freeze-ready package** — policy-defined evidence completeness

A valid package is not automatically freeze-ready.

## 4. `webr reconstruct`

Purpose: provide the frozen evidence to a reconstruction workflow/Agent and produce a local replica.

Hard requirement:

> `reconstruct` must not access the original source origin or depend on original-site online resources.

The reconstruction implementation may be agent-specific behind an adapter, but the CLI contract remains stable.

Example:

```bash
webr reconstruct ./example.webr --out ./replica
```

## 5. `webr validate`

Purpose: validate the reconstructed replica exclusively against local evidence and Golden References.

Baseline behavior:

- run the replica locally
- enforce source-origin isolation
- replay selected State Graph transitions
- capture actual screenshots/states
- compare expected vs actual behavior
- emit validation metrics and failures

Example:

```bash
webr validate ./example.webr ./replica
```

## 6. Common options

The implementation must reserve consistent support for:

```text
--help
--version
--json
--verbose
--quiet
```

Where practical, commands that write artifacts should support an explicit output path rather than relying on implicit global state.

## 7. Structured output

`--json` should emit machine-readable results suitable for Agents and CI.

A command result should logically contain:

```json
{
  "command": "audit",
  "success": true,
  "version": "...",
  "summary": {},
  "warnings": [],
  "errors": []
}
```

Exact field expansion may evolve under versioning, but existing field meaning must remain stable.

## 8. Exit-code contract

v1 reserves:

- `0` — success / acceptance criteria met
- `1` — command execution failure
- `2` — invalid arguments or configuration
- `3` — invalid/corrupt/incomplete evidence according to required policy
- `4` — offline/source-origin isolation violation
- `5` — validation completed but acceptance threshold not met

Additional codes require documentation and must not silently redefine these values.

## 9. Network contract

### Capture

Source-site network access is allowed because it is the acquisition phase.

### Audit

Must not require access to the source origin.

### Reconstruct

Source-origin access is forbidden.

### Validate

Source-origin access is forbidden. A detected attempt is a validation failure even if the request itself fails.

## 10. Determinism and automation

Commands should be:

- non-interactive by default when all required arguments are supplied
- scriptable in CI
- safe for Agent invocation
- explicit about output locations
- deterministic for the same inputs/policy where browser nondeterminism does not prevent it

Interactive helpers may be added later without changing the core non-interactive contract.

## 11. Configuration

Capture/validation policy configuration is allowed, but configuration must be serializable and inspectable. Hidden per-machine state must not change canonical behavior without being reported.

Exact config-file format is deferred until the foundation implementation phase.

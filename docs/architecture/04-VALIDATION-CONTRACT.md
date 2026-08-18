# 04 — Validation Contract

## 1. Principle

Validation compares a local replica against the frozen Website Evidence Package. It must not reopen, query or depend on the original website.

The source of truth is captured evidence, not developer memory and not the current state of the original site.

## 2. Validation layers

### V-1 — Package integrity

Check:

- supported Evidence Package version
- schema validity
- checksums
- required files
- referential integrity

Failure here prevents meaningful replica validation.

### V-2 — Offline isolation

The replica must not request the original source origin or any original-site resource that was required to be localized/mocked.

Validation must observe network activity and report attempted forbidden requests.

An offline-isolation violation is a hard failure.

### V-3 — State reproducibility

For each selected Golden State, validation must be able to establish the recorded context where reproducible evidence exists, including relevant:

- route
- viewport
- scroll position
- local state/mocks
- focus/overlay/component state

### V-4 — Transition behavior

Replay recorded actions from the UI State Graph and verify that the replica reaches the expected observable result.

At minimum report:

- transition attempted
- target resolution success/failure
- action execution success/failure
- expected destination state
- observed destination fingerprint/result

### V-5 — Visual comparison

Capture the replica at the same viewport/context as each Golden Reference and compare expected vs actual.

The validator should support:

- pixel/image diff
- changed-area percentage
- diff artifact output
- configurable masking/tolerance for known nondeterministic regions

Exact pass thresholds are deferred and must be explicit configuration, never hidden constants.

### V-6 — Structural/layout comparison

Where evidence exists, validation may compare:

- DOM presence/semantics
- bounding boxes
- visibility
- text content
- computed-style properties
- accessibility structure

Structural comparison supplements visual comparison; it does not replace it.

### V-7 — Asset completeness

Report:

- missing local assets
- broken resource mappings
- substituted/mocked resources
- unexpected online fetches

## 3. Golden Reference policy

Golden References are immutable after Evidence Freeze except through explicit recapture/versioning.

Each required Golden State should identify:

- state ID
- viewport
- screenshot
- context metadata
- replay path or setup requirements when available

## 4. Validation profiles

Validation may define profiles, for example:

- `smoke` — representative critical states/transitions
- `standard` — normal acceptance coverage
- `full` — all replayable Golden States/transitions

Profile names and exact selection algorithms may be refined during implementation, but validation results must always state what was actually tested.

## 5. Result model

A validation report should logically include:

```json
{
  "success": false,
  "profile": "standard",
  "isolation": { "passed": true, "violations": [] },
  "states": {
    "tested": 12,
    "passed": 10,
    "failed": 2
  },
  "transitions": {
    "tested": 18,
    "passed": 17,
    "failed": 1
  },
  "visual": {
    "comparisons": []
  },
  "failures": []
}
```

Human-readable output and machine-readable JSON must describe the same underlying result.

## 6. Acceptance semantics

A replica is not considered validated merely because it starts successfully.

A policy-defined pass must require:

1. valid evidence input
2. no offline-isolation violations
3. required Golden States reproducible
4. required transitions passing
5. configured visual/structural thresholds met

The exact numeric thresholds are deferred until empirical calibration.

## 7. Nondeterminism

Known nondeterministic content must be handled explicitly through evidence/configuration, e.g.:

- timestamps
- randomized content
- video frames
- cursors/carets
- system-rendered differences
- dynamic ads or remote widgets

The validator must not silently broaden tolerance until a test passes.

## 8. Failure artifacts

For every failed visual/state/transition check, validation should preserve enough local artifacts to diagnose the failure, such as:

- actual screenshot
- expected screenshot reference
- diff image
- state metadata
- console/network errors
- action replay trace

## 9. Core invariant

If successful validation requires consulting the live original website, the validation design is incorrect.

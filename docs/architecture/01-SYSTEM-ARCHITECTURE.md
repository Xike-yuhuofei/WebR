# 01 — System Architecture

## 1. Purpose

WebR separates online evidence acquisition from offline reconstruction so that the reconstructed site can be built and verified without reopening the source site.

## 2. Canonical data flow

```text
Original Website
    ↓
Capture Engine
    ↓
State Explorer
    ↓
Evidence Writer
    ↓
Website Evidence Package
    ↓
Completeness Auditor
    ↓
[Evidence Freeze / Original Site Disconnected]
    ↓
Reconstruction Adapter / Agent
    ↓
Replica
    ↓
Offline Validator
    ↓
Validation Report
```

## 3. Logical modules

### Capture Engine

Responsibilities:

- launch and control browser sessions
- collect DOM/HTML, accessibility data, screenshots and browser metadata
- observe CSS/CSSOM/computed style where available
- capture assets, network traffic and relevant browser storage
- collect responsive and scroll-dependent evidence
- write observations through the Evidence Writer

Primary stack: Playwright + CDP.

### State Explorer

Responsibilities:

- discover interactive elements
- execute bounded actions such as hover, focus, click, typing, keyboard input, scrolling, dragging and viewport resizing
- detect meaningful observable changes
- deduplicate equivalent states
- produce transitions for the UI State Graph
- prioritize interaction coverage instead of brute-force Cartesian enumeration

### Evidence Writer

Responsibilities:

- normalize captured observations into the Evidence Package contract
- allocate stable IDs
- localize assets
- maintain original-resource → local-resource mappings
- compute integrity hashes
- keep package references relative and portable

### Completeness Auditor

Responsibilities:

- validate package schema and referential integrity
- identify missing assets/evidence
- measure route/state/interaction/responsive coverage
- identify unresolved online dependencies
- block evidence freeze when mandatory requirements fail

### Reconstruction Adapter

Responsibilities:

- expose the frozen Evidence Package to an implementation Agent
- generate or maintain a Reconstruction Spec derived from evidence
- support any coding agent without changing the core Evidence Package contract
- enforce the no-original-site rule during reconstruction

The adapter is not the canonical source of truth; the package is.

### Offline Validator

Responsibilities:

- run the replica in an isolated environment
- replay recorded transitions
- capture actual screenshots/states
- compare actual output with Golden References
- detect external dependency violations
- emit machine-readable and human-readable validation results

### CLI

Responsibilities:

- expose the four stable workflows: `capture`, `audit`, `reconstruct`, `validate`
- keep core behavior scriptable for humans, CI and Agents
- provide deterministic exit codes and optional structured output

### Desktop GUI — future

A future GUI may visualize capture progress, State Graphs, Golden References and diffs, but it must invoke the same core modules/contracts rather than reimplement them.

## 4. Trust and network boundaries

### Online zone

Only `capture` is expected to require source-site access.

### Offline zone

`audit`, `reconstruct` and `validate` operate from local evidence. Audit may optionally use non-source local tooling, but must never need the source origin to establish completeness.

`reconstruct` and `validate` must fail if the replica attempts to fetch source-origin resources.

## 5. State model

A state is a reproducible observable browser condition, not simply a URL.

A state may differ by:

- DOM/visibility
- component state
- viewport
- scroll position
- route/query/history
- local browser state
- overlay/menu/modal state
- responsive breakpoint
- visual result

A transition contains:

```text
from_state
+ action
+ target
+ action parameters
→ to_state
```

The graph must permit deterministic replay when sufficient evidence exists.

## 6. Evidence freeze gate

Before the source site is considered disconnected, `audit` must at minimum establish:

- package schema validity
- no broken mandatory references
- required Golden References present
- captured assets resolvable locally
- transition graph structurally valid
- required target viewports represented
- unresolved external dependencies reported

Coverage quality is reported explicitly; it must never be implied by successful schema validation alone.

## 7. Architecture principles

1. Evidence before implementation.
2. Contracts before convenience.
3. Observable behavior over inferred private implementation.
4. Portable local artifacts over hidden online dependencies.
5. Deterministic replay over manual visual memory.
6. Coverage-driven exploration over state explosion.
7. Agent adapters are replaceable; Evidence Package semantics are stable.

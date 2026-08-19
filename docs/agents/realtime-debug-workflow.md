# Realtime Debug Workflow

**On-demand workflow** for reproducing, observing, collecting evidence from, and debugging a real web page at runtime.

It is a **workflow, not a command** — it does not change the default `Capture → Audit → Reconstruct → Validate` development flow and does not add a CLI surface.

## Browser rule

All browser usage in this workflow MUST follow `docs/architecture/07-BROWSER-POLICY.md`:

- use the specified Profile Chrome (`$HOME/chrome-debug-profile`, CDP port `9222`)
- connect via `http://[::1]:9222` (probe `http://[::1]:9222/json/version` first; verify with `lsof -nP -iTCP:9222`)
- reuse the existing login state; NEVER re-login; NEVER take over the daily Chrome
- default Chrome, temporary profiles, headless browsers, and other profiles are forbidden

## Default target

When no target is given, operate on `https://work.trae.cn/`.

## Sequence

The workflow follows a fixed order:

```text
真实操作 → 观察状态变化 → 获取证据 → 再诊断/修改
```

### Step 1 — 真实操作 (operate the real page)

- Connect to the debug Chrome over CDP (Browser Policy §2–§3).
- Navigate to the target page (default `https://work.trae.cn/`).
- Drive the real UI like a user would; do not settle for a static DOM snapshot.

### Step 2 — 观察状态变化 (observe state changes)

- Record the observable contract around each interaction: class and selected state, URL, title, scroll, visibility, request timing — before and after the action.
- Inspect DOM/CSS and observe network for the states that changed.

### Step 3 — 获取证据 (collect evidence)

- Capture screenshots, DOM snapshots, computed styles, and console/network evidence at each observed state.
- Keep the evidence in the workspace (e.g. under a `debug/` output directory) so the diagnosis is reproducible and auditable.

### Step 4 — 再诊断/修改 (diagnose, then modify)

- Diagnose from the collected evidence before editing code.
- Modify, then re-verify in the debug Chrome by replaying the same user path — not a single static screenshot.

## Scope

- On-demand only: do not change the default WebR flow or the stable CLI.
- Do not weaken evidence capture, offline isolation, or validation guarantees (`00-FROZEN-DECISIONS.md` D-002/D-010).

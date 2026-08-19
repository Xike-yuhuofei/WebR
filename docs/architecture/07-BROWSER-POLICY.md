# 07 — Browser Policy

**Status:** Canonical project-wide policy.
**Applies to:** every WebR activity that needs a live web page.
**Browser parameters:** inherited verbatim from the existing `traework-web` skill (`SKILL.md`). This policy is the durable rule; the skill remains the operating manual for the debug Chrome.

## 1. The rule

Any WebR behavior that needs a real web page MUST use the **specified Profile Chrome**:

- webpage access
- UI verification (UI 实测)
- E2E testing
- screenshots
- DOM/CSS inspection
- network observation
- browser automation
- realtime debugging

The following are FORBIDDEN as a bypass of this rule:

- default Chrome
- temporary profiles
- headless browsers
- any other profile than the specified one

## 2. Inherited parameters (from SKILL.md)

| Item                   | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| Chrome profile         | `$HOME/chrome-debug-profile`                                   |
| Chrome executable      | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| CDP port               | `9222`                                                         |
| CDP probe (IPv6 first) | `http://[::1]:9222/json/version`                               |
| Playwright/CDP connect | `chromium.connectOverCDP('http://[::1]:9222')`                 |
| Listener verification  | `lsof -nP -iTCP:9222`                                          |

Launch the debug Chrome only when it is not already running:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-debug-profile"
```

## 3. Mandatory checks before use

1. Probe CDP over IPv6 first: `curl -sS "http://[::1]:9222/json/version"`. The instance may listen on `[::1]` only; `127.0.0.1:9222` may fail.
2. Connect Playwright via `chromium.connectOverCDP('http://[::1]:9222')`. Minimize `browser.close()` and reconnects in the same session to avoid repeated attaches.
3. Verify the listener with `lsof -nP -iTCP:9222`: the process holding port 9222 MUST have been launched with `--user-data-dir=.../chrome-debug-profile`. If the default/daily Chrome occupies the port, stop that instance (or switch the debug instance to another port) before proceeding.

## 4. Reuse, do not recreate

- The login state lives in `$HOME/chrome-debug-profile`. Reuse an existing session.
- NEVER re-login to a service that is already logged in.
- NEVER take over the daily Chrome: do not attach via `chrome://inspect/#remote-debugging` on the daily browser.
- Do NOT add `--remote-debugging-port` to the default configuration; the flag is often ignored while the daily Chrome is running.

## 5. Default target

When a workflow does not specify a target, the default web page is `https://work.trae.cn/`.

## 6. Relationship to the capture engine (frozen exception)

The capture engine (`src/capture/browser.ts`, `docs/architecture/01` §3) launches a deterministic headless Chromium with a clean profile and a fixed user agent. That behavior is FROZEN by `00-FROZEN-DECISIONS.md` D-004 and D-010 because deterministic evidence and offline isolation are invariants.

This policy therefore governs agent- and human-driven web activities (the behaviors listed in §1). The capture engine is the single documented exception; it is not a permitted bypass for interactive work. Any change to the capture engine's browser behavior requires an explicit change to the frozen decisions and is out of scope for this policy.

### Authenticated-capture exception (`--cdp`)

A login-gated product cannot be observed by a fresh headless profile. For such
targets ONLY, capture may connect to the Profile Chrome via CDP (`--cdp`, see
`03-CLI-CONTRACT.md` §2) so the captured page inherits the authenticated
session. Rules specific to this path:

- Connect via `chromium.connectOverCDP('http://[::1]:9222')` (probe IPv6 first).
- Open the capture page in the inspected browser's **default context**; never
  create a throwaway context for an authenticated target (it would lose login).
- When the session closes, close ONLY the capture page. Never `browser.close()`
  on the shared Chrome — the operator may have other tabs and sessions open.
- This path is for authenticated capture only; it does not change the frozen
  deterministic headless default for ordinary (non-authenticated) targets.

## 7. Relationship to the default development flow

This policy and the realtime-debug-workflow are ON-DEMAND. They do not change the canonical `Capture → Audit → Reconstruct → Validate` flow (`00` D-001) nor the stable CLI surface (`03` D-007).

# GOAL-004 — Real-World Reconstruction Stress Test: Gap Report

**Target:** general-purpose capture of a live, complex, unknown site (no site-specific
selector / interaction rule / CSS-JS patch / validator exception / hardcode).

**Date:** 2026-08-19
**Tool:** WebR v0.1.0 (webr-evidence v1.0.0)

---

## 1. Real-World Benchmark Report

| Item | Benchmark Site (fixtures/benchmark.webr) | Real-World #1: cursor.com | Real-World #2: vitejs.dev (frozen full pipeline) |
|---|---|---|---|
| Target class | synthetic static/dynamic fixture | heavily JS/WebGL marketing SPA | SSR marketing + docs (VitePress) |
| Pages/routes captured | 1 (multi-route fixture) | 1 (`/`) | 1 (`/`) + nav routes `/guide`, `/config`, `/plugins`, `/blog/*` |
| States | 18 | **2** | **18** |
| Transitions | 18 | **4** | **18** |
| Action types seen | click/hover/tabs/modal/form/scroll | click | click (flyout/subnav/top-banner/search) |
| Viewports | 1440×900 | 1440×900 | 1440×900 (single) |
| Assets | ~3 | **179** | **616** (localized 616/616) |
| External origins | (localized) | 10+ (hreflang aliases flagged) | **0** frozen |
| Package size | small | 16 MB | **78 MB** |
| Capture duration budget | — | 120 s (exhausted) | 120 s (exhausted) |
| Frozen (freeze-ready) | yes | **NO** (error screen + hreflang false positives) | **YES** |
| Full validate | PASS (GOAL-003) | — | **FAIL** (see §4) |

---

## 2. Evidence Coverage Report

### vitejs.dev evidence package (frozen)
- `webr audit` → `valid: true`, `freeze-ready: true`
- coverage: 18 states / 18 golden / 18 replayable transitions / 18 DOM / 18 screenshots / 18 computed-styles / 18 accessibility
- assets: 616 localized out of 616; **0 unresolved external deps**
- freeze blockers: **none**

### captured evidence weaknesses identified during the run
1. **Single-viewport capture.** All 18 states are 1440×900. No responsive/mobile states captured even though vite.dev is responsive → responsive state evidence is missing from the start.
2. **Shallow state graph.** All 18 transitions emanate from the single root state; every "overlay/flyout/search" state is a distinct node. Overlay interaction operated but the graph never deepens (no chained overlay→overlay).
3. **Huge asset bloat from analytics/CDN.** cursor.com captured 179 assets of which a large share are tracking beacons (facebook, snap, tiktok, reddit, vercel, google, statsig, GTM) — evidence package contains third-party analytics as "localized assets", inflating size and mixing runtime deps into content.

### cursor.com evidence (rejected)
- Root and secondary states are **Next.js error boundaries** (`"Something went wrong"`), not the real page — the headless capture raced hydration; the screenshot golden is useless.
- A retry was answered by a **Vercel Security Checkpoint** page (`/.well-known/vercel/security/`), i.e. anti-bot challenge.
- `webr audit` correctly reported `freeze-ready: false`, blocked by 10 × `hreflang` same-origin alias URLs. The 10 "unresolved external dependencies" are `<link rel="alternate" hreflang>` **navigation metadata**, not fetched resources → **auditor false positive** (it statically scans `href=` and cannot distinguish a fetch dependency from an alternate-language link).

---

## 3. Reconstruction Result

- Mode: `webr reconstruct <vite.webr> --out vite-rebuild --mode rebuild` → blank authored workspace.
- Agent (this session) authored from frozen evidence only:
  - `public/index.html` (hero, nav with flyouts, tabs, banner, search modal, social links, footer)
  - `public/styles.css`, `public/app.js`
  - routes `guide/`, `config/`, `plugins/`, `blog/cloudflare-supports-vite/`
  - reused content assets (logo SVG, sponsor SVG/PNG, fonts) copied by the scaffold.
- **Reuse constraint honored:** no captured DOM served as final HTML; no original JS/CSS shipped as runtime; interactions reimplemented in `app.js`.
- Authored source follows `docs/architecture/05-SOURCE-CONVENTION.md` (`wr-*` classes, `is-*` states, `--wr-*` tokens, semantic HTML).

---

## 4. Validation Result

Command: `webr validate realworld/vite.webr realworld/vite-rebuild/public --profile full`

| Check | Result |
|---|---|
| Package integrity | OK |
| **Offline isolation** | **CLEAN** — 0 non-local HTTP(S) requests |
| States | **0/18 passed** (18 failed) |
| Transitions | **0/18 passed** (18 failed) |
| Visual comparisons | 5 executed (only entry states reachable); root diff **86.27%** |
| Structural | entry states: many missing headings/titles |
| Exit code | **5** (thresholds not met) |

**Isolation held** — the single most important real-world invariant (reconstruction runs fully offline against a live-scale site). Visual/structural/transition fidelity did not.

---

## 5. Gap Classification

Every failure was bucketed; **no code was patched**, no site-specific hack applied,
no threshold relaxed, no replay-as-rebuild.

### A. Evidence Missing
- **A1** No responsive/mobile states captured (single 1440×900 viewport) → no way to validate mobile.
- **A2** No scroll-dependent states captured (hero is above the fold; the page is long) — scroll evidence absent.
- **A3** cursor.com states are error boundaries, not real content → the golden references are corrupt; capture has no "is this a useful screenshot?" gate.
- **A4** Transition action params (hover depth, focus) not captured for flyout sub-links; only `click` interactions present.

### B. State Exploration Missing
- **B1** State graph never deepens: all 18 transitions radiate from one root; overlay states are leaves, not expanded onward.
- **B2** Time-budget exhaustion on both real sites (explorer re-navigates to root + replays path for each action → O(states×actions) full-page reloads; slow on heavy pages).
- **B3** Explorer discovered 0 meaningful states for cursor.com (19 skipped `action-failed`) because hydration/animation raced the fingerprint.

### C. Locator/Replay Failure
- **C1** All 18 transitions failed with `action failed to execute`: recorded locators are deep Tailwind/VitePress structural selectors (`#app > div.marketing-layout > … > a.VPLink.link`). `stripCssClasses` strips classes but the rebuilt DOM intentionally differs, so structural resolution fails.
- **C2** No captured `id`/`data-testid`/ARIA target fallback on the real site (evidence only has CSS paths) → rebuild cannot reproduce a stable locator.
- **C3** Transition actions run against route-entry states; overlay states can't even be *established* during context setup (`could not be validated: transition … failed during context setup`).

### D. Visual Evidence Insufficient
- **D1** Root diff 86.27% — a faithful-authored replica of a real marketing page diverges wildly in pixels (fonts, gradients, svg, spacing, images) while being semantically correct.
- **D2** Visual compare resizes nearest-neighbour to the larger canvas, punishing responsive shifts; only 5/18 states even reached a screenshot because route-entry failed.
- **D3** No masking/tolerance for animation, cursor, video, or live numbers (80k+, 80m+) on real sites → threshold 3% is unachievable generally.

### E. Animation / Timing
- **E1** cursor.com hydration race → error-boundary golden states.
- **E2** Explorer/animation overlap: hover-intent and flyout-open states differ from settled state; 250 ms settle is too short on real UIs.

### F. Responsive
- **F1** No responsive evidence at all (see A1). Validator left fine, but nothing to verify.

### G. Network / API
- **G1** Vercel Security Checkpoint (anti-bot) on retry: generic headless capture is blocked by turnstile/WAF; need CONSENT/manual-verify breakpoints or alternate capture path — no site-specific bypass should be hardcoded, but the tool must detect and *report* challenge pages.
- **G2** Assets include third-party analytics/tracking fetches localized as if content; blurs runtime vs content and inflates packages (16–78 MB).
- **G3** `hreflang` alternates are same-origin navigation, not resource deps — auditor mis-labels them as `freeze-blocker` external deps (false positive).

### H. Agent Reconstruction Error
- **H1** Authored entries didn't reproduce every captured heading/meta title exactly (e.g. `Plugins` page omitted `@vitejs/plugin-*` headings; titles diverge) → structural mismatch is partly an authored-fidelity gap, not only evidence.
- **H2** Replica interactivity re-implemented but locator surface (ids, roles) not mirrored onto the authored DOM, compounding C2.

### I. Validator False Positive / Negative
- **I1** (FP) `hreflang` alternate links → freeze-blocking external deps (audit).
- **I2** (FP) Visual diff flags semantically-identical-but-pixel-different replicas as failures at 3% on complex pages.
- **I3** (FN) Validator reported state failure as "could not be validated" for overlay states instead of distinguishing "locator missing" (C) from "action executed but wrong result" — diagnosis opacity.

---

## 6. P0 / P1 / P2 Remediation Recommendations

### P0 — blocking (real-world reconstruction cannot otherwise converge)
1. **Locator hardening + evidence capture of multiple target strategies.** Capture `id`, `data-testid`, `role`/`aria-label`, nearest-text, and name at transit time; write into the transition record. Validator resolves by priority (id → data-testid → aria → structural), and — for rebuilds — by *semantic role + text* instead of full structural CSS path. *(C1/C2/H2)*
2. **Visible-state capture gate.** Before writing a Golden Reference, verify the screenshot is not a known error/challenge/bounce page (check exported error boundary markers, doc title, or zero-main-content). At minimum *report* "golden state is an error screen" for the operator instead of silently freezing it. *(A3/E1/G1)*
3. **Responsive + scroll evidence by default.** Capture at ≥2 viewports (desktop + one mobile) and at ≥1 scrolled position per route; encode as first-class viewport/scroll states. *(A1/A2/F1)*
4. **Auditor link-vs-resource disambiguation.** Treat `link[rel="alternate"|"canonical"|"sitemap"]` and plain `<a href>` as navigation metadata, not unresolved fetch dependencies; reserve freeze-blockers for actual `<img>/<script>/<link rel=stylesheet>/font/style/API` fetches. *(G3/I1)*

### P1 — high-impact, non-blocking
5. **Faster/dedicated exploration.** Explore interactions against a settled page without full root re-navigation each action (reuse a session; only reset when the DOM is unrecoverable); raise interactive budget on heavy sites. *(B1/B2/B3/E2)*
6. **Challenge/anti-bot detection.** Detect WAF/security-challenge responses; abort capture with an explicit, classified error and exit code (distinct from normal capture failure) rather than freezing a challenge page. *(G1)*
7. **Content-asset separation.** Exclude third-party analytics/tracker fetches from the localized asset set (or mark them `analytics`, not content), shrinking packages and preventing runtime-dep confusion. *(G2)*
8. **Diagnostic granularity in validator.** Split "locator unresolved" vs "action ran but wrong observable result" vs "state not established"; expose per-failure reason codes. *(I3)*

### P2 — quality / fidelity
9. **Visual diff for real pages.** Add region masks, tolerance for animation/caret/gif, and structural (DOM/text) assertions as the primary check for complex pages, with pixel diff as a second signal; calibrate threshold per content-class rather than a global 3%. *(D1/D2/D3/I2)*
10. **Spec enrichment for agents.** Reconstruction Spec should list, per state, the exact title + heading outline + visible interactive targets (id/role/text) so an authored rebuild can match the recorded structure without reverse-engineering the DOM. *(H1)*
11. **Multi-page route capture.** Make `capture <url>` optionally follow internal route links (bounded) so real multi-page sites produce a real page/routes index instead of a single implied route. *(A1/page coverage)*

---

## Completion status

- **Completion Standard A (Full Validate passes): NOT met** — no real-world independent reconstruction passed full validate.
- **Completion Standard B (complete Gap Report, benchmark→real-world): MET** — this document enumerates the general capabilities missing to go from Benchmark to Real World.

**Positive invariant confirmed:** offline isolation held clean on the full live-scale pipeline (a reconstructed real site made **zero** external HTTP(S) requests during full validation).
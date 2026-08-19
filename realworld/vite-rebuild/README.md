# WebR Rebuild Workspace

This is a **blank, authored-source workspace** for reconstructing a website from
a frozen WebR Evidence Package. It contains no captured HTML and no captured
runtime — every implementation file must be written by a coding Agent.

## Rules (GOAL-003)

1. The Agent may read ONLY:
   - `spec.json` (the derived Reconstruction Spec);
   - the frozen Evidence Package it was derived from;
   - the WebR canonical docs (docs/architecture/00..06, docs/agents/).
   The original website must never be contacted.
2. The Agent must **generate new implementation code**. You may NOT:
   - copy a captured DOM snapshot as the final HTML;
   - ship the original site's JS bundle as the replica runtime;
   - depend on the original CSS/JS as final implementation deps.
3. Content assets under `public/` (images, fonts, SVG, video, audio) are the
   only captured artifacts allowed to be reused as-is.
4. Authored source MUST follow docs/architecture/05-SOURCE-CONVENTION.md:
   `wr-*` component classes, `is-*` state classes, `--wr-*` design tokens,
   semantic HTML, consistent formatting.
5. The Agent must re-implement (from evidence + spec): hover menu, modal,
   tabs, form/input, scroll header, mobile/responsive menu, routes, animation,
   and API mock/replay behavior.

## Layout to produce

```
public/            # served web root (index.html, routes/, assets/)
  index.html       # entry route "/"
  <route>/index.html   # any additional routes from spec.pages
  app.js           # authored runtime (interactions + API mocks)
  styles.css       # authored styles using --wr-* tokens
  cdn/…            # reused content assets (copied from evidence)
```

## Verify

`webr validate <evidence> <workspace>/public --profile full`

The rebuild passes when full-profile validation returns `success=true` with a
clean offline-isolation report and `transitions.failed = 0`.

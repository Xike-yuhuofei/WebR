# 02 — Website Evidence Package Spec

**Format name:** `webr-evidence`  
**Spec status:** v1 foundation contract  
**Compatibility rule:** readers must reject unsupported major versions and may accept newer minor versions when unknown optional fields can be ignored safely.

## 1. Package goals

A Website Evidence Package is a portable, local representation of browser-observable evidence sufficient for offline reconstruction and validation.

It must preserve:

- page and route identity
- UI states
- state transitions and actions
- screenshots / Golden References
- DOM and semantic structure
- computed visual evidence where captured
- assets and original-resource mappings
- network evidence and local response payloads where captured
- relevant browser storage
- animation evidence
- viewport / responsive context
- integrity metadata

## 2. Canonical directory layout

```text
<name>.webr/
├── manifest.json
├── pages/
│   └── index.json
├── states/
│   └── <state-id>/
│       ├── metadata.json
│       ├── screenshot.png
│       ├── fullpage.png            # optional
│       ├── dom.html
│       ├── dom.json                # optional normalized DOM snapshot
│       ├── computed-styles.json    # optional when captured
│       └── accessibility.json      # optional when captured
├── transitions/
│   └── state-graph.json
├── assets/
│   ├── index.json
│   └── ...localized files...
├── network/
│   ├── page.har                    # optional
│   └── responses/                  # optional
├── storage/                        # optional
├── animations/                     # optional
├── recordings/                     # optional
├── responsive/                     # optional derived reports
├── specs/                          # optional derived reconstruction specs
└── checksums.json
```

The exact physical layout may gain optional directories in minor versions, but existing canonical paths above must keep their meaning.

## 3. `manifest.json`

Minimum shape:

```json
{
  "format": "webr-evidence",
  "version": "1.0.0",
  "capture": {
    "capturedAt": "2026-08-18T00:00:00Z",
    "toolVersion": "0.1.0",
    "browser": {
      "name": "chromium",
      "version": "..."
    }
  },
  "source": {
    "origin": "https://example.com",
    "entryUrl": "https://example.com/"
  },
  "indexes": {
    "pages": "pages/index.json",
    "transitions": "transitions/state-graph.json",
    "assets": "assets/index.json",
    "checksums": "checksums.json"
  }
}
```

The source URL is evidence metadata only. Its presence never authorizes `reconstruct` or `validate` to access it.

## 4. Page record

A page record identifies a route/page family and its captured states.

Required logical fields:

```json
{
  "id": "page-home",
  "url": "https://example.com/",
  "route": "/",
  "stateIds": ["state-..."]
}
```

Optional fields may include title, query variants, route parameters, canonical metadata and capture notes.

## 5. State record

Each `states/<state-id>/metadata.json` must describe the observable context required to interpret the state.

Minimum logical shape:

```json
{
  "id": "state-...",
  "pageId": "page-home",
  "url": "https://example.com/",
  "viewport": { "width": 1440, "height": 900, "deviceScaleFactor": 2 },
  "scroll": { "x": 0, "y": 0 },
  "artifacts": {
    "screenshot": "screenshot.png",
    "dom": "dom.html"
  },
  "fingerprint": "sha256:..."
}
```

A state may additionally reference:

- full-page screenshot
- normalized DOM
- accessibility tree
- computed styles
- pseudo-element data
- browser storage snapshot
- active/focused element
- route/history metadata
- open overlays
- animation snapshot
- capture reason / tags

## 6. Transition graph

`transitions/state-graph.json` contains nodes and directed transitions.

Minimum transition shape:

```json
{
  "id": "transition-...",
  "from": "state-a",
  "action": {
    "type": "click",
    "target": {
      "strategy": "evidence-locator",
      "value": "..."
    }
  },
  "to": "state-b"
}
```

Supported action vocabulary is extensible. v1 must reserve at least:

- `click`
- `hover`
- `focus`
- `blur`
- `type`
- `press`
- `scroll`
- `drag`
- `resize`
- `navigate`
- `wait`

Action parameters must contain enough information for deterministic replay when possible.

## 7. Asset index

`assets/index.json` records localization and integrity.

Minimum logical shape:

```json
{
  "assets": [
    {
      "id": "asset-...",
      "originalUrl": "https://example.com/assets/logo.svg",
      "localPath": "assets/svg/logo.svg",
      "mimeType": "image/svg+xml",
      "sha256": "..."
    }
  ]
}
```

Assets include, when observable and legally/technically capturable:

- images
- SVG/icons
- fonts
- CSS
- JavaScript bundles
- video/audio
- Lottie/JSON data
- other browser-loaded static resources

Original URLs are provenance metadata. Reconstruction must resolve to local resources or explicit mocks.

## 8. Network evidence

Network evidence may contain:

- HAR
- request/response metadata
- response bodies
- REST/GraphQL payloads
- WebSocket observations where capturable

Network evidence is used to understand observable front-end behavior and to create local mocks. It is not permission to call the original service during reconstruction.

Secrets, session credentials and sensitive authentication material should not be persisted by default.

## 9. Browser storage

Relevant observable state may include sanitized snapshots of:

- localStorage
- sessionStorage
- IndexedDB metadata/data when required
- cookies when required and safe

Sensitive credentials/tokens must be redacted or excluded unless an explicit controlled use case requires otherwise.

## 10. Golden References

A Golden Reference is captured evidence designated for later validation. At minimum, every required validation state must contain a viewport screenshot and reproducible state metadata.

Golden References must be immutable after Evidence Freeze except through an explicit recapture/versioning operation.

## 11. IDs and portability

IDs must be stable within a package and unique by entity type. Implementations should prefer deterministic content/context-derived identifiers where practical, but the exact hashing algorithm is deferred.

All internal file references must be package-relative. No absolute local machine paths are allowed in the canonical package.

## 12. Integrity

`checksums.json` records cryptographic hashes for canonical evidence artifacts. SHA-256 is the v1 baseline.

Audit must detect:

- missing referenced files
- checksum mismatch
- dangling state/page/transition/asset references
- malformed version/schema metadata

## 13. Required vs optional evidence

**Required for a minimally valid package:**

- `manifest.json`
- page index
- at least one state
- state metadata
- screenshot for each required state
- DOM snapshot for each required state
- transition graph file (may contain zero transitions for a truly non-interactive capture)
- asset index
- checksums

**Coverage-complete is a stronger condition than schema-valid.** Optional evidence may become mandatory for a specific target profile or acceptance policy.

## 14. Extension rule

Future extensions must:

- preserve backward meaning of existing fields
- use versioned schema evolution
- remain locally portable
- not introduce hidden source-site dependencies

/**
 * Evidence Package v1 contracts.
 *
 * Implements the canonical `webr-evidence` format defined in
 * `docs/architecture/02-EVIDENCE-PACKAGE-SPEC.md`. These types describe the
 * data models only — no I/O, validation or capture logic lives here.
 */

/** Name of the canonical Evidence Package format. */
export const FORMAT_PACKAGE = 'webr-evidence';

/** The v1 package version emitted by this implementation. */
export const PACKAGE_VERSION = '1.0.0';

/** The WebR CLI/tool release version (see `webr --version`). */
export const TOOL_VERSION = '0.1.0';

/** The maximum package major version this implementation can read. */
export const SUPPORTED_FEATURES = {
  /** Readers must reject unsupported major versions. */
  majorVersion: 1,
} as const;

/** The default browser name recorded as capture metadata by future phases. */
export const DEFAULT_BROWSER_NAME = 'chromium';

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface CaptureMetadata {
  /** ISO-8601 timestamp of overall capture. */
  capturedAt: string;
  /** Capturing tool version, e.g. "0.1.0". */
  toolVersion: string;
  browser: {
    name: string;
    version: string;
  };
}

export interface SourceMetadata {
  /** Source origin, e.g. "https://example.com". Evidence metadata only. */
  origin: string;
  /** Entry page URL captured, e.g. "https://example.com/". */
  entryUrl: string;
}

export interface ManifestIndexes {
  /** Package-relative path to the page index. */
  pages: string;
  /** Package-relative path to the state graph. */
  transitions: string;
  /** Package-relative path to the asset index. */
  assets: string;
  /** Package-relative path to the checksums file. */
  checksums: string;
}

export interface Manifest {
  /** Must equal {@link FORMAT_PACKAGE}. */
  format: string;
  /** Semantic package version, e.g. "1.0.0". */
  version: string;
  capture: CaptureMetadata;
  source: SourceMetadata;
  indexes: ManifestIndexes;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export interface PageRecord {
  /** Stable id, unique among pages in a package. */
  id: string;
  /** Absolute source URL of the page family. */
  url: string;
  /** Package-relative route, e.g. "/". */
  route: string;
  /** Ids of captured states belonging to this page. */
  stateIds: string[];
  /** Page title when observed. Optional. */
  title?: string;
  /** Query/param variants. Optional. */
  query?: Record<string, unknown>;
  /** Route parameters. Optional. */
  routeParams?: Record<string, unknown>;
  /** Canonical URL when different from {@link PageRecord.url}. Optional. */
  canonical?: string;
  /** Free-form capture notes. Optional. */
  notes?: string;
}

export interface PageIndex {
  pages: PageRecord[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface ScrollPosition {
  x: number;
  y: number;
}

export interface StateArtifacts {
  /** Package-relative path (from this state's directory) to the viewport screenshot. */
  screenshot: string;
  /** Package-relative path (from this state's directory) to the fullpage screenshot. Optional. */
  fullpage?: string;
  /** Package-relative path to the raw DOM snapshot. Optional. */
  dom?: string;
  /** Package-relative path to the normalized DOM snapshot. Optional. */
  domJson?: string;
  /** Package-relative path to computed-style evidence. Optional. */
  computedStyles?: string;
  /** Package-relative path to accessibility evidence. Optional. */
  accessibility?: string;
  /** Package-relative path to a HAR capture for this state. Optional. */
  har?: string;
}

export interface StateRecord {
  /** Stable id, unique among states in a package. */
  id: string;
  /** Id of the page this state belongs to. */
  pageId: string;
  /** Source URL at this state. */
  url: string;
  viewport: Viewport;
  scroll: ScrollPosition;
  artifacts: StateArtifacts;
  /** State fingerprint in `sha256:<hex>` form. */
  fingerprint: string;
  /** Observed document title. Optional. */
  title?: string;
  /** Active/focused element locator. Optional. */
  activeElement?: string;
  /** Open overlay/menu/modal locators. Optional. */
  openOverlays?: string[];
  /** Capture reason / tags. Optional. */
  tags?: string[];
  /** Route/history metadata. Optional. */
  history?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Transition / state graph
// ---------------------------------------------------------------------------

/** Reserved v1 action vocabulary (extensible in later minor versions). */
export type ActionType =
  | 'click'
  | 'hover'
  | 'focus'
  | 'blur'
  | 'type'
  | 'press'
  | 'scroll'
  | 'drag'
  | 'resize'
  | 'navigate'
  | 'wait';

export interface ActionTarget {
  /** Primary locator strategy, e.g. "css" | "text" | "id" | "data-testid" | "aria". */
  strategy: string;
  /** Primary locator value. */
  value: string;
  /**
   * Additional lower-priority locators, ordered most-to-least stable, so a
   * validator can resolve the target class-agnostically on a rebuilt replica.
   * Optional, forward-compatible extension (02-EVIDENCE-PACKAGE-SPEC §14).
   */
  alternates?: ActionTarget[];
}

export interface Action {
  type: ActionType;
  target?: ActionTarget;
  /** Extra parameters needed for deterministic replay when possible. */
  params?: Record<string, unknown>;
}

export interface Transition {
  id: string;
  from: string;
  action: Action;
  to: string;
}

export interface StateGraph {
  /** Ids of all nodes (states) in the graph. */
  nodes: string[];
  transitions: Transition[];
}

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------

export interface Asset {
  /** Stable id, unique among assets in a package. */
  id: string;
  /** Original (source) URL. Provenance metadata only. */
  originalUrl: string;
  /** Package-relative localized path. */
  localPath: string;
  mimeType: string;
  /** SHA-256 hex digest of the localized file. */
  sha256: string;
}

export interface AssetIndex {
  assets: Asset[];
}

// ---------------------------------------------------------------------------
// Integrity / checksums
// ---------------------------------------------------------------------------

/**
 * Package-relative path → SHA-256 hex digest, covering canonical evidence
 * artifacts. Consumed by the validator's integrity checks.
 */
export type Checksums = Record<string, string>;

/**
 * A fully materialized, in-memory Evidence Package. The canonical object
 * produced by deserialization and validated by the package validator.
 */
export interface EvidencePackage {
  manifest: Manifest;
  pages: PageRecord[];
  states: StateRecord[];
  stateGraph: StateGraph;
  assets: AssetIndex;
  checksums: Checksums;
}

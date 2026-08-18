/**
 * WebR public API.
 *
 * Exposes the Evidence Package v1 contracts, deserialization, structural
 * validation, capture (Phase 2/3), completeness audit (Phase 4),
 * reconstruction adapter (Phase 5) and offline validator (Phase 6).
 */

export * from './contracts.js';
export { sha256Hex, HASH_ALGORITHM } from './checksum.js';
export {
  readPackage,
  readManifest,
  readJsonFile,
  STATE_DIR,
  MANIFEST_FILE,
  STATE_METADATA_FILE,
  DEFAULT_INDEXES,
} from './packageIO.js';
export {
  validatePackage,
  isPackageRelative,
  type ValidationResult,
  type ValidationIssue,
  type IssueCategory,
} from './validator.js';
export {
  WebrError,
  PackageNotFoundError,
  PackageReadError,
  PackageInvalidError,
} from './errors.js';
export { runCli, EXIT_CODES } from './cli.js';

// Phase 2/3 — capture + state explorer
export { capturePackage, type CaptureConfig, type CaptureOutcome } from './capture/capture.js';
export {
  launchSession,
  type BrowserSession,
  type BrowserSessionOptions,
} from './capture/browser.js';
export {
  observeResponses,
  isLocalizableAsset,
  createHarCollector,
  waitForPageReady,
  routeOf,
  type CaptureOptions,
  type CapturedStateEvidence,
  type CapturedAsset,
  type CaptureResult,
  type HarCollector,
  type HarLog,
  type HarEntry,
} from './capture/collector.js';
export {
  fingerprintString,
  fingerprintPage,
  collectFingerprintSignals,
} from './capture/fingerprint.js';
export { writePackage, assetId, assetLocalPath, type WrittenPackage } from './capture/writer.js';
export {
  explore,
  discoverActions,
  performAction,
  replayPath,
  DEFAULT_EXPLORE_OPTIONS,
  transitionId,
  type ExploreOptions,
  type ExploreResult,
  type DiscoveredAction,
  type ExploreTransition,
  type ExploreContext,
} from './explore/explorer.js';

// Phase 4 — completeness audit
export {
  auditPackage,
  renderAudit,
  DEFAULT_FREEZE_POLICY,
  type AuditResult,
  type CoverageMetrics,
  type FreezePolicy,
} from './audit/audit.js';

// Phase 5 — reconstruction adapter
export {
  buildReconstructionSpec,
  buildReplica,
  sourceOriginDenied,
  scanReplicaForSourceOrigin,
  routeKeyFor,
  captureIndex,
  groupStatesByRoute,
  mimeTypeFor,
  type ReconstructionSpec,
  type ReplicaBuildOptions,
} from './reconstruct/adapter.js';

// Phase 6 — offline validator
export {
  validateReplica,
  startReplicaServer,
  compareScreenshots,
  compareStructure,
  structuralSignalsFromDom,
  monitorIsolation,
  selectStates,
  selectTransitions,
  observeFingerprint,
  findPath,
  establishState,
  replayTransitionVerify,
  renderValidationReport,
  reportToJson,
  DEFAULT_VALIDATE_OPTIONS,
  DEFAULT_VISUAL_OPTIONS,
  type ValidationReport,
  type ValidationProfile,
  type ValidateOptions,
  type VisualComparison,
  type VisualOptions,
  type StructuralComparison,
  type IsolationViolation,
  type ReplicaServer,
  type TransitionOutcome,
} from './validate/validator.js';
export { lookup } from './validate/mime.js';

// GOAL-002 — controlled Benchmark Site (two local origins: main + CDN; + API)
export { startBenchmarkSite, type BenchmarkSite, type BenchmarkUrls } from './benchmark/site.js';

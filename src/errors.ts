/** Base error for all WebR domain errors. */
export class WebrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The evidence package directory does not exist or is unreadable. */
export class PackageNotFoundError extends WebrError {}

/** The package could not be read/deserialized (missing/malformed JSON, etc.). */
export class PackageReadError extends WebrError {}

/** The package is structurally invalid per the v1 contract. */
export class PackageInvalidError extends WebrError {}

/**
 * Capture was blocked by an anti-bot / WAF / security-challenge page. The
 * evidence is not a usable Golden Reference, so capture refuses to freeze it.
 * The classification is machine-readable via `.kind` ('challenge' | 'error' |
 * 'empty') which callers (e.g. the CLI) can surface without changing the
 * frozen exit-code contract.
 */
export class CaptureBlockedError extends WebrError {
  readonly kind: 'challenge' | 'error' | 'empty';
  constructor(kind: 'challenge' | 'error' | 'empty', detail: string) {
    super(`capture blocked (${kind}): ${detail}`);
    this.kind = kind;
  }
}

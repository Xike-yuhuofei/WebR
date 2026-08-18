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

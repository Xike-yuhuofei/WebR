import { createHash } from 'node:crypto';

/** SHA-256 is the v1 baseline integrity algorithm. */
export const HASH_ALGORITHM = 'sha256';

/** Compute the SHA-256 hex digest of a buffer or string. */
export function sha256Hex(data: Buffer | string): string {
  return createHash(HASH_ALGORITHM).update(data).digest('hex');
}

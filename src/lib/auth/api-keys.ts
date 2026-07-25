import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Programmatic API keys.
 *
 * Only the SHA-256 hash is persisted; the plaintext is returned exactly once at
 * creation and is unrecoverable afterwards. A leaked database dump therefore
 * yields no usable credentials.
 *
 * SHA-256 rather than a slow KDF is the correct choice here specifically
 * because these are 256-bit random secrets, not user-chosen passwords. There is
 * no dictionary to attack, so the offline-guessing resistance a KDF buys is
 * worthless, while the per-request cost would be paid on every single API call.
 */

const KEY_PREFIX = 'pb_';
const KEY_BYTES = 32;

export interface GeneratedApiKey {
  /** Shown once, never stored. */
  plaintext: string;
  hash: string;
  /** Displayed in the UI so users can identify a key without revealing it. */
  displayPrefix: string;
}

export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(KEY_BYTES).toString('base64url');
  const plaintext = `${KEY_PREFIX}${secret}`;
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    displayPrefix: plaintext.slice(0, 11),
  };
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(KEY_PREFIX) && value.length >= KEY_PREFIX.length + 32;
}

/**
 * Constant-time hash comparison.
 *
 * The lookup itself is by hash so this is belt-and-braces, but it costs
 * nothing and removes any timing signal from the comparison path.
 */
export function verifyApiKey(plaintext: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashApiKey(plaintext), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Extracts a bearer token from an Authorization header. */
export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}
